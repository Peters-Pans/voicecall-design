"""
Phase 4 语音通话：pipecat 管道装配。

链路 mic → VAD → STT (whisper-tiny) → LLM (OpenAI 兼容，走腾讯 GLM-5) → TTS (小米克隆) → speaker。
"""

from __future__ import annotations

import logging

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from config import settings
from services.pipecat_tts import XiaomiTTSService
from services.tts_engine import XiaomiTTSEngine

logger = logging.getLogger(__name__)


# 用音色复刻自然开场白；真实通话里 LLM 会覆盖这句
_SYSTEM_INSTRUCTION = (
    "你是一个友好的语音助手，回答要自然、口语化、简短（1-2 句），"
    "不要出现 markdown 符号或 emoji。用户说什么你就简洁地答什么。"
)
_GREETING = "你好呀，我已经在线啦，有什么想聊的？"


async def run_call_bot(
    webrtc_connection,
    tts_engine: XiaomiTTSEngine,
    profile_id: str,
    user_id: str,
    style_tags: str | None = None,
) -> None:
    """pipecat session 主循环；webrtc_connection 由 SmallWebRTCRequestHandler 传入。"""
    if not settings.LLM_API_KEY or not settings.LLM_BASE_URL or not settings.LLM_MODEL:
        raise RuntimeError("LLM 配置未注入，检查 .env 的 LLM_* 三项")

    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_out_10ms_chunks=2,
        ),
    )

    stt = WhisperSTTService(
        settings=WhisperSTTService.Settings(model=settings.WHISPER_MODEL),
        device="cpu",
        # int8 降到 ~40MB；在 ARM 1vCPU 勉强实时
        compute_type="int8",
    )

    llm = OpenAILLMService(
        api_key=settings.LLM_API_KEY,
        base_url=settings.LLM_BASE_URL,
        settings=OpenAILLMService.Settings(
            model=settings.LLM_MODEL,
            system_instruction=_SYSTEM_INSTRUCTION,
        ),
    )

    tts = XiaomiTTSService(
        engine=tts_engine,
        profile_id=profile_id,
        user_id=user_id,
        style_tags=style_tags,
    )

    context = LLMContext([{"role": "assistant", "content": _GREETING}])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def _on_connected(transport, client):
        logger.info(f"[{user_id}] 通话连接建立 profile={profile_id}")
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(transport, client):
        logger.info(f"[{user_id}] 通话连接断开")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
