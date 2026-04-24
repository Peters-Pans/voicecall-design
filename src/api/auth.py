"""
用户认证中间件。

设计要点:
1. 简单 token 认证，适合几个人用
2. 通过 Header 或 Query 参数传递 token
3. WebSocket 通过 query 参数传递 (WebSocket 不支持自定义 header)
"""

import hashlib
import logging
import re
import secrets
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, field_validator

from models.database import get_async_session
from models.tables import User

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")

logger = logging.getLogger(__name__)


class UserCreate(BaseModel):
    username: str

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v: str) -> str:
        if not USERNAME_PATTERN.match(v):
            raise ValueError("username 只允许 1-32 个字母、数字、下划线或连字符")
        return v


class UserResponse(BaseModel):
    user_id: str
    username: str
    token: str
    created_at: datetime


async def get_user_from_token(
    token: str,
) -> Optional[User]:
    """根据 token 查找用户。"""
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    async with get_async_session() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(User).where(User.token_hash == token_hash)
        )
        return result.scalar_one_or_none()


# ---- FastAPI 依赖注入 ----

async def authenticate_request(request: Request) -> User:
    """HTTP 请求认证 (从 Header 获取 token)。"""
    auth_header = request.headers.get("X-Access-Token")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing access token")

    user = await get_user_from_token(auth_header)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid access token")

    return user


async def authenticate_websocket(
    websocket: WebSocket,
    token: str = Query(..., alias="token"),
) -> User:
    """WebSocket 认证 (从 query 参数获取 token)。"""
    user = await get_user_from_token(token)
    if not user:
        await websocket.close(code=4001, reason="Invalid access token")
        raise WebSocketDisconnect(code=4001)

    return user


# ---- 用户管理 ----

def generate_token() -> str:
    """生成随机 access token。"""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA256 哈希。"""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_user(username: str) -> UserResponse:
    """创建新用户。"""
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(
            status_code=400,
            detail="username 只允许 1-32 个字母、数字、下划线或连字符",
        )
    token = generate_token()
    user_id = f"u-{username.lower()}-{secrets.token_hex(4)}"

    async with get_async_session() as session:
        user = User(
            user_id=user_id,
            username=username,
            token_hash=hash_token(token),
        )
        session.add(user)
        await session.commit()

    logger.info(f"创建用户: user_id={user_id}, username={username}")

    return UserResponse(
        user_id=user_id,
        username=username,
        token=token,
        created_at=datetime.utcnow(),
    )
