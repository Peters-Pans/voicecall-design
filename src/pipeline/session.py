"""
通话会话管理 — 状态机。

设计要点:
1. 每个用户一个会话，独立状态
2. 状态流转: idle → connecting → active → ending → idle
3. 管理 WebRTC PeerConnection 生命周期
"""

import asyncio
import logging
from enum import Enum
from typing import Optional

from webrtc.audio_track import TTSOutputTrack, AudioPipeline

logger = logging.getLogger(__name__)


class CallState(str, Enum):
    IDLE = "idle"
    CONNECTING = "connecting"
    ACTIVE = "active"
    ENDING = "ending"


class CallSession:
    """单个用户的通话会话。"""

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.state = CallState.IDLE
        self.pipeline: Optional[AudioPipeline] = None
        self._started_at: Optional[float] = None
        self._ended_at: Optional[float] = None

    async def start(self):
        """开始通话。"""
        if self.state != CallState.IDLE:
            raise RuntimeError(f"无法开始通话，当前状态: {self.state}")

        self.state = CallState.CONNECTING
        self.pipeline = AudioPipeline(user_id=self.user_id)
        self._started_at = asyncio.get_event_loop().time()

    async def activate(self):
        """通话激活 (WebRTC 连接建立后)。"""
        if self.state != CallState.CONNECTING:
            raise RuntimeError(f"无法激活，当前状态: {self.state}")
        self.state = CallState.ACTIVE
        logger.info(f"[{self.user_id}] 通话已激活")

    async def end(self):
        """结束通话。"""
        if self.state in (CallState.IDLE, CallState.ENDING):
            return

        self.state = CallState.ENDING
        self._ended_at = asyncio.get_event_loop().time()

        if self.pipeline:
            await self.pipeline.output_track.stop()

        duration = self._ended_at - self._started_at if self._started_at else 0
        logger.info(f"[{self.user_id}] 通话结束，时长: {duration:.1f}s")

        self.state = CallState.IDLE
        self.pipeline = None


class SessionManager:
    """
    全局会话管理器。
    维护所有活跃会话。
    """

    def __init__(self):
        self._sessions: dict[str, CallSession] = {}

    def get_or_create(self, user_id: str) -> CallSession:
        if user_id not in self._sessions:
            self._sessions[user_id] = CallSession(user_id)
        return self._sessions[user_id]

    def get(self, user_id: str) -> Optional[CallSession]:
        return self._sessions.get(user_id)

    async def end_all(self):
        for session in self._sessions.values():
            if session.state != CallState.IDLE:
                await session.end()

    def get_active_sessions(self) -> list[CallSession]:
        return [
            s for s in self._sessions.values()
            if s.state == CallState.ACTIVE
        ]
