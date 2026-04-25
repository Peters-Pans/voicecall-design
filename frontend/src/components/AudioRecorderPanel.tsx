/**
 * 音色管理「直接录音」面板。状态机渲染：
 *   idle → recording → stopped（试听 / 重录 / 确认）→ 通过 onConfirm 把 File 交给上层。
 *
 * 录音参数与上限见 useAudioRecorder。WAV 由 lib/wav.ts 编码，文件名 `${filenameBase}-${ts}.wav`。
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Mic, RefreshCw, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAudioRecorder } from "@/hooks/useAudioRecorder"

type Props = {
  filenameBase: string
  disabled?: boolean
  onConfirm: (file: File) => void
}

function formatMs(ms: number) {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export default function AudioRecorderPanel({
  filenameBase,
  disabled,
  onConfirm,
}: Props) {
  const recorder = useAudioRecorder()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const lastUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (recorder.wavBlob) {
      const url = URL.createObjectURL(recorder.wavBlob)
      lastUrlRef.current = url
      setPreviewUrl(url)
      return () => {
        URL.revokeObjectURL(url)
        if (lastUrlRef.current === url) lastUrlRef.current = null
      }
    }
    setPreviewUrl(null)
  }, [recorder.wavBlob])

  const progressPct = useMemo(() => {
    if (recorder.maxDurationMs === 0) return 0
    return Math.min(100, (recorder.durationMs / recorder.maxDurationMs) * 100)
  }, [recorder.durationMs, recorder.maxDurationMs])

  const clipping = recorder.level > 0.95

  function handleConfirm() {
    if (!recorder.wavBlob) return
    const ts = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14)
    const safe = (filenameBase || "recording").replace(/[^\w\u4e00-\u9fa5]+/g, "_")
    const file = new File([recorder.wavBlob], `${safe}-${ts}.wav`, {
      type: "audio/wav",
    })
    onConfirm(file)
  }

  return (
    <div className="space-y-4">
      {recorder.state === "idle" || recorder.state === "requesting-mic" ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-8">
          <Button
            type="button"
            size="lg"
            className="h-16 w-16 rounded-full"
            disabled={disabled || recorder.state === "requesting-mic"}
            onClick={() => recorder.start()}
            aria-label="开始录音"
          >
            <Mic className="h-6 w-6" />
          </Button>
          <p className="text-sm text-muted-foreground">
            {recorder.state === "requesting-mic"
              ? "正在申请麦克风权限..."
              : "点击开始录音"}
          </p>
          <p className="text-xs text-muted-foreground">
            建议 30-60 秒，最长 {Math.round(recorder.maxDurationMs / 1000)} 秒
          </p>
        </div>
      ) : null}

      {recorder.state === "recording" ? (
        <div className="space-y-3 rounded-lg border py-6 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
              </span>
              <span className="text-sm font-medium">录音中</span>
            </div>
            <span className="font-mono text-sm tabular-nums">
              {formatMs(recorder.durationMs)} / {formatMs(recorder.maxDurationMs)}
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={
                clipping
                  ? "h-full bg-red-500 transition-[width] duration-75"
                  : "h-full bg-green-500 transition-[width] duration-75"
              }
              style={{ width: `${recorder.level * 100}%` }}
            />
          </div>

          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-100"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {clipping ? (
            <p className="text-xs text-red-600">
              音量过大可能削顶，请降低音量或拉远麦克风
            </p>
          ) : null}

          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant="destructive"
              onClick={() => recorder.stop()}
            >
              <Square className="h-4 w-4" />
              停止
            </Button>
          </div>
        </div>
      ) : null}

      {recorder.state === "processing" ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border py-6 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          正在处理录音...
        </div>
      ) : null}

      {recorder.state === "stopped" && recorder.wavBlob && previewUrl ? (
        <div className="space-y-3 rounded-lg border py-4 px-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>试听录音</span>
            <span>
              {formatMs(recorder.durationMs)} ·{" "}
              {(recorder.wavBlob.size / 1024).toFixed(1)} KB
            </span>
          </div>
          <audio controls src={previewUrl} className="w-full" />
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => recorder.reset()}
              disabled={disabled}
            >
              重录
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={disabled}
            >
              使用这段录音
            </Button>
          </div>
        </div>
      ) : null}

      {recorder.state === "error" ? (
        <div className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 py-4 px-4">
          <p className="text-sm text-destructive">
            {recorder.error || "录音失败"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => recorder.reset()}
          >
            重试
          </Button>
        </div>
      ) : null}
    </div>
  )
}
