import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, Loader2, Play, Square, Waves, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ttsAPI, voicesAPI, type VoiceProfile } from "@/lib/api"
import { mergeWavBlobs } from "@/lib/wavMerge"

const SHORT_LIMIT = 500

const STYLE_GROUPS: { label: string; options: string[] }[] = [
  { label: "语速", options: ["快速", "慢速", "极慢"] },
  {
    label: "情绪",
    options: ["开心", "悲伤", "温柔", "严肃", "撒娇", "调侃", "愤怒", "压抑"],
  },
  { label: "音量", options: ["低声", "正常", "呼喊"] },
  { label: "语气", options: ["急促", "舒缓"] },
]

type Segment = {
  seq: number
  url: string
  blob: Blob
}

function composeStyleTags(
  selections: Record<string, string>,
  extra: string,
): string {
  const picked = Object.values(selections).filter(Boolean)
  const trimmed = extra.trim()
  return [...picked, ...(trimmed ? [trimmed] : [])].join(" ")
}

export default function BroadcastPage() {
  const { data: voices = [], isLoading: voicesLoading } = useQuery({
    queryKey: ["voices"],
    queryFn: voicesAPI.list,
  })

  const [profileId, setProfileId] = useState<string>("")
  const [text, setText] = useState("")
  const [styleSelections, setStyleSelections] = useState<
    Record<string, string>
  >({})
  const [styleExtra, setStyleExtra] = useState("")
  const [running, setRunning] = useState(false)
  const [segments, setSegments] = useState<Segment[]>([])
  const [doneCount, setDoneCount] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 跟踪已 createObjectURL 的 blob，unmount 时统一 revoke，避免内存泄漏
  const liveUrlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!profileId && voices.length > 0) setProfileId(voices[0].profile_id)
  }, [voices, profileId])

  useEffect(() => {
    const urls = liveUrlsRef.current
    return () => {
      abortRef.current?.abort()
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
  }, [])

  const isLong = text.trim().length > SHORT_LIMIT
  const currentProfile = useMemo<VoiceProfile | undefined>(
    () => voices.find((v) => v.profile_id === profileId),
    [voices, profileId],
  )

  function registerUrl(url: string) {
    liveUrlsRef.current.add(url)
    return url
  }

  function clearSegments() {
    liveUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    liveUrlsRef.current.clear()
    setSegments([])
    setDoneCount(0)
  }

  async function runShort() {
    if (!currentProfile) {
      toast.error("请先选择音色")
      return
    }
    clearSegments()
    setRunning(true)
    try {
      const blob = await ttsAPI.synthesize(
        currentProfile.profile_id,
        text.trim(),
        composeStyleTags(styleSelections, styleExtra) || undefined,
      )
      const url = registerUrl(URL.createObjectURL(blob))
      setSegments([{ seq: 0, url, blob }])
      setDoneCount(1)
      queueMicrotask(() => audioRef.current?.play().catch(() => {}))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "合成失败")
    } finally {
      setRunning(false)
    }
  }

  async function runLong() {
    if (!currentProfile) {
      toast.error("请先选择音色")
      return
    }
    clearSegments()
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const iter = ttsAPI.streamSynthesize(
        currentProfile.profile_id,
        text.trim(),
        composeStyleTags(styleSelections, styleExtra) || undefined,
        controller.signal,
      )
      let firstPlayed = false
      for await (const evt of iter) {
        if ("done" in evt) {
          if ((evt as { ok?: boolean }).ok === false) {
            toast.error(
              (evt as { error?: string }).error ?? "部分段合成失败",
            )
          } else {
            toast.success(`合成完成：${evt.total} 段`)
          }
          break
        }
        if ("error" in evt) {
          toast.error(evt.error)
          break
        }
        const blob = await base64ToBlob(evt.audio, "audio/wav")
        const url = registerUrl(URL.createObjectURL(blob))
        setSegments((prev) => [...prev, { seq: evt.seq, url, blob }])
        setDoneCount((c) => c + 1)
        if (!firstPlayed) {
          firstPlayed = true
          queueMicrotask(() => {
            const a = audioRef.current
            if (a) {
              a.src = url
              a.play().catch(() => {})
            }
          })
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        toast.error(e instanceof Error ? e.message : "合成失败")
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function handleRun() {
    if (!text.trim()) {
      toast.error("请输入要合成的文本")
      return
    }
    if (isLong) runLong()
    else runShort()
  }

  function handleStop() {
    abortRef.current?.abort()
    setRunning(false)
  }

  function handleEnded() {
    const a = audioRef.current
    if (!a) return
    const current = segments.findIndex((s) => s.url === a.src)
    const next = segments[current + 1]
    if (next) {
      a.src = next.url
      a.play().catch(() => {})
    }
  }

  function buildFileName(seq: number | "merged") {
    const name = currentProfile?.audio_name ?? "voice"
    const safeName = name.replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    const suffix = seq === "merged" ? "merged" : `seg${String(seq).padStart(2, "0")}`
    return `voice-${safeName}-${ts}-${suffix}.wav`
  }

  const [merging, setMerging] = useState(false)

  async function handleDownloadMerged() {
    if (segments.length === 0) return
    setMerging(true)
    try {
      const merged = await mergeWavBlobs(segments.map((s) => s.blob))
      const url = URL.createObjectURL(merged)
      const a = document.createElement("a")
      a.href = url
      a.download = buildFileName("merged")
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // 给浏览器一小段时间真正发起下载后再回收
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "合并失败")
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">文本播报</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          粘贴文本生成音频 · 短文本一次返回，长文本自动按句流式合成
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">合成</CardTitle>
            <CardDescription>
              {voicesLoading
                ? "加载音色中..."
                : voices.length === 0
                  ? "还没有音色档案，请先到「音色管理」上传"
                  : isLong
                    ? `超过 ${SHORT_LIMIT} 字，将自动流式合成`
                    : `短文本，单次合成返回`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>使用音色</Label>
              <div className="flex flex-wrap gap-2">
                {voices.map((v) => (
                  <button
                    key={v.profile_id}
                    type="button"
                    onClick={() => setProfileId(v.profile_id)}
                    disabled={running}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      profileId === v.profile_id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:border-primary/40",
                    )}
                  >
                    <Waves className="mr-1 inline h-3 w-3" />
                    {v.audio_name}
                  </button>
                ))}
                {voices.length === 0 && !voicesLoading ? (
                  <span className="text-xs text-muted-foreground">
                    暂无可用音色
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="tts-text">文本</Label>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    isLong
                      ? "text-amber-600"
                      : "text-muted-foreground",
                  )}
                >
                  {text.length} 字
                </span>
              </div>
              <Textarea
                id="tts-text"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="粘贴或输入要朗读的文本..."
                disabled={running}
                className="resize-none"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>风格标签（可选）</Label>
                {Object.values(styleSelections).some(Boolean) ||
                styleExtra.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStyleSelections({})
                      setStyleExtra("")
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    disabled={running}
                  >
                    清空
                  </button>
                ) : null}
              </div>

              {STYLE_GROUPS.map((group) => (
                <div key={group.label} className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{group.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((opt) => {
                      const picked = styleSelections[group.label] === opt
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setStyleSelections((prev) => ({
                              ...prev,
                              [group.label]: picked ? "" : opt,
                            }))
                          }
                          disabled={running}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            picked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:border-primary/40 hover:bg-accent",
                          )}
                        >
                          {opt}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">其他</p>
                <input
                  id="style-extra"
                  type="text"
                  value={styleExtra}
                  onChange={(e) => setStyleExtra(e.target.value)}
                  placeholder="自定义标签，例如：东北话 / 唱歌"
                  disabled={running}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {composeStyleTags(styleSelections, styleExtra) ? (
                <p className="rounded-md bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  拼接结果：({composeStyleTags(styleSelections, styleExtra)})
                </p>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleRun}
                disabled={running || !profileId || !text.trim()}
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    合成中
                  </>
                ) : (
                  <>
                    {isLong ? (
                      <Zap className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {isLong ? "流式合成" : "开始合成"}
                  </>
                )}
              </Button>
              {running ? (
                <Button variant="outline" onClick={handleStop}>
                  <Square className="h-4 w-4" />
                  停止
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">播放</CardTitle>
            <CardDescription>
              {segments.length === 0
                ? "尚无合成结果"
                : `已生成 ${doneCount} 段`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <audio
              ref={audioRef}
              controls
              className="w-full"
              src={segments[0]?.url}
              onEnded={handleEnded}
            />
            {segments.length > 1 && !running ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadMerged}
                disabled={merging}
                className="w-full"
              >
                {merging ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    合并中
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    下载合并 WAV（{segments.length} 段）
                  </>
                )}
              </Button>
            ) : null}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {segments.map((s) => (
                <div
                  key={s.seq}
                  className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const a = audioRef.current
                      if (!a) return
                      a.src = s.url
                      a.play().catch(() => {})
                    }}
                    className="flex flex-1 items-center justify-between rounded hover:text-foreground"
                  >
                    <span className="font-mono text-muted-foreground">
                      #{String(s.seq).padStart(2, "0")}
                    </span>
                    <Play className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <a
                    href={s.url}
                    download={buildFileName(s.seq)}
                    className="ml-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="下载本段 WAV"
                  >
                    <Download className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

async function base64ToBlob(b64: string, mime: string): Promise<Blob> {
  // fetch data: URL 比手写 atob+Uint8Array 快，零 JS GC 压力
  const res = await fetch(`data:${mime};base64,${b64}`)
  return await res.blob()
}
