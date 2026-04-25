import { useEffect, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AudioLines,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  PlayCircle,
  PhoneCall,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { voicesAPI, type VoiceProfile } from "@/lib/api"
import { useVoiceCall, type CallStatus } from "@/hooks/useVoiceCall"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: "待机中",
  "requesting-mic": "请求麦克风权限…",
  connecting: "协商连接中…",
  connected: "通话中",
  reconnecting: "重连中…",
  ended: "通话已结束",
  error: "出错了",
}

export default function CallPage() {
  const { profileId } = useParams<{ profileId: string }>()
  const navigate = useNavigate()

  const { data: voices = [], isLoading } = useQuery({
    queryKey: ["voices"],
    queryFn: voicesAPI.list,
  })

  const currentProfile = useMemo(
    () => voices.find((v) => v.profile_id === profileId) ?? null,
    [voices, profileId],
  )

  // profileId 指向了不存在的音色：无感跳回选择页
  useEffect(() => {
    if (profileId && voices.length > 0 && !currentProfile) {
      toast.error("音色不存在或已删除")
      navigate("/call", { replace: true })
    }
  }, [profileId, voices, currentProfile, navigate])

  if (!profileId) {
    return <VoicePicker voices={voices} loading={isLoading} />
  }

  if (!currentProfile) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <CallRoom profile={currentProfile} />
}

function VoicePicker({
  voices,
  loading,
}: {
  voices: VoiceProfile[]
  loading: boolean
}) {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">语音通话</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选择一个音色开始实时通话，AI 会用该音色和你自然对话
        </p>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : voices.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">还没有音色</CardTitle>
            <CardDescription>
              先去「音色管理」上传一段参考音频，再回来发起通话。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/voices")}>去上传音色</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {voices.map((v) => (
            <button
              key={v.profile_id}
              type="button"
              onClick={() => navigate(`/call/${v.profile_id}`)}
              className="group flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary hover:bg-accent"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <AudioLines className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{v.audio_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {v.audio_format.toUpperCase()}
                  {v.duration_sec ? ` · ${Math.round(v.duration_sec)}s` : ""}
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                <PhoneCall className="h-3 w-3" /> 呼叫
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CallRoom({ profile }: { profile: VoiceProfile }) {
  const navigate = useNavigate()
  const call = useVoiceCall()

  const active =
    call.status === "connected" ||
    call.status === "connecting" ||
    call.status === "requesting-mic" ||
    call.status === "reconnecting"

  useEffect(() => {
    if (call.status === "error" && call.errorMessage) {
      toast.error(call.errorMessage)
    }
  }, [call.status, call.errorMessage])

  async function handleStart() {
    await call.start({ profileId: profile.profile_id })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 md:p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.audio_name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {STATUS_LABEL[call.status]}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (active) call.hangup()
            navigate("/call")
          }}
        >
          换音色
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-6 py-10">
          <div
            className={cn(
              "flex h-28 w-28 items-center justify-center rounded-full border-4 transition-colors",
              call.status === "connected"
                ? "border-primary bg-primary/10 text-primary"
                : "border-muted bg-muted/40 text-muted-foreground",
            )}
          >
            <AudioLines
              className={cn(
                "h-10 w-10",
                call.status === "connected" && "animate-pulse",
              )}
            />
          </div>

          <audio ref={call.remoteAudioRef} autoPlay playsInline />

          <div className="flex items-center gap-3">
            {!active && call.status !== "connected" ? (
              <Button size="lg" onClick={handleStart} className="gap-2">
                <PlayCircle className="h-5 w-5" />
                开始通话
              </Button>
            ) : (
              <>
                <Button
                  variant={call.muted ? "default" : "outline"}
                  size="lg"
                  onClick={call.toggleMute}
                  disabled={call.status !== "connected"}
                  className="gap-2"
                >
                  {call.muted ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                  {call.muted ? "已静音" : "静音"}
                </Button>
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={call.hangup}
                  className="gap-2"
                >
                  <PhoneOff className="h-4 w-4" />
                  挂断
                </Button>
              </>
            )}
          </div>

          {call.status === "error" && call.errorMessage ? (
            <p className="max-w-md text-center text-sm text-destructive">
              {call.errorMessage}
            </p>
          ) : null}

          {call.status === "ended" ? (
            <p className="text-sm text-muted-foreground">
              可以再次点击「开始通话」。
            </p>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        提示：首次连接会请求麦克风权限，请在浏览器弹窗中点允许。
      </p>
    </div>
  )
}
