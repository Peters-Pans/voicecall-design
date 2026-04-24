"""
WebRTC 音频处理 — aiortc 自定义 AudioTrack。

设计要点:
1. 自定义 AudioStreamTrack 用于发送 TTS 生成的音频
2. 将 numpy int16 PCM 转换为 aiortc AudioFrame
3. 支持 48kHz 16bit mono (WebRTC Opus 标准格式)
"""

import asyncio
import logging
from collections import deque

import numpy as np
from aiortc import AudioStreamTrack
from av import AudioFrame, AudioResampler

logger = logging.getLogger(__name__)


class TTSOutputTrack(AudioStreamTrack):
    """
    自定义 WebRTC AudioTrack，用于发送 TTS 生成的音频。
    
    使用方式:
        track = TTSOutputTrack()
        # 在其他协程中:
        await track.write(pcm_data)  # pcm_data: np.ndarray int16
    """

    def __init__(self, sample_rate: int = 48000):
        super().__init__()
        self.sample_rate = sample_rate
        self._queue: deque[np.ndarray] = deque()
        self._frame_size = sample_rate // 50  # 20ms per frame at 48kHz = 960 samples
        self._buffer = np.empty(0, dtype=np.int16)
        self._ended = False

    async def write(self, pcm_data: np.ndarray):
        """
        将 PCM 数据写入发送队列。
        
        Args:
            pcm_data: int16 numpy array, 48kHz mono
        """
        if self._ended:
            return
        self._queue.append(pcm_data)

    async def recv(self) -> AudioFrame:
        """
        aiortc 调用此方法获取下一帧音频。
        必须按时返回 AudioFrame，否则 WebRTC 会判定连接断开。
        """
        # 从队列中获取数据
        while len(self._buffer) < self._frame_size:
            if self._queue:
                chunk = self._queue.popleft()
                self._buffer = np.concatenate([self._buffer, chunk])
            else:
                # 无数据: 发送静音帧 (避免 WebRTC 断开)
                silence = np.zeros(self._frame_size, dtype=np.int16)
                frame = AudioFrame(
                    format="s16",
                    layout="mono",
                    samples=self._frame_size,
                )
                frame.planes[0].update(silence.tobytes())
                frame.sample_rate = self.sample_rate
                await asyncio.sleep(self._frame_size / self.sample_rate)
                return frame

        # 提取一帧
        frame_data = self._buffer[: self._frame_size]
        self._buffer = self._buffer[self._frame_size :]

        frame = AudioFrame(
            format="s16",
            layout="mono",
            samples=self._frame_size,
        )
        frame.planes[0].update(frame_data.tobytes())
        frame.sample_rate = self.sample_rate

        return frame

    async def stop(self):
        self._ended = True
        super().stop()


class AudioPipeline:
    """
    完整的音频处理管线:
    WebRTC 接收 → VAD 切分 → STT → LLM → TTS → WebRTC 发送
    """

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.output_track = TTSOutputTrack()
        self._speech_buffer: list[np.ndarray] = []
        self._vad_active = False
        self._running = False

        # 这些在实际中通过依赖注入传入
        self._stt_engine = None  # STTEngine
        self._llm_engine = None  # LLMEngine
        self._tts_engine = None  # XiaomiTTSEngine
        self._voice_service = None  # VoiceService

    async def on_audio_frame(self, frame: AudioFrame):
        """
        接收来自用户的音频帧。
        """
        # 1. 提取 PCM 数据
        pcm = np.frombuffer(frame.planes[0].to_bytes(), dtype=np.int16)

        # 2. VAD 检测 (简化版: 能量阈值)
        energy = np.mean(np.abs(pcm.astype(np.float32)))
        speech_detected = energy > 500  # 阈值需实测调整

        if speech_detected:
            self._vad_active = True
            self._speech_buffer.append(pcm)
        elif self._vad_active:
            # VAD 结束 → 触发 STT
            self._vad_active = False
            await self._handle_speech_end()

    async def _handle_speech_end(self):
        """用户说完话，触发 STT → LLM → TTS 管线。"""
        if not self._speech_buffer:
            return

        # 拼接音频
        audio_data = np.concatenate(self._speech_buffer)
        self._speech_buffer.clear()

        try:
            # STT
            text = await self._stt_engine.transcribe(audio_data)
            if not text.strip():
                return

            logger.info(f"[{self.user_id}] STT: {text}")

            # LLM (流式)
            async for chunk in self._llm_engine.chat_stream(
                text=text, user_id=self.user_id
            ):
                # TTS (逐句合成)
                if self._is_sentence_end(chunk):
                    pcm = await self._tts_engine.synthesize(
                        text=chunk,
                        profile_id=self._get_profile_id(),
                        user_id=self.user_id,
                    )
                    await self.output_track.write(pcm)

        except Exception as e:
            logger.error(f"[{self.user_id}] 音频管线错误: {e}")

    def _is_sentence_end(self, text: str) -> bool:
        """判断文本是否为完整句子 (以标点结尾)。"""
        return any(text.endswith(p) for p in ["。", "！", "？", ".", "!", "?"])

    def _get_profile_id(self) -> str:
        """获取用户当前使用的音色档案 ID。"""
        # 实际从数据库/配置读取
        return ""

    @property
    def is_running(self) -> bool:
        return self._running
