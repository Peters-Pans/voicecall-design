"""
ORM 表定义。
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, String

from models.database import Base, engine, get_async_session, init_db  # re-export for backwards compat

__all__ = ["User", "VoiceProfile", "CallRecord", "engine", "get_async_session", "init_db"]


class User(Base):
    __tablename__ = "users"

    user_id = Column(String(64), primary_key=True)
    username = Column(String(64), nullable=False, unique=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    is_admin = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"

    profile_id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey("users.user_id"), nullable=False)
    audio_name = Column(String(128), nullable=False, default="默认音色")
    audio_format = Column(String(8), nullable=False)  # 'mp3' 或 'wav'
    audio_path = Column(String(256), nullable=False)
    duration_sec = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CallRecord(Base):
    __tablename__ = "call_records"

    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey("users.user_id"), nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    duration_sec = Column(Float, nullable=True)
    recording_path = Column(String(256), nullable=True)
