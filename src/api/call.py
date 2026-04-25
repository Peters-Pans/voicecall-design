"""
语音通话 HTTP 信令端点（SmallWebRTC 原生 offer/answer + ICE trickle via PATCH）。

端点：
  POST /api/call/offer       — 初始 SDP offer（body 含 sdp、type、profile_id、style_tags?）
  PATCH /api/call/ice        — 追加 ICE candidate 列表

鉴权：两个端点都依赖 X-Access-Token；offer 首次就校验 profile 归属。

注意：pipecat 1.0.0 的 SmallWebRTCRequest / SmallWebRTCPatchRequest / IceCandidate 都是
@dataclass，FastAPI 没法直接绑 body。这里用 pydantic BaseModel 接请求，再转 dataclass。
"""

from __future__ import annotations

import logging

from aiortc.rtcconfiguration import RTCIceServer
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pydantic import BaseModel, Field

from api.auth import authenticate_request
from config import settings
from models.tables import User
from pipeline.session import run_call_bot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/call", tags=["call"])


def _build_ice_servers() -> list[RTCIceServer]:
    """服务端必须用 STUN 才能 gather srflx 候选；OCI 1:1 NAT 后，host 候选是私网 IP，
    浏览器根本连不到。TURN 不在这里给——服务端走 srflx 出站就够，TURN 是给客户端兜底的。"""
    servers: list[RTCIceServer] = []
    if settings.STUN_URL:
        servers.append(RTCIceServer(urls=settings.STUN_URL))
    return servers


# 单例 handler 维护所有活跃连接；app shutdown 时需要 close()
_handler = SmallWebRTCRequestHandler(ice_servers=_build_ice_servers())


class OfferIn(BaseModel):
    sdp: str
    type: str
    profile_id: str
    style_tags: str | None = None
    pc_id: str | None = None
    restart_pc: bool | None = None


class IceCandidateIn(BaseModel):
    candidate: str
    sdp_mid: str = Field(default="")
    sdp_mline_index: int = Field(default=0)


class IcePatchIn(BaseModel):
    pc_id: str
    candidates: list[IceCandidateIn]


@router.post("/offer")
async def create_offer(
    request: Request,
    payload: OfferIn,
    background_tasks: BackgroundTasks,
    user: User = Depends(authenticate_request),
):
    voice_service = request.app.state.voice_service
    tts_engine = request.app.state.tts_engine

    ref = await voice_service.get_reference_audio(
        profile_id=payload.profile_id, user_id=user.user_id
    )
    if not ref:
        raise HTTPException(status_code=404, detail="音色不存在或无权访问")

    if not settings.LLM_API_KEY:
        raise HTTPException(status_code=503, detail="LLM 未配置，语音通话暂不可用")

    async def _callback(connection):
        background_tasks.add_task(
            run_call_bot,
            webrtc_connection=connection,
            tts_engine=tts_engine,
            profile_id=payload.profile_id,
            user_id=user.user_id,
            style_tags=payload.style_tags,
        )

    pipecat_request = SmallWebRTCRequest(
        sdp=payload.sdp,
        type=payload.type,
        pc_id=payload.pc_id,
        restart_pc=payload.restart_pc,
    )

    try:
        answer = await _handler.handle_web_request(
            request=pipecat_request,
            webrtc_connection_callback=_callback,
        )
    except Exception as exc:
        logger.exception(f"[{user.user_id}] offer 处理失败")
        raise HTTPException(status_code=500, detail=f"SDP 协商失败: {exc}") from exc

    return answer


@router.patch("/ice")
async def add_ice(
    payload: IcePatchIn,
    user: User = Depends(authenticate_request),
):
    pipecat_patch = SmallWebRTCPatchRequest(
        pc_id=payload.pc_id,
        candidates=[
            IceCandidate(
                candidate=c.candidate,
                sdp_mid=c.sdp_mid,
                sdp_mline_index=c.sdp_mline_index,
            )
            for c in payload.candidates
        ],
    )
    try:
        await _handler.handle_patch_request(pipecat_patch)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[{user.user_id}] ICE 追加失败")
        raise HTTPException(status_code=400, detail=f"ICE 追加失败: {exc}") from exc
    return {"status": "success"}


async def close_handler() -> None:
    """lifespan 关闭时清理所有活跃 SmallWebRTC 连接。"""
    await _handler.close()
