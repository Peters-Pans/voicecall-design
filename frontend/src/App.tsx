import { Navigate, Route, Routes } from "react-router-dom"

import AppLayout from "@/components/AppLayout"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import AdminPage from "@/pages/AdminPage"
import LoginPage from "@/pages/LoginPage"
import VoicesPage from "@/pages/VoicesPage"
import BroadcastPage from "@/pages/BroadcastPage"
import CallPage from "@/pages/CallPage"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/voices" replace />} />
        <Route path="/voices" element={<VoicesPage />} />
        <Route path="/broadcast" element={<BroadcastPage />} />
        <Route path="/call" element={<CallPage />} />
        <Route path="/call/:profileId" element={<CallPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
