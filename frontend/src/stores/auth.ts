import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

// 令牌默认 TTL 30 天，与后端 TOKEN_TTL_DAYS 一致；到期自动清空
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

type AuthState = {
  token: string | null
  username: string | null
  expires_at: number | null
  setAuth: (token: string, username: string, ttlMs?: number) => void
  clear: () => void
  isExpired: () => boolean
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      expires_at: null,
      setAuth: (token, username, ttlMs = TOKEN_TTL_MS) =>
        set({ token, username, expires_at: Date.now() + ttlMs }),
      clear: () => set({ token: null, username: null, expires_at: null }),
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
        }
      },
    },
  ),
)
