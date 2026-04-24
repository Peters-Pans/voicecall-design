import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"

import App from "@/App"
import "@/index.css"

// preview mock 只在 Vite dev 构建中注入；生产构建 tree-shake 整块移除
if (import.meta.env.DEV) {
  const { installPreviewMode } = await import("@/lib/previewMock")
  installPreviewMode()
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

const root = document.getElementById("root")!

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="top-center" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
