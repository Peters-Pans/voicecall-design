import { FormEvent, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Mic2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/stores/auth"
import { APIError } from "@/lib/api"

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuth((s) => s.setAuth)
  const [username, setUsername] = useState("")
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !token.trim()) {
      toast.error("请填写用户名和访问令牌")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/me", {
        headers: { "X-Access-Token": token.trim() },
      })
      if (res.status === 401 || res.status === 403) {
        throw new APIError("令牌无效或已失效", res.status)
      }
      if (!res.ok) {
        throw new APIError(`服务器响应异常 (HTTP ${res.status})`, res.status)
      }
      const me = (await res.json()) as { username?: string }
      setAuth(token.trim(), me.username ?? username.trim())
      toast.success(`欢迎回来，${me.username ?? username.trim()}`)
      navigate("/voices", { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "登录失败"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center space-y-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <Mic2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">VoiceClone</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              音色克隆 · 文本播报 · 语音通话
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              placeholder="注册时使用的用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">访问令牌</Label>
            <Input
              id="token"
              type="password"
              placeholder="tk-..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              令牌由管理员发放，仅显示一次，请妥善保存
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "验证中..." : "登录"}
          </Button>
        </form>
      </div>
    </main>
  )
}
