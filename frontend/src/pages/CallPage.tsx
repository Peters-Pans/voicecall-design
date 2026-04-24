import { PhoneCall } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function CallPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">语音通话</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          WebRTC 实时通话（Phase 4 路线图，后端 Pipecat 接入完成后启用）
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            即将推出
          </CardTitle>
          <CardDescription>
            需要先在云服务器部署 coturn + Caddy(TLS)，并接入 Pipecat
            SmallWebRTCTransport。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• 浏览器麦克风采集（含回声消除 / 降噪）</p>
          <p>• 后端 VAD + Whisper STT + 云 LLM + 小米 TTS 流水线</p>
          <p>• Barge-in 打断、句级并行合成、音色动态切换</p>
        </CardContent>
      </Card>
    </div>
  )
}
