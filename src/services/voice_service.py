"""
音色档案管理 — 磁盘存原始音频 + LRU 缓存 base64 + SQLite 元数据。
"""

import base64
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from cachetools import TTLCache
from pydantic import BaseModel
from sqlalchemy import select

from models.database import get_async_session
from models.tables import VoiceProfile

logger = logging.getLogger(__name__)


class VoiceProfileResponse(BaseModel):
    profile_id: str
    user_id: str
    audio_name: str
    audio_format: str
    duration_sec: Optional[float] = None
    created_at: datetime
    updated_at: datetime


def _cache_key(user_id: str, profile_id: str) -> str:
    return f"{user_id}:{profile_id}"


class VoiceService:
    """音色档案管理。"""

    def __init__(
        self,
        data_dir: Path = Path("data/users"),
        cache_maxsize: int = 32,
        cache_ttl: int = 3600,
    ):
        self.data_dir = data_dir
        # LRU + TTL: key=user_id:profile_id, value=base64 字符串
        self._cache: TTLCache[str, str] = TTLCache(
            maxsize=cache_maxsize, ttl=cache_ttl
        )

    def _user_voice_dir(self, user_id: str) -> Path:
        return self.data_dir / user_id / "voice"

    def _profile_path(self, user_id: str, profile_id: str, audio_format: str) -> Path:
        return self._user_voice_dir(user_id) / f"{profile_id}.{audio_format}"

    async def create_profile(
        self,
        user_id: str,
        audio_bytes: bytes,
        audio_format: str,
        audio_name: str = "默认音色",
    ) -> VoiceProfileResponse:
        if audio_format not in ("mp3", "wav"):
            raise ValueError(f"不支持的音频格式: {audio_format}")

        profile_id = f"vp-{uuid.uuid4().hex[:8]}"

        voice_dir = self._user_voice_dir(user_id)
        voice_dir.mkdir(parents=True, exist_ok=True)

        profile_path = self._profile_path(user_id, profile_id, audio_format)
        profile_path.write_bytes(audio_bytes)

        now = datetime.utcnow()
        async with get_async_session() as session:
            profile = VoiceProfile(
                profile_id=profile_id,
                user_id=user_id,
                audio_name=audio_name,
                audio_format=audio_format,
                audio_path=str(profile_path),
                created_at=now,
                updated_at=now,
            )
            session.add(profile)
            await session.commit()

        self._cache[_cache_key(user_id, profile_id)] = base64.b64encode(audio_bytes).decode("ascii")

        logger.info(f"创建音色档案: profile_id={profile_id}, user_id={user_id}, format={audio_format}")

        return VoiceProfileResponse(
            profile_id=profile_id,
            user_id=user_id,
            audio_name=audio_name,
            audio_format=audio_format,
            created_at=now,
            updated_at=now,
        )

    async def get_reference_audio(
        self, profile_id: str, user_id: str
    ) -> Optional[tuple[str, str]]:
        """返回 (base64_audio, audio_format)，归属不匹配返回 None。"""
        key = _cache_key(user_id, profile_id)

        async with get_async_session() as session:
            result = await session.execute(
                select(VoiceProfile).where(
                    VoiceProfile.profile_id == profile_id,
                    VoiceProfile.user_id == user_id,
                )
            )
            profile = result.scalar_one_or_none()

        if not profile:
            logger.warning(
                f"音色档案不存在或不属于该用户: profile_id={profile_id}, user_id={user_id}"
            )
            return None

        if key in self._cache:
            return self._cache[key], profile.audio_format

        profile_path = Path(profile.audio_path)
        if not profile_path.exists():
            logger.error(f"音色文件丢失: {profile_path}")
            return None

        audio_b64 = base64.b64encode(profile_path.read_bytes()).decode("ascii")
        self._cache[key] = audio_b64
        return audio_b64, profile.audio_format

    async def list_profiles(self, user_id: str) -> list[VoiceProfileResponse]:
        async with get_async_session() as session:
            result = await session.execute(
                select(VoiceProfile)
                .where(VoiceProfile.user_id == user_id)
                .order_by(VoiceProfile.created_at.desc())
            )
            profiles = result.scalars().all()

        return [
            VoiceProfileResponse(
                profile_id=p.profile_id,
                user_id=p.user_id,
                audio_name=p.audio_name,
                audio_format=p.audio_format,
                duration_sec=p.duration_sec,
                created_at=p.created_at,
                updated_at=p.updated_at,
            )
            for p in profiles
        ]

    async def update_profile(
        self,
        profile_id: str,
        user_id: str,
        audio_bytes: bytes,
        audio_format: str,
    ) -> Optional[VoiceProfileResponse]:
        if audio_format not in ("mp3", "wav"):
            raise ValueError(f"不支持的音频格式: {audio_format}")

        async with get_async_session() as session:
            result = await session.execute(
                select(VoiceProfile).where(
                    VoiceProfile.profile_id == profile_id,
                    VoiceProfile.user_id == user_id,
                )
            )
            profile = result.scalar_one_or_none()

            if not profile:
                return None

            old_path = Path(profile.audio_path)
            if old_path.exists():
                backup_path = old_path.with_suffix(
                    f".backup-{int(datetime.utcnow().timestamp())}{old_path.suffix}"
                )
                shutil.copy2(old_path, backup_path)

            new_path = self._profile_path(user_id, profile_id, audio_format)
            new_path.parent.mkdir(parents=True, exist_ok=True)
            new_path.write_bytes(audio_bytes)

            if old_path != new_path and old_path.exists():
                old_path.unlink()

            profile.audio_path = str(new_path)
            profile.audio_format = audio_format
            profile.updated_at = datetime.utcnow()
            await session.commit()

            response = VoiceProfileResponse(
                profile_id=profile.profile_id,
                user_id=profile.user_id,
                audio_name=profile.audio_name,
                audio_format=profile.audio_format,
                duration_sec=profile.duration_sec,
                created_at=profile.created_at,
                updated_at=profile.updated_at,
            )

        self._cache[_cache_key(user_id, profile_id)] = base64.b64encode(audio_bytes).decode("ascii")

        logger.info(f"更新音色档案: profile_id={profile_id}")
        return response

    async def delete_profile(self, profile_id: str, user_id: str) -> bool:
        async with get_async_session() as session:
            result = await session.execute(
                select(VoiceProfile).where(
                    VoiceProfile.profile_id == profile_id,
                    VoiceProfile.user_id == user_id,
                )
            )
            profile = result.scalar_one_or_none()

            if not profile:
                return False

            profile_path = Path(profile.audio_path)
            if profile_path.exists():
                profile_path.unlink()

            await session.delete(profile)
            await session.commit()

        self._cache.pop(_cache_key(user_id, profile_id), None)

        logger.info(f"删除音色档案: profile_id={profile_id}")
        return True
