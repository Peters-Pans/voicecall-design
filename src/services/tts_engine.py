"""
小米 TTS 语音合成引擎 — 支持音色克隆。

请求格式对齐 docs/mimo-v2-5-tts-voiceclone-guide.md 官方规格：
  messages[0].role = "assistant"
  audio.format = "wav" | "mp3"
  audio.voice  = "data:{mime};base64,{b64}"
响应路径：choices[0].message.audio.data （Base64）。

注意：MiMo V2.5 TTS 官方流式尚未上线，调用都是整段返回；
上层若要「伪流式」需按句切分后并行调用。
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from dataclasses import dataclass

import httpx
import numpy as np

from services.voice_service import VoiceService
from utils.audio import wav_bytes_to_pcm

logger = logging.getLogger(__name__)


XIAOMI_SAMPLE_RATE = 24000

FORMAT_MIME = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
}

# 风格标签字符白名单：中英文字母数字 + 空格 + 常见中文标点 + 竖线分隔符
# 拒绝 '(' ')' / 换行 / 反斜杠 / 引号 — 避免破坏 "({style}){text}" 的语法边界
_STYLE_TAG_ALLOWED = re.compile(
    r"^[\w\u4e00-\u9fff\s·，、。：；！？\-_|]{0,40}$"
)


def _validate_style_tags(style_tags: str | None) -> str | None:
    if style_tags is None:
        return None
    stripped = style_tags.strip()
    if not stripped:
        return None
    if not _STYLE_TAG_ALLOWED.fullmatch(stripped):
        raise ValueError("style_tags 含非法字符或超长")
    return stripped


def _validate_wav_magic(data: bytes) -> None:
    """上游返回音频前做最基本的 RIFF/WAVE 校验，避免把错误包装成 WAV 下发。"""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("上游返回非 WAV 数据")


@dataclass
class TTSConfig:
    api_key: str
    base_url: str = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
    model: str = "mimo-v2.5-tts-voiceclone"
    timeout: float = 30.0
    max_retries: int = 3
    base_delay: float = 1.0
    output_format: str = "wav"  # 小米输出格式


class XiaomiTTSEngine:
    """小米音色克隆 TTS 引擎。"""

    def __init__(self, config: TTSConfig, voice_service: VoiceService):
        self.config = config
        self.voice_service = voice_service
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.config.timeout),
                headers={
                    "api-key": self.config.api_key,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def synthesize(
        self,
        text: str,
        profile_id: str,
        user_id: str,
        style_tags: str | None = None,
    ) -> np.ndarray:
        """
        合成音频，返回 24kHz int16 mono PCM。

        Args:
            text: 要合成的文本
            profile_id: 音色档案 ID
            user_id: 用户 ID
            style_tags: 可选风格标签，例如 "温柔 慢速"；会被拼成 "(温柔 慢速){text}"
        """
        ref = await self.voice_service.get_reference_audio(
            profile_id=profile_id, user_id=user_id
        )
        if not ref:
            raise ValueError(f"音色档案不存在或无权访问: profile_id={profile_id}")

        ref_b64, audio_format = ref
        mime = FORMAT_MIME.get(audio_format)
        if not mime:
            raise ValueError(f"不支持的参考音频格式: {audio_format}")

        safe_tags = _validate_style_tags(style_tags)
        content = f"({safe_tags}){text}" if safe_tags else text

        audio_b64 = await self._call_api(content, ref_b64, mime)
        return self._decode(audio_b64)

    async def synthesize_bytes(
        self,
        text: str,
        profile_id: str,
        user_id: str,
        style_tags: str | None = None,
    ) -> bytes:
        """合成并返回原始 WAV 字节（直接供 <audio> 播放）。"""
        ref = await self.voice_service.get_reference_audio(
            profile_id=profile_id, user_id=user_id
        )
        if not ref:
            raise ValueError(f"音色档案不存在或无权访问: profile_id={profile_id}")

        ref_b64, audio_format = ref
        mime = FORMAT_MIME.get(audio_format)
        if not mime:
            raise ValueError(f"不支持的参考音频格式: {audio_format}")

        safe_tags = _validate_style_tags(style_tags)
        content = f"({safe_tags}){text}" if safe_tags else text

        audio_b64 = await self._call_api(content, ref_b64, mime)
        wav_bytes = base64.b64decode(audio_b64)
        _validate_wav_magic(wav_bytes)
        return wav_bytes

    async def _call_api(self, text: str, ref_audio_b64: str, ref_mime: str) -> str:
        """调用小米 TTS API，返回 Base64 编码的音频数据。"""
        payload = {
            "model": self.config.model,
            "messages": [
                {
                    "role": "assistant",
                    "content": text,
                }
            ],
            "audio": {
                "format": self.config.output_format,
                "voice": f"data:{ref_mime};base64,{ref_audio_b64}",
            },
        }

        client = await self._get_client()

        last_exc: Exception | None = None
        for attempt in range(self.config.max_retries):
            try:
                resp = await client.post(self.config.base_url, json=payload)
                resp.raise_for_status()
                data = resp.json()

                # 上游偶见 HTTP 200 + 业务错误：{"error": {"code": "xxx", "message": "..."}}
                # 区分限流类（可重试）与格式类（直接拒绝）
                if isinstance(data, dict) and data.get("error"):
                    err_obj = data["error"]
                    err_code = err_obj.get("code", "") if isinstance(err_obj, dict) else ""
                    logger.warning(f"TTS 业务错误 (200 body): code={err_code} data={str(data)[:300]}")
                    if "rate" in str(err_code).lower() or "limit" in str(err_code).lower():
                        if attempt < self.config.max_retries - 1:
                            await asyncio.sleep(self.config.base_delay * (2 ** attempt))
                            continue
                    raise ValueError("TTS API 业务错误")

                try:
                    audio_b64 = data["choices"][0]["message"]["audio"]["data"]
                except (KeyError, IndexError, TypeError) as exc:
                    # 不把上游 body 带进 exception message（可能含内部错误码/hint）。
                    # 完整响应进 logger 方便排查。
                    logger.error(f"未知 TTS API 响应格式: {str(data)[:500]}")
                    raise ValueError("TTS API 返回格式异常") from exc

                if not audio_b64:
                    raise ValueError("API 返回空音频数据")
                return audio_b64

            except httpx.HTTPStatusError as e:
                last_exc = e
                if e.response.status_code == 429:
                    retry_after = e.response.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after else self.config.base_delay * (2 ** attempt)
                    logger.warning(f"TTS 限流，{delay}s 后重试")
                    if attempt < self.config.max_retries - 1:
                        await asyncio.sleep(delay)
                        continue
                raise

            except (httpx.TimeoutException, httpx.RemoteProtocolError) as e:
                last_exc = e
                delay = self.config.base_delay * (2 ** attempt)
                logger.warning(
                    f"TTS 请求失败 (attempt {attempt + 1}/{self.config.max_retries}): {e}"
                )
                if attempt < self.config.max_retries - 1:
                    await asyncio.sleep(delay)
                    continue
                raise

        raise RuntimeError("TTS 请求达到最大重试次数") from last_exc

    def _decode(self, audio_b64: str) -> np.ndarray:
        """解码 Base64 WAV → 24kHz int16 mono PCM。"""
        raw = base64.b64decode(audio_b64)
        return wav_bytes_to_pcm(raw, target_sr=XIAOMI_SAMPLE_RATE)

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
