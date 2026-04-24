import { useMemo, useState } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  LogOut,
  Menu,
  Mic2,
  Radio,
  Settings,
  Shield,
  Waves,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { meAPI } from "@/lib/api"
import { useAuth } from "@/stores/auth"
import { cn } from "@/lib/utils"

type NavItem = {
  to: string
  label: string
  icon: typeof Waves
  badge?: string
}

const BASE_NAV_ITEMS: NavItem[] = [
  { to: "/voices", label: "音色管理", icon: Waves },
  { to: "/broadcast", label: "文本播报", icon: Radio },
  { to: "/call", label: "语音通话", icon: Mic2, badge: "Phase 4" },
]

const ADMIN_NAV_ITEM: NavItem = {
  to: "/admin",
  label: "用户管理",
  icon: Shield,
}

export default function AppLayout() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { username, clear } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: meAPI.get,
    staleTime: 60_000,
  })

  const navItems = useMemo<NavItem[]>(
    () => (me?.is_admin ? [...BASE_NAV_ITEMS, ADMIN_NAV_ITEM] : BASE_NAV_ITEMS),
    [me?.is_admin],
  )

  function handleLogout() {
    clear()
    qc.clear()
    toast.success("已退出登录")
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-16 items-center gap-2 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Mic2 className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            VoiceClone
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <p className="px-3 py-1">MiMo V2.5 · Token Plan</p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-2 border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="打开导航"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Mic2 className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-semibold">VoiceClone</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                    {username?.slice(0, 1).toUpperCase() ?? "?"}
                  </div>
                  <span className="hidden text-sm sm:inline">
                    {username ?? "用户"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  已登录 {username ? `· ${username}` : ""}
                </DropdownMenuLabel>
                <DropdownMenuItem disabled>
                  <Settings className="h-4 w-4" />
                  设置（稍后）
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {mobileOpen ? (
        <MobileDrawer
          items={navItems}
          onClose={() => setMobileOpen(false)}
        />
      ) : null}
    </div>
  )
}

function NavItemLink({
  item,
  onNavigate,
}: {
  item: NavItem
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )
      }
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        {item.label}
      </span>
      {item.badge ? (
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide">
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  )
}

function MobileDrawer({
  items,
  onClose,
}: {
  items: NavItem[]
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭导航"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0"
        onClick={onClose}
      />
      <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[80vw] flex-col border-r bg-background shadow-xl animate-in slide-in-from-left duration-200">
        <div className="flex h-16 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Mic2 className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              VoiceClone
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭导航"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => (
            <NavItemLink key={item.to} item={item} onNavigate={onClose} />
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <p className="px-3 py-1">MiMo V2.5 · Token Plan</p>
        </div>
      </aside>
    </div>
  )
}
