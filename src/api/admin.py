"""
管理员 API：用户管理（列表/创建/重置令牌/删除/授予管理员）。

所有端点要求请求方是管理员（User.is_admin = True）。首个管理员通过
`scripts/create_user.py --admin <username>` 创建。
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select

from api.auth import (
    USERNAME_PATTERN,
    authenticate_request,
    generate_token,
    hash_token,
)
from models.database import get_async_session
from models.tables import User, VoiceProfile
from services.voice_service import VoiceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminUserOut(BaseModel):
    user_id: str
    username: str
    is_admin: bool
    created_at: datetime
    voice_count: int


class AdminUserCreate(BaseModel):
    username: str
    is_admin: bool = False

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v: str) -> str:
        if not USERNAME_PATTERN.match(v):
            raise ValueError("username 只允许 1-32 个字母、数字、下划线或连字符")
        return v


class AdminUserCreated(AdminUserOut):
    token: str


class AdminTokenReset(BaseModel):
    user_id: str
    token: str


class AdminUpdatePayload(BaseModel):
    is_admin: Optional[bool] = None


async def require_admin(user: User = Depends(authenticate_request)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def get_voice_service(request: Request) -> VoiceService:
    return request.app.state.voice_service


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(_: User = Depends(require_admin)):
    async with get_async_session() as session:
        users_res = await session.execute(select(User).order_by(User.created_at.asc()))
        users = users_res.scalars().all()

        counts_res = await session.execute(
            select(VoiceProfile.user_id).order_by(VoiceProfile.user_id)
        )
        voice_counts: dict[str, int] = {}
        for (uid,) in counts_res.all():
            voice_counts[uid] = voice_counts.get(uid, 0) + 1

    return [
        AdminUserOut(
            user_id=u.user_id,
            username=u.username,
            is_admin=bool(u.is_admin),
            created_at=u.created_at,
            voice_count=voice_counts.get(u.user_id, 0),
        )
        for u in users
    ]


@router.post("/users", response_model=AdminUserCreated, status_code=201)
async def create_user_endpoint(
    payload: AdminUserCreate,
    _: User = Depends(require_admin),
):
    import secrets

    token = generate_token()
    user_id = f"u-{payload.username.lower()}-{secrets.token_hex(4)}"

    async with get_async_session() as session:
        dup = await session.execute(
            select(User).where(User.username == payload.username)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="用户名已存在")

        user = User(
            user_id=user_id,
            username=payload.username,
            token_hash=hash_token(token),
            is_admin=payload.is_admin,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    logger.info(f"admin 创建用户: {user_id} (admin={payload.is_admin})")
    return AdminUserCreated(
        user_id=user.user_id,
        username=user.username,
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
        voice_count=0,
        token=token,
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: str,
    payload: AdminUpdatePayload,
    admin: User = Depends(require_admin),
):
    async with get_async_session() as session:
        res = await session.execute(select(User).where(User.user_id == user_id))
        target = res.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")

        if payload.is_admin is not None:
            if target.user_id == admin.user_id and not payload.is_admin:
                raise HTTPException(
                    status_code=400, detail="不能撤销自己的管理员权限"
                )
            target.is_admin = payload.is_admin

        await session.commit()
        await session.refresh(target)

        count_res = await session.execute(
            select(VoiceProfile.profile_id).where(VoiceProfile.user_id == user_id)
        )
        voice_count = len(count_res.all())

    return AdminUserOut(
        user_id=target.user_id,
        username=target.username,
        is_admin=bool(target.is_admin),
        created_at=target.created_at,
        voice_count=voice_count,
    )


@router.post("/users/{user_id}/reset-token", response_model=AdminTokenReset)
async def reset_token(
    user_id: str,
    _: User = Depends(require_admin),
):
    async with get_async_session() as session:
        res = await session.execute(select(User).where(User.user_id == user_id))
        target = res.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")

        new_token = generate_token()
        target.token_hash = hash_token(new_token)
        await session.commit()

    logger.info(f"admin 重置令牌: {user_id}")
    return AdminTokenReset(user_id=user_id, token=new_token)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    admin: User = Depends(require_admin),
    voice_service: VoiceService = Depends(get_voice_service),
):
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="不能删除自己")

    async with get_async_session() as session:
        res = await session.execute(select(User).where(User.user_id == user_id))
        target = res.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")

    # 先清物理文件与 voice_profiles（走 VoiceService 走正确边界校验 + 锁 + 缓存清理），
    # 再删用户行。VoiceProfile 行由 delete_profile 逐个 DELETE，目录由 delete_user_data 兜底清空。
    deleted_count = await voice_service.delete_user_data(user_id)

    async with get_async_session() as session:
        res = await session.execute(select(User).where(User.user_id == user_id))
        target = res.scalar_one_or_none()
        if target is not None:
            await session.delete(target)
            await session.commit()

    logger.info(f"admin 删除用户: {user_id}（清理 {deleted_count} 条音色及磁盘目录）")
    return None


@router.get("/me", response_model=AdminUserOut)
async def me(user: User = Depends(authenticate_request)):
    """当前用户信息 — 前端用来判断是否显示「管理员」入口。
    故意挂在 /admin 下但允许所有已登录用户访问。"""
    async with get_async_session() as session:
        count_res = await session.execute(
            select(VoiceProfile.profile_id).where(VoiceProfile.user_id == user.user_id)
        )
        voice_count = len(count_res.all())

    return AdminUserOut(
        user_id=user.user_id,
        username=user.username,
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
        voice_count=voice_count,
    )
