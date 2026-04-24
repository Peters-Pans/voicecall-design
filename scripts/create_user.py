"""
CLI：创建新用户并打印 access token（token 只显示一次）。

用法：
  cd voicecall-design
  python scripts/create_user.py <username>            # 普通用户
  python scripts/create_user.py --admin <username>    # 管理员（可访问 /admin）
"""

import argparse
import asyncio
import hashlib
import re
import secrets
import sys
from pathlib import Path

# 允许脚本直接引用 src/ 下的模块
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

from models.database import engine, get_async_session, init_db  # noqa: E402
from models.tables import User  # noqa: E402
from sqlalchemy import select  # noqa: E402

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


async def create_user(username: str, is_admin: bool = False) -> tuple[str, str]:
    if not USERNAME_PATTERN.match(username):
        raise SystemExit("username 只允许 1-32 个字母、数字、下划线或连字符")

    await init_db()

    async with get_async_session() as session:
        exists = await session.execute(select(User).where(User.username == username))
        if exists.scalar_one_or_none():
            raise SystemExit(f"用户名已存在: {username}")

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    user_id = f"u-{username.lower()}-{secrets.token_hex(4)}"

    async with get_async_session() as session:
        session.add(
            User(
                user_id=user_id,
                username=username,
                token_hash=token_hash,
                is_admin=is_admin,
            )
        )
        await session.commit()

    return user_id, token


async def _main() -> None:
    parser = argparse.ArgumentParser(description="创建 VoiceClone 用户")
    parser.add_argument("username")
    parser.add_argument(
        "--admin", action="store_true", help="创建为管理员（可访问 /admin 页面）"
    )
    args = parser.parse_args()

    user_id, token = await create_user(args.username, is_admin=args.admin)

    role = "管理员" if args.admin else "普通用户"
    print(f"角色     = {role}")
    print(f"user_id  = {user_id}")
    print(f"token    = {token}")
    print()
    print("⚠️  token 只显示这一次，请妥善保存。客户端请求需在 header 带：")
    print(f"    X-Access-Token: {token}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
