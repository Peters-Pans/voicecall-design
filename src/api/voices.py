"""
音色管理 REST API。

端点:
  POST   /api/voices         — 创建音色档案 (上传参考音频)
  GET    /api/voices         — 列出当前用户的所有音色
  GET    /api/voices/{id}    — 获取音色详情
  PUT    /api/voices/{id}    — 更新音色 (换参考音频)
  DELETE /api/voices/{id}    — 删除音色
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from api.auth import authenticate_request
from models.tables import User
from services.voice_service import VoiceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voices", tags=["voices"])


MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB：小米 Base64 上限 ≈ 10MB，原始 bytes 约 7.5MB，这里放宽到 10MB


CONTENT_TYPE_TO_FORMAT = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
}


def get_voice_service(request: Request) -> VoiceService:
    return request.app.state.voice_service


def _infer_format(content_type: str) -> str:
    fmt = CONTENT_TYPE_TO_FORMAT.get(content_type)
    if not fmt:
        raise HTTPException(status_code=400, detail=f"仅支持 WAV / MP3 格式，收到 {content_type}")
    return fmt


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="文件大小不能超过 10MB")
    return content


@router.post("", response_model=dict)
async def create_voice(
    file: UploadFile = File(...),
    name: str = Form(default="默认音色"),
    user: User = Depends(authenticate_request),
    voice_service: VoiceService = Depends(get_voice_service),
):
    """上传参考音频，创建音色档案。"""
    audio_format = _infer_format(file.content_type or "")
    content = await _read_upload(file)

    profile = await voice_service.create_profile(
        user_id=user.user_id,
        audio_bytes=content,
        audio_format=audio_format,
        audio_name=name,
    )

    return {
        "profile_id": profile.profile_id,
        "audio_format": profile.audio_format,
        "message": "音色档案创建成功",
    }


@router.get("", response_model=list)
async def list_voices(
    user: User = Depends(authenticate_request),
    voice_service: VoiceService = Depends(get_voice_service),
):
    """列出当前用户的所有音色档案。"""
    return await voice_service.list_profiles(user_id=user.user_id)


@router.get("/{profile_id}")
async def get_voice(
    profile_id: str,
    user: User = Depends(authenticate_request),
    voice_service: VoiceService = Depends(get_voice_service),
):
    """获取音色档案详情。"""
    profiles = await voice_service.list_profiles(user_id=user.user_id)
    profile = next((p for p in profiles if p.profile_id == profile_id), None)
    if not profile:
        raise HTTPException(status_code=404, detail="音色档案不存在")
    return profile


@router.put("/{profile_id}")
async def update_voice(
    profile_id: str,
    file: UploadFile = File(...),
    user: User = Depends(authenticate_request),
    voice_service: VoiceService = Depends(get_voice_service),
):
    """更新音色档案 (上传新参考音频)。"""
    audio_format = _infer_format(file.content_type or "")
    content = await _read_upload(file)

    result = await voice_service.update_profile(
        profile_id=profile_id,
        user_id=user.user_id,
        audio_bytes=content,
        audio_format=audio_format,
    )
    if not result:
        raise HTTPException(status_code=404, detail="音色档案不存在")

    return {"message": "音色档案已更新", "audio_format": result.audio_format}


@router.delete("/{profile_id}")
async def delete_voice(
    profile_id: str,
    user: User = Depends(authenticate_request),
    voice_service: VoiceService = Depends(get_voice_service),
):
    """删除音色档案。"""
    success = await voice_service.delete_profile(
        profile_id=profile_id,
        user_id=user.user_id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="音色档案不存在")

    return {"message": "音色档案已删除"}
