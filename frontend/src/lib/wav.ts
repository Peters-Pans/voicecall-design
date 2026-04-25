/**
 * 共享 WAV 编码 util。负责把 PCM 数据 + 格式参数包成 RIFF/WAVE Blob。
 *
 * wavMerge.ts（合并多段 TTS WAV）和 useAudioRecorder.ts（录音转 WAV）共用。
 */

function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
}

/**
 * 把 PCM 字节流（已经是目标 bitsPerSample/channels 排布）封装为 WAV Blob。
 *
 * @param pcm        PCM 字节，长度必须是 channels*bitsPerSample/8 的整数倍
 * @param sampleRate 采样率，如 24000 / 48000
 * @param channels   声道数，默认 1
 * @param bitsPerSample 量化位数，默认 16
 */
export function encodeWavBlob(
  pcm: Uint8Array,
  sampleRate: number,
  channels: number = 1,
  bitsPerSample: number = 16,
): Blob {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const headerSize = 44
  const out = new ArrayBuffer(headerSize + pcm.byteLength)
  const view = new DataView(out)

  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeString(view, 8, "WAVE")
  writeString(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // audioFormat = 1 (PCM)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, "data")
  view.setUint32(40, pcm.byteLength, true)

  new Uint8Array(out).set(pcm, headerSize)
  return new Blob([out], { type: "audio/wav" })
}

/**
 * Float32 PCM（[-1, 1] 范围）→ Int16 PCM 字节流。
 */
export function float32ToInt16Bytes(float32: Float32Array): Uint8Array {
  const out = new Uint8Array(float32.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(i * 2, s, true)
  }
  return out
}
