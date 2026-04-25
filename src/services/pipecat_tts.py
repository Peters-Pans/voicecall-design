"""
Pipecat TTS 适配器：把 XiaomiTTSEngine 接进 Pipecat 管道。

Pipecat TTSService 的契约：实现 async def run_tts(text, context_id) 为 AsyncGenerator，
yield TTSAudioRawFrame(audio_bytes=PCM_int16, sample_rate, channels, context_id)。

小米 TTS 流式未上线，本实现一次性拿完 WAV 后剥 header 分帧下发；
每帧 20ms @ 24kHz int16 mono = 960 samples * 2 bytes = 1920 bytes，与 OpenAI TTS 一致。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.tts_service import TTSService

from services.tts_engine import XIAOMI_SAMPLE_RATE, XiaomiTTSEngine

logger = logging.getLogger(__name__)


# 20ms @ 24kHz int16 mono
_CHUNK_BYTES = int(XIAOMI_SAMPLE_RATE * 0.02) * 2


def _extract_pcm_from_wav(wav: bytes) -> bytes:
    """跳过 RIFF header 取 data chunk PCM。"""
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise ValueError("非 WAV 数据")
    offset = 12
    while offset + 8 <= len(wav):
        chunk_id = wav[offset : offset + 4]
        chunk_size = int.from_bytes(wav[offset + 4 : offset + 8], "little")
        body_start = offset + 8
        if chunk_id == b"data":
            return wav[body_start : body_start + chunk_size]
        offset = body_start + chunk_size + (chunk_size % 2)
    raise ValueError("WAV 缺少 data chunk")


class XiaomiTTSService(TTSService):
    """把小米克隆 TTS 当 pipecat TTSService 用。

    kwargs.sample_rate 不传时默认 24000，和小米输出对齐；若上游 transport 要求其他采样率，
    可改 pipeline 里加个 resampler，但这里简单起见固定 24k。
    """

    def __init__(
        self,
        *,
        engine: XiaomiTTSEngine,
        profile_id: str,
        user_id: str,
        style_tags: str | None = None,
        sample_rate: int = XIAOMI_SAMPLE_RATE,
        **kwargs,
    ) -> None:
        super().__init__(sample_rate=sample_rate, **kwargs)
        self._engine = engine
        self._profile_id = profile_id
        self._user_id = user_id
        self._style_tags = style_tags

    def can_generate_metrics(self) -> bool:
        return True

    async def run_tts(
        self, text: str, context_id: str
    ) -> AsyncGenerator[Frame, None]:
        text = text.strip()
        if not text:
            return

        logger.debug(f"[{self._user_id}] pipecat-tts synth: {text[:60]}")
        try:
            wav = await self._engine.synthesize_bytes(
                text=text,
                profile_id=self._profile_id,
                user_id=self._user_id,
                style_tags=self._style_tags,
            )
            pcm = _extract_pcm_from_wav(wav)
        except Exception as exc:
            logger.exception(f"[{self._user_id}] pipecat-tts 合成失败")
            yield ErrorFrame(error=f"TTS 合成失败: {exc}")
            return

        await self.start_tts_usage_metrics(text)
        await self.stop_ttfb_metrics()

        for i in range(0, len(pcm), _CHUNK_BYTES):
            chunk = pcm[i : i + _CHUNK_BYTES]
            yield TTSAudioRawFrame(
                audio=chunk,
                sample_rate=self.sample_rate,
                num_channels=1,
                context_id=context_id,
            )
