import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

const DAY_MS = 24 * 60 * 60 * 1000
// 默认 30 天，与后端 TOKEN_TTL_DAYS 一致
const DEFAULT_TTL_MS = 30 * DAY_MS
// 勾选「保持登录」后本地缓存 180 天；靠静默 refresh hook 在到期前换新 token
const REMEMBER_TTL_MS = 180 * DAY_MS

type AuthState = {
  token: string | null
  username: string | null
  expires_at: number | null
  remember_me: boolean
  setAuth: (token: string, username: string, rememberMe?: boolean) => void
  clear: () => void
  isExpired: () => boolean
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      expires_at: null,
      remember_me: false,
      setAuth: (token, username, rememberMe = false) => {
        const ttl = rememberMe ? REMEMBER_TTL_MS : DEFAULT_TTL_MS
        set({
          token,
          username,
          expires_at: Date.now() + ttl,
          remember_me: rememberMe,
        })
      },
      clear: () =>
        set({
          token: null,
          username: null,
          expires_at: null,
          remember_me: false,
        }),
      isExpired: () => {
        const exp = get().expires_at
        return exp !== null && exp < Date.now()
      },
    }),
    {
      name: "voicecall-auth",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state && state.expires_at !== null && state.expires_at < Date.now()) {
          state.token = null
          state.username = null
          state.expires_at = null
          state.remember_me = false
        }
      },
    },
  ),
)

export const REMEMBER_TTL_DAYS = 180
export const DEFAULT_TTL_DAYS = 30
