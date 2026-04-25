import { useEffect } from "react"

import { authAPI } from "@/lib/api"
import { useAuth } from "@/stores/auth"

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
// token 快到期 15 天内触发续期，避免 expires_at 到点前窗口太窄
const REFRESH_WINDOW_MS = 15 * 24 * 60 * 60 * 1000

export function useSessionRefresh() {
  useEffect(() => {
    let cancelled = false

    async function tick() {
      const { token, username, remember_me, expires_at } = useAuth.getState()
      if (cancelled) return
      if (!token || !username || !remember_me || expires_at === null) return
      if (expires_at - Date.now() > REFRESH_WINDOW_MS) return

      try {
        const res = await authAPI.refresh()
        if (cancelled) return
        useAuth.getState().setAuth(res.token, username, true)
      } catch {
        // 失败（如 401）交给下次请求的统一 401 handler 清 store；这里不再重复处理
      }
    }

    tick()
    const id = window.setInterval(tick, CHECK_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])
}
