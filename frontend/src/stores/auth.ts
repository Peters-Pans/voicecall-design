import { create } from "zustand"
import { persist } from "zustand/middleware"

type AuthState = {
  token: string | null
  username: string | null
  setAuth: (token: string, username: string) => void
  clear: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      username: null,
      setAuth: (token, username) => set({ token, username }),
      clear: () => set({ token: null, username: null }),
    }),
    { name: "voicecall-auth" },
  ),
)
