"""
音频工具函数。

设计要点:
1. WAV bytes ↔ PCM int16 numpy array 转换
2. 重采样 (scipy.signal.resample_poly)
3. 音量归一化
"""

import io
import logging

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

logger = logging.getLogger(__name__)


def wav_bytes_to_pcm(
    wav_bytes: bytes,
    target_sr: int = 24000,
) -> np.ndarray:
    """
    WAV 字节 → PCM int16 numpy array。
    
    Args:
        wav_bytes: WAV 格式音频字节
        target_sr: 期望的采样率 (如果不匹配会自动重采样)
        
    Returns:
        int16 numpy array, target_sr mono
    """
    buf = io.BytesIO(wav_bytes)
    sr, data = wavfile.read(buf)

    # 转 mono
    if data.ndim > 1:
        data = data.mean(axis=1).astype(data.dtype)

    # 转 int16：float 样本按 [-1, 1] 规范，溢出时先 clip 再转，避免 int16 wrap-around
    if data.dtype != np.int16:
        if data.dtype in (np.float32, np.float64):
            data = np.clip(data * 32767, -32768, 32767).astype(np.int16)
        else:
            data = data.astype(np.int16)

    # 重采样
    if sr != target_sr:
        data = resample_poly(data, up=target_sr, down=sr).astype(np.int16)

    return data


def pcm_to_wav_bytes(
    pcm: np.ndarray,
    sample_rate: int = 48000,
) -> bytes:
    """
    PCM int16 numpy array → WAV 字节。
    
    Args:
        pcm: int16 numpy array
        sample_rate: 采样率
        
    Returns:
        WAV 格式音频字节
    """
    buf = io.BytesIO()
    wavfile.write(buf, sample_rate, pcm)
    return buf.getvalue()


def normalize_audio(pcm: np.ndarray, target_peak: float = 0.9) -> np.ndarray:
    """
    音频音量归一化。
    
    Args:
        pcm: int16 numpy array
        target_peak: 目标峰值 (0.0 - 1.0)
        
    Returns:
        归一化后的 int16 numpy array
    """
    float_pcm = pcm.astype(np.float32)
    peak = np.max(np.abs(float_pcm))
    if peak == 0:
        return pcm
    
    scale = (target_peak * 32767) / peak
    normalized = (float_pcm * scale).clip(-32768, 32767).astype(np.int16)
    return normalized


def remove_silence(
    pcm: np.ndarray,
    threshold_db: float = -40.0,
    min_silence_ms: int = 300,
    sample_rate: int = 16000,
) -> np.ndarray:
    """
    切除首尾静音。
    
    Args:
        pcm: int16 numpy array
        threshold_db: 静音阈值 (dB)
        min_silence_ms: 最小静音长度 (ms)
        sample_rate: 采样率
        
    Returns:
        切除静音后的 int16 numpy array
    """
    threshold = 32768 * (10 ** (threshold_db / 20))
    samples = pcm.astype(np.float32)
    mask = np.abs(samples) > threshold
    
    # 找第一个和最后一个非静音采样点
    indices = np.where(mask)[0]
    if len(indices) == 0:
        return pcm
    
    start = max(0, indices[0] - int(sample_rate * 0.05))  # 保留 50ms 前导
    end = min(len(pcm), indices[-1] + int(sample_rate * 0.05))  # 保留 50ms 尾随
    
    return pcm[start:end]


def calculate_rms(pcm: np.ndarray) -> float:
    """计算 RMS 音量 (dB)。"""
    float_pcm = pcm.astype(np.float32)
    rms = np.sqrt(np.mean(float_pcm ** 2))
    if rms == 0:
        return -float('inf')
    return 20 * np.log10(rms / 32768)
