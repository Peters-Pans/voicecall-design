"""
数据库连接、session 工厂与顺序迁移。

不引 alembic 是因为：表少（users + voice_profiles）、SQLite only、
开发+自部署只有一条升级路径。需要回滚或分支迁移时再换。
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator, Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.resolved_database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def get_async_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# ---- 迁移 ----

Migration = Callable[[AsyncConnection], Awaitable[None]]


async def _migration_001_users_extra_cols(conn: AsyncConnection) -> None:
    """补 users.is_admin / token_created_at（老 dev DB 无这两列）。"""
    result = await conn.execute(text("PRAGMA table_info(users)"))
    cols = {row[1] for row in result.fetchall()}
    if "is_admin" not in cols:
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        )
    if "token_created_at" not in cols:
        # SQLite ALTER 要求默认值常量；先加可空列再回填 created_at（兼容历史数据）
        await conn.execute(text("ALTER TABLE users ADD COLUMN token_created_at DATETIME"))
        await conn.execute(
            text("UPDATE users SET token_created_at = created_at WHERE token_created_at IS NULL")
        )


MIGRATIONS: list[tuple[int, str, Migration]] = [
    (1, "users: add is_admin + token_created_at", _migration_001_users_extra_cols),
]


async def _ensure_schema_version_table(conn: AsyncConnection) -> None:
    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
            """
        )
    )


async def _applied_versions(conn: AsyncConnection) -> set[int]:
    result = await conn.execute(text("SELECT version FROM schema_version"))
    return {row[0] for row in result.fetchall()}


async def init_db() -> None:
    from models import tables  # noqa: F401  ensure models registered

    async with engine.begin() as conn:
        # 新装：create_all 建出 users/voice_profiles；老 dev DB 已存在的表会被跳过
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_schema_version_table(conn)

        applied = await _applied_versions(conn)
        pending = [m for m in MIGRATIONS if m[0] not in applied]
        if not pending:
            return

        for version, name, func in sorted(pending, key=lambda m: m[0]):
            logger.info(f"应用迁移 v{version}: {name}")
            await func(conn)
            await conn.execute(
                text("INSERT INTO schema_version (version, name) VALUES (:v, :n)"),
                {"v": version, "n": name},
            )
