import { PhoneCall, Construction } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function CallPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center md:p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Construction className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">语音通话尚未上线</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          WebRTC 实时通话属于 Phase 4 路线图，后端 Pipecat + coturn 接入完成后启用。
        </p>
      </div>
      <Card className="w-full text-left">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4" />
            上线前需要准备
          </CardTitle>
          <CardDescription>先在服务器部署以下组件，再打开此入口。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• coturn（STUN/TURN）+ Caddy TLS 反代</p>
          <p>• 后端接入 Pipecat SmallWebRTCTransport + VAD + STT + LLM + 小米 TTS</p>
          <p>• 浏览器端麦克风采集（回声消除 / 降噪）+ Opus 编码</p>
        </CardContent>
      </Card>
    </div>
  )
}
