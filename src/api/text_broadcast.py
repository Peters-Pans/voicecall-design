"""
文本播报 HTTP API（取代旧的 WebSocket 端点）。

端点:
  POST /api/tts         — 一次性合成，返回 WAV 音频
  POST /api/tts/stream  — 长文本按句分段，NDJSON 流式返回每段 base64

为什么不用 SSE：SSE 限 GET，text 过长时 URL 会撑爆；改用 POST + StreamingResponse，
前端 fetch() 读 ReadableStream 解析 NDJSON 即可。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from api.auth import authenticate_request
from models.tables import User
from rate_limit import limiter
from services.tts_engine import XiaomiTTSEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tts", tags=["tts"])


# 单句最大字符数；小米上下文 8K tokens，中文单 token 约 1 字符，留足余量
MAX_CHARS_PER_CHUNK = 500

# 小米输出采样率
OUTPUT_SAMPLE_RATE = 24000

# 单个长文本合成请求的并发上限，既避免上游配额耗尽也保护下游解码端
STREAM_CONCURRENCY = 5

# 句子分隔符：中文/英文标点 + 段落
_SENTENCE_SPLIT = re.compile(r"([。！？!?；;\n]+)")


class TTSRequest(BaseModel):
    profile_id: str
    text: str
    style_tags: str | None = None


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
@limiter.limit("10/minute")
async def synthesize_once(
    request: Request,
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
@limiter.limit("10/minute")
async def synthesize_stream(
    request: Request,
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

    async def _synth_one(sem: asyncio.Semaphore, seq: int, chunk: str) -> tuple[int, bytes | None, str | None]:
        async with sem:
            try:
                wav = await tts_engine.synthesize_bytes(
                    text=chunk,
                    profile_id=payload.profile_id,
                    user_id=user.user_id,
                    style_tags=payload.style_tags,
                )
                return seq, wav, None
            except asyncio.CancelledError:
                raise
            except ValueError as e:
                err = str(e) if "音色" in str(e) else "TTS 合成失败"
                return seq, None, err
            except Exception:
                logger.exception(f"[{user.user_id}] 分段 {seq} 合成失败")
                return seq, None, "TTS 合成失败"

    async def _generate() -> AsyncIterator[bytes]:
        import base64

        total = len(chunks)
        sem = asyncio.Semaphore(STREAM_CONCURRENCY)
        tasks = {
            seq: asyncio.create_task(_synth_one(sem, seq, chunk))
            for seq, chunk in enumerate(chunks)
        }
        pending_results: dict[int, tuple[bytes | None, str | None]] = {}
        next_seq = 0
        errored = False
        err_msg: str | None = None

        try:
            for coro in asyncio.as_completed(list(tasks.values())):
                seq, wav, err = await coro
                pending_results[seq] = (wav, err)
                # 按 seq 顺序尽可能多地 flush
                while next_seq in pending_results:
                    got_wav, got_err = pending_results.pop(next_seq)
                    if got_err is not None:
                        errored = True
                        err_msg = got_err
                        yield (
                            json.dumps(
                                {"error": got_err, "seq": next_seq},
                                ensure_ascii=False,
                            )
                            + "\n"
                        ).encode("utf-8")
                        break
                    assert got_wav is not None
                    line = json.dumps(
                        {
                            "seq": next_seq,
                            "audio": base64.b64encode(got_wav).decode("ascii"),
                            "format": "wav",
                            "sample_rate": OUTPUT_SAMPLE_RATE,
                        },
                        ensure_ascii=False,
                    )
                    yield (line + "\n").encode("utf-8")
                    next_seq += 1

                if errored:
                    break
        finally:
            for t in tasks.values():
                if not t.done():
                    t.cancel()
            # 吃掉取消异常
            await asyncio.gather(*tasks.values(), return_exceptions=True)

        # 无论成功失败都 yield done 帧，供前端统一收口
        yield (
            json.dumps(
                {"done": True, "ok": not errored, "total": total, "error": err_msg},
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
