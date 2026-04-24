"""
当前用户信息 — 所有已登录用户可访问，用于前端判断身份 / 权限。
从 admin 路由下迁出，避免 /admin/me 看似需要管理员权限。
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from api.auth import authenticate_request
from models.database import get_async_session
from models.tables import User, VoiceProfile

router = APIRouter(tags=["me"])


class MeResponse(BaseModel):
    user_id: str
    username: str
    is_admin: bool
    created_at: datetime
    voice_count: int


@router.get("/me", response_model=MeResponse)
async def get_me(user: User = Depends(authenticate_request)):
    async with get_async_session() as session:
        count_res = await session.execute(
            select(VoiceProfile.profile_id).where(VoiceProfile.user_id == user.user_id)
        )
        voice_count = len(count_res.all())

    return MeResponse(
        user_id=user.user_id,
        username=user.username,
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
        voice_count=voice_count,
    )
