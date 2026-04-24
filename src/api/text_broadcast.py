"""
文本播报 HTTP API（取代旧的 WebSocket 端点）。

端点:
  POST /api/tts         — 一次性合成，返回 WAV 音频
  POST /api/tts/stream  — 长文本按句分段，NDJSON 流式返回每段 base64

为什么不用 SSE：SSE 限 GET，text 过长时 URL 会撑爆；改用 POST + StreamingResponse，
前端 fetch() 读 ReadableStream 解析 NDJSON 即可。
"""

import asyncio
import json
import logging
import re
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from api.auth import authenticate_request
from models.tables import User
from services.tts_engine import XiaomiTTSEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tts", tags=["tts"])


# 单句最大字符数；小米上下文 8K tokens，中文单 token 约 1 字符，留足余量
MAX_CHARS_PER_CHUNK = 500

# 小米输出采样率
OUTPUT_SAMPLE_RATE = 24000

# 句子分隔符：中文/英文标点 + 段落
_SENTENCE_SPLIT = re.compile(r"([。！？!?；;\n]+)")


class TTSRequest(BaseModel):
    profile_id: str
    text: str
    style_tags: Optional[str] = None


def get_tts_engine(request: Request) -> XiaomiTTSEngine:
    return request.app.state.tts_engine


def _split_text(text: str, max_chars: int = MAX_CHARS_PER_CHUNK) -> list[str]:
    """按标点分句，再按 max_chars 切片，返回非空片段列表。"""
    text = text.strip()
    if not text:
        return []

    # 先按标点切，保留分隔符
    parts = _SENTENCE_SPLIT.split(text)
    sentences: list[str] = []
    buf = ""
    for part in parts:
        if not part:
            continue
        if _SENTENCE_SPLIT.fullmatch(part):
            buf += part
            if buf.strip():
                sentences.append(buf.strip())
            buf = ""
        else:
            buf += part
    if buf.strip():
        sentences.append(buf.strip())

    # 再按 max_chars 切超长片段
    chunks: list[str] = []
    for s in sentences:
        if len(s) <= max_chars:
            chunks.append(s)
        else:
            for i in range(0, len(s), max_chars):
                chunks.append(s[i : i + max_chars])
    return chunks


@router.post("")
async def synthesize_once(
    payload: TTSRequest,
    user: User = Depends(authenticate_request),
    tts_engine: XiaomiTTSEngine = Depends(get_tts_engine),
) -> Response:
    """一次性合成（适合短文本），返回单个 WAV 音频。"""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="文本不能为空")
    if len(text) > MAX_CHARS_PER_CHUNK:
        raise HTTPException(
            status_code=400,
            detail=f"单次合成文本不能超过 {MAX_CHARS_PER_CHUNK} 字，请用 /tts/stream",
        )

    try:
        wav_bytes = await tts_engine.synthesize_bytes(
            text=text,
            profile_id=payload.profile_id,
            user_id=user.user_id,
            style_tags=payload.style_tags,
        )
    except ValueError as e:
        # ValueError 来自「音色不存在」或「上游响应格式异常」，前者 404 有信息量，
        # 后者 tts_engine 已写 log，这里不再把内部消息透传给客户端。
        msg = str(e)
        if "音色" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=502, detail="TTS 合成失败")
    except Exception:
        logger.exception(f"[{user.user_id}] TTS 合成失败")
        raise HTTPException(status_code=500, detail="TTS 合成失败")

    return Response(content=wav_bytes, media_type="audio/wav")


@router.post("/stream")
async def synthesize_stream(
    payload: TTSRequest,
    user: User = Depends(authenticate_request),
    tts_engine: XiaomiTTSEngine = Depends(get_tts_engine),
) -> StreamingResponse:
    """
    长文本流式合成，NDJSON 每行一个 JSON：
      {"seq": 0, "audio": "<base64 WAV>", "format": "wav", "sample_rate": 24000}
      {"seq": 1, "audio": "..."}
      {"done": true, "total": N}
    出错时：
      {"error": "msg"}
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="文本不能为空")

    chunks = _split_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="切分后无有效文本")

    async def _generate() -> AsyncIterator[bytes]:
        import base64

        for seq, chunk in enumerate(chunks):
            try:
                wav_bytes = await tts_engine.synthesize_bytes(
                    text=chunk,
                    profile_id=payload.profile_id,
                    user_id=user.user_id,
                    style_tags=payload.style_tags,
                )
            except ValueError as e:
                msg = str(e) if "音色" in str(e) else "TTS 合成失败"
                yield (
                    json.dumps({"error": msg, "seq": seq}, ensure_ascii=False) + "\n"
                ).encode("utf-8")
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(f"[{user.user_id}] 分段 {seq} 合成失败")
                yield (
                    json.dumps({"error": "TTS 合成失败", "seq": seq}, ensure_ascii=False) + "\n"
                ).encode("utf-8")
                return

            line = json.dumps(
                {
                    "seq": seq,
                    "audio": base64.b64encode(wav_bytes).decode("ascii"),
                    "format": "wav",
                    "sample_rate": OUTPUT_SAMPLE_RATE,
                },
                ensure_ascii=False,
            )
            yield (line + "\n").encode("utf-8")

        yield (json.dumps({"done": True, "total": len(chunks)}) + "\n").encode("utf-8")

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
