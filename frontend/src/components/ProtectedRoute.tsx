import { ReactNode, useEffect } from "react"
import { Navigate, useLocation } from "react-router-dom"

import { useAuth } from "@/stores/auth"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  const expires_at = useAuth((s) => s.expires_at)
  const clear = useAuth((s) => s.clear)
  const location = useLocation()

  const expired = expires_at !== null && expires_at < Date.now()
  useEffect(() => {
    if (expired) clear()
  }, [expired, clear])

  if (!token || expired) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <>{children}</>
}
