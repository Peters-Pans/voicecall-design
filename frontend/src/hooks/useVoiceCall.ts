/**
 * WebRTC 通话生命周期 hook：协调 getUserMedia + RTCPeerConnection + pipecat 信令。
 *
 * 后端签约（参见 src/api/call.py）：
 *   POST  /api/call/offer  {sdp, type, profile_id, style_tags?} -> {sdp, type, pc_id}
 *   PATCH /api/call/ice    {candidate, pc_id}
 *
 * 用法：
 *   const call = useVoiceCall()
 *   call.start({ profileId, styleTags })   // 异步拨号
 *   call.hangup()                          // 主动挂断
 *   call.toggleMute()                      // 静音/取消静音
 *   <audio ref={call.remoteAudioRef} />    // 远端音频 sink
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { APIError, callAPI, turnAPI } from "@/lib/api"

export type CallStatus =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error"

export type StartOptions = {
  profileId: string
  styleTags?: string | null
}

type UseVoiceCallReturn = {
  status: CallStatus
  errorMessage: string | null
  muted: boolean
  remoteAudioRef: React.RefObject<HTMLAudioElement>
  start: (opts: StartOptions) => Promise<void>
  hangup: () => void
  toggleMute: () => void
}

export function useVoiceCall(): UseVoiceCallReturn {
  const [status, setStatus] = useState<CallStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pcIdRef = useRef<string | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const endedRef = useRef(false)

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.ontrack = null
      pcRef.current.onicecandidate = null
      pcRef.current.onconnectionstatechange = null
      try {
        pcRef.current.close()
      } catch {
        // ignore
      }
      pcRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    pcIdRef.current = null
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null
    }
  }, [])

  const hangup = useCallback(() => {
    endedRef.current = true
    cleanup()
    setStatus("ended")
  }, [cleanup])

  useEffect(() => {
    return () => {
      endedRef.current = true
      cleanup()
    }
  }, [cleanup])

  const start = useCallback(
    async ({ profileId, styleTags }: StartOptions) => {
      endedRef.current = false
      setErrorMessage(null)
      setMuted(false)

      try {
        setStatus("requesting-mic")
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        })
        if (endedRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        // TURN 可选；没有就走 STUN only
        let iceServers: RTCIceServer[] = [
          { urls: ["stun:stun.l.google.com:19302"] },
        ]
        try {
          const cred = await turnAPI.getCredential()
          iceServers = [
            {
              urls: cred.urls,
              username: cred.username,
              credential: cred.credential,
            },
          ]
        } catch (e) {
          if (e instanceof APIError && e.status === 503) {
            // TURN 未配置：只用 STUN。3G/对称 NAT 下可能连不通，UI 侧给出提示。
          } else {
            throw e
          }
        }

        const pc = new RTCPeerConnection({ iceServers })
        pcRef.current = pc

        pc.addTransceiver("audio", { direction: "sendrecv" })
        stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream))

        pc.ontrack = (event) => {
          const [remoteStream] = event.streams
          if (remoteAudioRef.current && remoteStream) {
            remoteAudioRef.current.srcObject = remoteStream
            remoteAudioRef.current.play().catch(() => {
              // autoplay 被拒，等用户交互后再试；UI 侧可暴露一个「播放」按钮兜底
            })
          }
        }

        pc.onicecandidate = async (event) => {
          if (!event.candidate || !pcIdRef.current) return
          const c = event.candidate
          try {
            await callAPI.sendIce({
              pc_id: pcIdRef.current,
              candidates: [
                {
                  candidate: c.candidate,
                  sdp_mid: c.sdpMid ?? "",
                  sdp_mline_index: c.sdpMLineIndex ?? 0,
                },
              ],
            })
          } catch {
            // 后端已保证幂等，丢一次 candidate 不致命
          }
        }

        pc.onconnectionstatechange = () => {
          if (endedRef.current) return
          const s = pc.connectionState
          if (s === "connected") {
            setStatus("connected")
          } else if (s === "disconnected") {
            setStatus("reconnecting")
          } else if (s === "failed" || s === "closed") {
            cleanup()
            setStatus("ended")
          }
        }

        setStatus("connecting")
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        const answer = await callAPI.offer({
          sdp: offer.sdp ?? "",
          type: offer.type,
          profile_id: profileId,
          style_tags: styleTags ?? null,
        })

        if (endedRef.current) {
          cleanup()
          return
        }

        pcIdRef.current = answer.pc_id
        await pc.setRemoteDescription({
          type: answer.type as RTCSdpType,
          sdp: answer.sdp,
        })
      } catch (err) {
        cleanup()
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "通话启动失败"
        setErrorMessage(msg)
        setStatus("error")
      }
    },
    [cleanup],
  )

  const toggleMute = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? []
    if (!tracks.length) return
    const next = !muted
    tracks.forEach((t) => {
      t.enabled = !next
    })
    setMuted(next)
  }, [muted])

  return {
    status,
    errorMessage,
    muted,
    remoteAudioRef,
    start,
    hangup,
    toggleMute,
  }
}
