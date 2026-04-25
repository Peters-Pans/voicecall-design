import { useAuth } from "@/stores/auth"

export type VoiceProfile = {
  profile_id: string
  user_id: string
  audio_name: string
  audio_format: "wav" | "mp3"
  duration_sec: number | null
  created_at: string
  updated_at: string
}

export type TTSChunk = {
  seq: number
  audio: string
  format: "wav"
  sample_rate: number
}

export class APIError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function authHeader(): Record<string, string> {
  const token = useAuth.getState().token
  return token ? { "X-Access-Token": token } : {}
}

async function handleResponse(res: Response) {
  if (res.ok) return
  let message = `HTTP ${res.status}`
  try {
    const body = await res.json()
    if (body?.detail) message = String(body.detail)
  } catch {
    // ignore
  }
  if (res.status === 401) useAuth.getState().clear()
  throw new APIError(message, res.status)
}

export async function apiJSON<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(init.headers || {}),
    },
  })
  await handleResponse(res)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export async function apiForm<T>(
  path: string,
  form: FormData,
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  const res = await fetch(path, {
    method,
    body: form,
    headers: { ...authHeader() },
  })
  await handleResponse(res)
  return (await res.json()) as T
}

export async function apiBlob(
  path: string,
  init: RequestInit = {},
): Promise<Blob> {
  const res = await fetch(path, {
    ...init,
    headers: { ...authHeader(), ...(init.headers || {}) },
  })
  await handleResponse(res)
  return await res.blob()
}

export const voicesAPI = {
  list: () => apiJSON<VoiceProfile[]>("/api/voices"),
  create: (file: File, name: string) => {
    const form = new FormData()
    form.append("file", file)
    form.append("name", name)
    return apiForm<{ profile_id: string; audio_format: string; message: string }>(
      "/api/voices",
      form,
      "POST",
    )
  },
  update: (profile_id: string, file: File) => {
    const form = new FormData()
    form.append("file", file)
    return apiForm<{ message: string; audio_format: string }>(
      `/api/voices/${profile_id}`,
      form,
      "PUT",
    )
  },
  remove: (profile_id: string) =>
    apiJSON<void>(`/api/voices/${profile_id}`, {
      method: "DELETE",
    }),
}

export type AdminUser = {
  user_id: string
  username: string
  is_admin: boolean
  created_at: string
  voice_count: number
}

export type AdminUserCreated = AdminUser & { token: string }

export const meAPI = {
  get: () => apiJSON<AdminUser>("/api/me"),
}

export const authAPI = {
  logout: () => apiJSON<void>("/api/auth/logout", { method: "POST" }),
  refresh: () =>
    apiJSON<{ token: string; token_created_at: string }>("/api/auth/refresh", {
      method: "POST",
    }),
}

export const adminAPI = {
  list: () => apiJSON<AdminUser[]>("/api/admin/users"),
  create: (username: string, is_admin: boolean) =>
    apiJSON<AdminUserCreated>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, is_admin }),
    }),
  setAdmin: (user_id: string, is_admin: boolean) =>
    apiJSON<AdminUser>(`/api/admin/users/${user_id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_admin }),
    }),
  resetToken: (user_id: string) =>
    apiJSON<{ user_id: string; token: string }>(
      `/api/admin/users/${user_id}/reset-token`,
      { method: "POST" },
    ),
  remove: (user_id: string) =>
    apiJSON<void>(`/api/admin/users/${user_id}`, { method: "DELETE" }),
}

export type TurnCredential = {
  urls: string[]
  username: string
  credential: string
  ttl: number
}

export const turnAPI = {
  getCredential: () => apiJSON<TurnCredential>("/api/turn-credential"),
}

export type CallOfferPayload = {
  sdp: string
  type: "offer" | "answer" | "pranswer" | "rollback"
  profile_id: string
  style_tags?: string | null
  pc_id?: string
  restart_pc?: boolean
}

export type CallAnswerResponse = {
  sdp: string
  type: string
  pc_id: string
}

export type CallIcePayload = {
  candidate: RTCIceCandidateInit
  pc_id: string
}

export const callAPI = {
  offer: (payload: CallOfferPayload) =>
    apiJSON<CallAnswerResponse>("/api/call/offer", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendIce: (payload: CallIcePayload) =>
    apiJSON<{ status: string }>("/api/call/ice", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
}

export const ttsAPI = {
  synthesize: (profile_id: string, text: string, style_tags?: string) =>
    apiBlob("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id, text, style_tags }),
    }),
  streamSynthesize: async function* (
    profile_id: string,
    text: string,
    style_tags?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<
    | TTSChunk
    | { done: true; ok?: boolean; total: number; error?: string }
    | { error: string; seq?: number }
  > {
    const res = await fetch("/api/tts/stream", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ profile_id, text, style_tags }),
    })
    await handleResponse(res)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        yield JSON.parse(line)
      }
    }
    const tail = buf.trim()
    if (tail) yield JSON.parse(tail)
  },
}
