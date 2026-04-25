"""
语音通话 HTTP 信令端点（SmallWebRTC 原生 offer/answer + ICE trickle via PATCH）。

端点：
  POST /api/call/offer       — 初始 SDP offer（body 含 sdp、type、profile_id、style_tags?）
  PATCH /api/call/ice        — 追加 ICE candidate

鉴权：两个端点都依赖 X-Access-Token；offer 首次就校验 profile 归属。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

from api.auth import authenticate_request
from config import settings
from models.tables import User
from pipeline.session import run_call_bot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/call", tags=["call"])

# 单例 handler 维护所有活跃连接；app shutdown 时需要 close()
_handler = SmallWebRTCRequestHandler()


class CallOfferRequest(SmallWebRTCRequest):
    profile_id: str
    style_tags: str | None = None


@router.post("/offer")
async def create_offer(
    request: Request,
    payload: CallOfferRequest,
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

    try:
        answer = await _handler.handle_web_request(
            request=SmallWebRTCRequest(sdp=payload.sdp, type=payload.type),
            webrtc_connection_callback=_callback,
        )
    except Exception as exc:
        logger.exception(f"[{user.user_id}] offer 处理失败")
        raise HTTPException(status_code=500, detail=f"SDP 协商失败: {exc}") from exc

    return answer


@router.patch("/ice")
async def add_ice(
    payload: SmallWebRTCPatchRequest,
    user: User = Depends(authenticate_request),
):
    try:
        await _handler.handle_patch_request(payload)
    except Exception as exc:
        logger.exception(f"[{user.user_id}] ICE 追加失败")
        raise HTTPException(status_code=400, detail=f"ICE 追加失败: {exc}") from exc
    return {"status": "success"}


async def close_handler() -> None:
    """lifespan 关闭时清理所有活跃 SmallWebRTC 连接。"""
    await _handler.close()
