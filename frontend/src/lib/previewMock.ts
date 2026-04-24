/**
 * Preview 模式：?preview=1 / ?preview=admin 绕过登录 + 拦截 /api/* 返回假数据，
 * 用于不开后端时浏览 UI。仅在 URL 带 preview 参数时生效，完全侵入式但可一键移除。
 */

import { useAuth } from "@/stores/auth"

type MockUser = {
  user_id: string
  username: string
  is_admin: boolean
  created_at: string
  voice_count: number
}

function isoDays(ago: number) {
  const d = new Date()
  d.setDate(d.getDate() - ago)
  return d.toISOString()
}

function sampleVoices() {
  return [
    {
      profile_id: "vp-demo01a2",
      user_id: "u-preview-demo",
      audio_name: "温柔女声",
      audio_format: "wav",
      duration_sec: 38.4,
      created_at: isoDays(5),
      updated_at: isoDays(1),
    },
    {
      profile_id: "vp-demo0b3c",
      user_id: "u-preview-demo",
      audio_name: "磁性男声",
      audio_format: "mp3",
      duration_sec: 62.1,
      created_at: isoDays(12),
      updated_at: isoDays(12),
    },
    {
      profile_id: "vp-demo0d4e",
      user_id: "u-preview-demo",
      audio_name: "少年活泼",
      audio_format: "mp3",
      duration_sec: 45.8,
      created_at: isoDays(20),
      updated_at: isoDays(8),
    },
  ]
}

function sampleUsers(): MockUser[] {
  return [
    {
      user_id: "u-preview-demo",
      username: "preview",
      is_admin: true,
      created_at: isoDays(30),
      voice_count: 3,
    },
    {
      user_id: "u-alice-a1b2",
      username: "alice",
      is_admin: false,
      created_at: isoDays(14),
      voice_count: 1,
    },
    {
      user_id: "u-bob-c3d4",
      username: "bob",
      is_admin: false,
      created_at: isoDays(3),
      voice_count: 0,
    },
  ]
}

/** 返回一个 ~0.5s 的静音 WAV，够 `<audio>` 显示进度条 */
function silentWav(): ArrayBuffer {
  const sampleRate = 24000
  const samples = Math.floor(sampleRate * 0.5)
  const dataBytes = samples * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, dataBytes, true)
  return buf
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const state = {
  voices: sampleVoices(),
  users: sampleUsers(),
}

async function handle(
  url: URL,
  method: string,
  init?: RequestInit,
): Promise<Response | null> {
  const path = url.pathname

  if (path === "/api/me" && method === "GET") {
    return delay(
      json({
        user_id: "u-preview-demo",
        username: "preview",
        is_admin: true,
        created_at: isoDays(30),
        voice_count: state.voices.length,
      }),
    )
  }

  if (path === "/api/voices" && method === "GET") {
    return delay(json(state.voices))
  }

  if (path === "/api/voices" && method === "POST") {
    const id = `vp-demo${Math.random().toString(16).slice(2, 6)}`
    const created = {
      profile_id: id,
      user_id: "u-preview-demo",
      audio_name: "新建音色（预览）",
      audio_format: "wav",
      duration_sec: 30,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    state.voices = [created, ...state.voices]
    return delay(
      json({ profile_id: id, audio_format: "wav", message: "ok" }),
      400,
    )
  }

  const voiceIdMatch = path.match(/^\/api\/voices\/(vp-[a-z0-9]+)$/i)
  if (voiceIdMatch) {
    const id = voiceIdMatch[1]
    if (method === "DELETE") {
      state.voices = state.voices.filter((v) => v.profile_id !== id)
      return delay(new Response(null, { status: 204 }))
    }
    if (method === "PUT") {
      return delay(json({ message: "ok", audio_format: "wav" }))
    }
  }

  if (path === "/api/tts" && method === "POST") {
    await delay(null, 600)
    return new Response(silentWav(), {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    })
  }

  if (path === "/api/tts/stream" && method === "POST") {
    const encoder = new TextEncoder()
    const body = JSON.parse((init?.body as string) ?? "{}")
    const text = String(body.text ?? "")
    const chunks = text.split(/[。！？!?；;\n]/).filter((s) => s.trim()).slice(0, 4)
    const total = Math.max(chunks.length, 1)
    const audio = silentWav()
    const b64 = arrayBufferToBase64(audio)

    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < total; i++) {
          await delay(null, 500)
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                seq: i,
                audio: b64,
                format: "wav",
                sample_rate: 24000,
              }) + "\n",
            ),
          )
        }
        controller.enqueue(
          encoder.encode(JSON.stringify({ done: true, total }) + "\n"),
        )
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    })
  }

  if (path === "/api/admin/users" && method === "GET") {
    return delay(json(state.users))
  }

  if (path === "/api/admin/users" && method === "POST") {
    const body = JSON.parse((init?.body as string) ?? "{}")
    const fresh: MockUser = {
      user_id: `u-${body.username}-mock`,
      username: body.username,
      is_admin: !!body.is_admin,
      created_at: new Date().toISOString(),
      voice_count: 0,
    }
    state.users = [...state.users, fresh]
    return delay(
      json(
        { ...fresh, token: "mock-" + Math.random().toString(36).slice(2, 18) },
        201,
      ),
    )
  }

  const adminIdMatch = path.match(
    /^\/api\/admin\/users\/([^/]+)(?:\/(reset-token))?$/,
  )
  if (adminIdMatch) {
    const id = adminIdMatch[1]
    const sub = adminIdMatch[2]
    if (sub === "reset-token" && method === "POST") {
      return delay(
        json({
          user_id: id,
          token: "mock-" + Math.random().toString(36).slice(2, 18),
        }),
      )
    }
    if (method === "PATCH") {
      const body = JSON.parse((init?.body as string) ?? "{}")
      state.users = state.users.map((u) =>
        u.user_id === id && body.is_admin !== undefined
          ? { ...u, is_admin: body.is_admin }
          : u,
      )
      const updated = state.users.find((u) => u.user_id === id)!
      return delay(json(updated))
    }
    if (method === "DELETE") {
      state.users = state.users.filter((u) => u.user_id !== id)
      return delay(new Response(null, { status: 204 }))
    }
  }

  return null
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** 在 main.tsx 最前面调用 */
export function installPreviewMode() {
  // 双保险：host 白名单（localhost / 127.* / *preview* 子域）。生产域名不允许激活
  const host = window.location.hostname
  const allowed =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    /preview/i.test(host)
  if (!allowed) return false

  const params = new URLSearchParams(window.location.search)
  const preview = params.get("preview")
  if (!preview) return false

  useAuth.getState().setAuth("preview-token", "preview")

  const origFetch = window.fetch.bind(window)
  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? new URL(input, window.location.origin)
        : input instanceof URL
          ? input
          : new URL(input.url, window.location.origin)
    if (url.pathname.startsWith("/api/")) {
      const method = (init?.method ?? "GET").toUpperCase()
      const res = await handle(url, method, init)
      if (res) return res
      return new Response(
        JSON.stringify({ detail: "preview mock: 未命中路由" }),
        { status: 501, headers: { "Content-Type": "application/json" } },
      )
    }
    return origFetch(input, init)
  }

  // eslint-disable-next-line no-console
  console.info(
    "%c[preview] 已激活预览模式，/api/* 返回 mock 数据，无需后端",
    "background:#222;color:#ffd;padding:2px 6px;border-radius:3px",
  )
  return true
}
