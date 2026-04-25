/**
 * 把多段 RIFF/WAVE blob 合并为一个 WAV。
 *
 * 小米 TTS 输出固定为 24kHz / mono / 16-bit PCM（见 services/tts_engine.py 注释）。
 * 解析每段 WAV 找到 `fmt `/`data` chunk，校验格式完全一致后拼 PCM，重建 header。
 */

import { encodeWavBlob } from "./wav"

type ParsedWav = {
  audioFormat: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  pcm: Uint8Array
}

function parseWav(buf: ArrayBuffer): ParsedWav {
  const view = new DataView(buf)
  if (buf.byteLength < 44) throw new Error("WAV 数据过短")

  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  )
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  )
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("非 WAV 数据")

  let offset = 12
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let pcm: Uint8Array | null = null

  while (offset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
    const size = view.getUint32(offset + 4, true)
    const bodyStart = offset + 8

    if (id === "fmt ") {
      fmt = {
        audioFormat: view.getUint16(bodyStart, true),
        channels: view.getUint16(bodyStart + 2, true),
        sampleRate: view.getUint32(bodyStart + 4, true),
        bitsPerSample: view.getUint16(bodyStart + 14, true),
      }
    } else if (id === "data") {
      pcm = new Uint8Array(buf, bodyStart, size)
      break
    }
    // RIFF chunk 按偶数字节对齐
    offset = bodyStart + size + (size % 2)
  }

  if (!fmt || !pcm) throw new Error("WAV 缺少 fmt / data chunk")
  return { ...fmt, pcm }
}

export async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) throw new Error("无可合并的段")
  if (blobs.length === 1) return blobs[0]

  const parsed: ParsedWav[] = []
  for (const b of blobs) {
    parsed.push(parseWav(await b.arrayBuffer()))
  }

  const first = parsed[0]
  for (const p of parsed.slice(1)) {
    if (
      p.audioFormat !== first.audioFormat ||
      p.channels !== first.channels ||
      p.sampleRate !== first.sampleRate ||
      p.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("各段音频参数不一致，无法合并")
    }
  }

  const totalPcm = parsed.reduce((sum, p) => sum + p.pcm.byteLength, 0)
  const merged = new Uint8Array(totalPcm)
  let cursor = 0
  for (const p of parsed) {
    merged.set(p.pcm, cursor)
    cursor += p.pcm.byteLength
  }

  return encodeWavBlob(merged, first.sampleRate, first.channels, first.bitsPerSample)
}
