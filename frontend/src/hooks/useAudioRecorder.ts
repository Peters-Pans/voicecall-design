/**
 * 浏览器麦克风录音 hook：getUserMedia + MediaRecorder + AnalyserNode。
 *
 * stop() 后把录到的 webm/opus（或 mp4 兜底）通过 AudioContext.decodeAudioData
 * 解出 Float32 PCM，再下采样为 16-bit mono WAV。WAV 走 lib/wav.ts 共享编码。
 *
 * 上限 90s（≈ 8.6MB @ 48kHz）—— 后端 voices upload 限制 10MB。
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { encodeWavBlob, float32ToInt16Bytes } from "@/lib/wav"

export type RecorderState =
  | "idle"
  | "requesting-mic"
  | "recording"
  | "processing"
  | "stopped"
  | "error"

export type UseAudioRecorderReturn = {
  state: RecorderState
  durationMs: number
  level: number
  wavBlob: Blob | null
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  reset: () => void
  maxDurationMs: number
}

const MAX_DURATION_MS = 90_000
const LEVEL_INTERVAL_MS = 50
const TIMER_INTERVAL_MS = 100

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "",
]

function pickMimeType(): string {
  for (const m of MIME_CANDIDATES) {
    if (m === "") return ""
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m
    }
  }
  return ""
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecorderState>("idle")
  const [durationMs, setDurationMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [wavBlob, setWavBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)
  const levelTimerRef = useRef<number | null>(null)
  const stopResolveRef = useRef<(() => void) | null>(null)

  const releaseStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current)
      levelTimerRef.current = null
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch {
        // ignore
      }
      analyserRef.current = null
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {
        // ignore
      })
      ctxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    recorderRef.current = null
  }, [])

  const reset = useCallback(() => {
    releaseStream()
    chunksRef.current = []
    setDurationMs(0)
    setLevel(0)
    setWavBlob(null)
    setError(null)
    setState("idle")
  }, [releaseStream])

  const start = useCallback(async () => {
    setError(null)
    setWavBlob(null)
    setDurationMs(0)
    setLevel(0)
    chunksRef.current = []

    try {
      setState("requesting-mic")
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      streamRef.current = stream

      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const ctx = new AudioCtor()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      analyserRef.current = analyser

      const mimeType = pickMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data)
        }
      }

      recorder.onstop = async () => {
        try {
          setState("processing")
          const blobType = recorder.mimeType || "audio/webm"
          const merged = new Blob(chunksRef.current, { type: blobType })
          const arrayBuf = await merged.arrayBuffer()

          // decodeAudioData 不能跑在已经 close 的 context 上，开一个新的
          const decodeCtx = new AudioCtor()
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuf.slice(0))
          await decodeCtx.close().catch(() => {})

          // 多声道 → 取均值降到 mono
          const channels = audioBuffer.numberOfChannels
          const length = audioBuffer.length
          const mono = new Float32Array(length)
          if (channels === 1) {
            mono.set(audioBuffer.getChannelData(0))
          } else {
            for (let c = 0; c < channels; c++) {
              const data = audioBuffer.getChannelData(c)
              for (let i = 0; i < length; i++) mono[i] += data[i]
            }
            for (let i = 0; i < length; i++) mono[i] /= channels
          }

          const pcm = float32ToInt16Bytes(mono)
          const wav = encodeWavBlob(pcm, audioBuffer.sampleRate, 1, 16)
          setWavBlob(wav)
          setState("stopped")
        } catch (e) {
          setError(e instanceof Error ? e.message : "解码录音失败")
          setState("error")
        } finally {
          // 释放麦克风（保留 wavBlob）
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop())
            streamRef.current = null
          }
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
          if (levelTimerRef.current !== null) {
            window.clearInterval(levelTimerRef.current)
            levelTimerRef.current = null
          }
          if (analyserRef.current) {
            try {
              analyserRef.current.disconnect()
            } catch {
              // ignore
            }
            analyserRef.current = null
          }
          if (ctxRef.current) {
            ctxRef.current.close().catch(() => {})
            ctxRef.current = null
          }
          recorderRef.current = null
          if (stopResolveRef.current) {
            stopResolveRef.current()
            stopResolveRef.current = null
          }
        }
      }

      startedAtRef.current = performance.now()
      recorder.start()
      setState("recording")

      timerRef.current = window.setInterval(() => {
        const elapsed = performance.now() - startedAtRef.current
        setDurationMs(elapsed)
        if (elapsed >= MAX_DURATION_MS && recorderRef.current?.state === "recording") {
          recorderRef.current.stop()
        }
      }, TIMER_INTERVAL_MS)

      const buf = new Float32Array(analyser.fftSize)
      levelTimerRef.current = window.setInterval(() => {
        if (!analyserRef.current) return
        analyserRef.current.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        setLevel(Math.min(1, rms * 2.5))
      }, LEVEL_INTERVAL_MS)
    } catch (e) {
      releaseStream()
      const msg =
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "麦克风权限被拒绝"
            : e.name === "NotFoundError"
              ? "未找到麦克风设备"
              : e.message
          : "无法启动录音"
      setError(msg)
      setState("error")
    }
  }, [releaseStream])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== "recording") return
    await new Promise<void>((resolve) => {
      stopResolveRef.current = resolve
      recorder.stop()
    })
  }, [])

  useEffect(() => {
    return () => {
      releaseStream()
    }
  }, [releaseStream])

  return {
    state,
    durationMs,
    level,
    wavBlob,
    error,
    start,
    stop,
    reset,
    maxDurationMs: MAX_DURATION_MS,
  }
}
