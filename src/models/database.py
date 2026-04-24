"""
数据库连接与 session 工厂。
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


DATABASE_URL = "sqlite+aiosqlite:///./data/voicecall.db"


class Base(DeclarativeBase):
    pass


engine = create_async_engine(DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def get_async_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session


async def init_db() -> None:
    from models import tables  # noqa: F401  ensure models registered
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # 轻量迁移：补加后续引入的列，避免 dev DB 被整体重建。
        # SQLite 没有 IF NOT EXISTS，先看现有列再决定是否 ALTER。
        result = await conn.execute(text("PRAGMA table_info(users)"))
        existing_cols = {row[1] for row in result.fetchall()}
        if "is_admin" not in existing_cols:
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
            )
