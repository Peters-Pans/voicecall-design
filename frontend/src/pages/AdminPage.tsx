import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Copy,
  KeyRound,
  Plus,
  Shield,
  ShieldOff,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { adminAPI, meAPI, type AdminUser } from "@/lib/api"
import { useAuth } from "@/stores/auth"

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("已复制到剪贴板")
  } catch {
    toast.error("复制失败，请手动选中复制")
  }
}

export default function AdminPage() {
  const qc = useQueryClient()
  const myUsername = useAuth((s) => s.username)

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: meAPI.get })

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: adminAPI.list,
    enabled: me?.is_admin === true,
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [newUser, setNewUser] = useState<{ username: string; token: string } | null>(
    null,
  )
  const [resetConfirm, setResetConfirm] = useState<AdminUser | null>(null)
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)

  const roleMut = useMutation({
    mutationFn: ({ id, admin }: { id: string; admin: boolean }) =>
      adminAPI.setAdmin(id, admin),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] })
      toast.success("角色已更新")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resetMut = useMutation({
    mutationFn: (id: string) => adminAPI.resetToken(id),
    onSuccess: (res) => {
      setResetToken(res.token)
      qc.invalidateQueries({ queryKey: ["admin-users"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminAPI.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] })
      toast.success("用户已删除")
      setDeleteUser(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!me) {
    return (
      <div className="mx-auto max-w-4xl p-6 md:p-8">
        <Card className="h-40 animate-pulse">
          <CardContent className="h-full" />
        </Card>
      </div>
    )
  }

  if (!me.is_admin) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Shield className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">无管理员权限</h1>
        <p className="text-sm text-muted-foreground">
          请联系现有管理员为你的账号授予权限，或通过 CLI 创建管理员账号：
        </p>
        <code className="rounded-md bg-muted px-3 py-1.5 text-xs">
          python scripts/create_user.py --admin &lt;username&gt;
        </code>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理访问令牌 · 授予/撤销管理员权限 · 删除账号
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="h-4 w-4" />
              新建用户
            </Button>
          </DialogTrigger>
          <CreateUserDialog
            onClose={() => setCreateOpen(false)}
            onCreated={(u) => {
              setCreateOpen(false)
              setNewUser({ username: u.username, token: u.token })
              qc.invalidateQueries({ queryKey: ["admin-users"] })
            }}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            账号列表
          </CardTitle>
          <CardDescription>
            {isLoading
              ? "加载中..."
              : `共 ${users.length} 人 · 其中管理员 ${users.filter((u) => u.is_admin).length} 人`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">用户名</th>
                  <th className="px-4 py-2 text-left">角色</th>
                  <th className="px-4 py-2 text-left">音色</th>
                  <th className="px-4 py-2 text-left">创建于</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.user_id}
                    className="border-t hover:bg-muted/20"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.username}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {u.user_id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge isAdmin={u.is_admin} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{u.voice_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(u.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        user={u}
                        isSelf={u.username === myUsername}
                        onToggleAdmin={(next) =>
                          roleMut.mutate({ id: u.user_id, admin: next })
                        }
                        onReset={() => setResetConfirm(u)}
                        onDelete={() => setDeleteUser(u)}
                      />
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !isLoading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      暂无用户
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="divide-y md:hidden">
            {users.map((u) => (
              <div key={u.user_id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{u.username}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {u.user_id}
                    </div>
                  </div>
                  <RoleBadge isAdmin={u.is_admin} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.voice_count} 个音色 · 创建于 {formatDate(u.created_at)}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <RowActions
                    user={u}
                    isSelf={u.username === myUsername}
                    onToggleAdmin={(next) =>
                      roleMut.mutate({ id: u.user_id, admin: next })
                    }
                    onReset={() => {
                      setResetUser(u)
                      setResetToken(null)
                      resetMut.mutate(u.user_id)
                    }}
                    onDelete={() => setDeleteUser(u)}
                  />
                </div>
              </div>
            ))}
            {users.length === 0 && !isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无用户
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!newUser} onOpenChange={(o) => !o && setNewUser(null)}>
        {newUser ? (
          <TokenRevealDialog
            title={`用户 ${newUser.username} 已创建`}
            token={newUser.token}
            onClose={() => setNewUser(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!resetUser && !!resetToken}
        onOpenChange={(o) => {
          if (!o) {
            setResetUser(null)
            setResetToken(null)
          }
        }}
      >
        {resetUser && resetToken ? (
          <TokenRevealDialog
            title={`${resetUser.username} 的令牌已重置`}
            token={resetToken}
            onClose={() => {
              setResetUser(null)
              setResetToken(null)
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!resetConfirm}
        onOpenChange={(o) => !o && setResetConfirm(null)}
      >
        {resetConfirm ? (
          <ResetTokenConfirmDialog
            user={resetConfirm}
            pending={resetMut.isPending}
            onCancel={() => setResetConfirm(null)}
            onConfirm={() => {
              const target = resetConfirm
              setResetConfirm(null)
              setResetUser(target)
              setResetToken(null)
              resetMut.mutate(target.user_id)
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!deleteUser}
        onOpenChange={(o) => !o && setDeleteUser(null)}
      >
        {deleteUser ? (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>删除用户？</DialogTitle>
              <DialogDescription>
                将永久删除用户「{deleteUser.username}」及其所有音色档案，此操作不可恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteUser(null)}
                disabled={deleteMut.isPending}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMut.mutate(deleteUser.user_id)}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? "删除中..." : "确认删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return isAdmin ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <Shield className="h-3 w-3" />
      管理员
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      普通用户
    </span>
  )
}

function RowActions({
  user,
  isSelf,
  onToggleAdmin,
  onReset,
  onDelete,
}: {
  user: AdminUser
  isSelf: boolean
  onToggleAdmin: (next: boolean) => void
  onReset: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={() => onToggleAdmin(!user.is_admin)}
        disabled={isSelf && user.is_admin}
      >
        {user.is_admin ? (
          <>
            <ShieldOff className="h-3.5 w-3.5" />
            撤销管理员
          </>
        ) : (
          <>
            <Shield className="h-3.5 w-3.5" />
            设为管理员
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={onReset}
      >
        <KeyRound className="h-3.5 w-3.5" />
        重置令牌
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-destructive hover:text-destructive"
        onClick={onDelete}
        disabled={isSelf}
      >
        <Trash2 className="h-3.5 w-3.5" />
        删除
      </Button>
    </div>
  )
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (u: { username: string; token: string }) => void
}) {
  const [username, setUsername] = useState("")
  const [isAdmin, setIsAdmin] = useState(false)

  const mut = useMutation({
    mutationFn: () => adminAPI.create(username.trim(), isAdmin),
    onSuccess: (res) => onCreated({ username: res.username, token: res.token }),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>新建用户</DialogTitle>
        <DialogDescription>
          用户名仅限字母、数字、下划线、连字符，1-32 位。创建后令牌仅显示一次。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-username">用户名</Label>
          <Input
            id="new-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="alice"
            autoComplete="off"
            disabled={mut.isPending}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            disabled={mut.isPending}
            className="h-4 w-4 rounded border-input"
          />
          同时设为管理员
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
          取消
        </Button>
        <Button
          onClick={() => mut.mutate()}
          disabled={mut.isPending || !username.trim()}
        >
          <Plus className="h-4 w-4" />
          {mut.isPending ? "创建中..." : "创建"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function ResetTokenConfirmDialog({
  user,
  pending,
  onCancel,
  onConfirm,
}: {
  user: AdminUser
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [input, setInput] = useState("")
  const matches = input.trim() === user.username

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>重置 {user.username} 的访问令牌？</DialogTitle>
        <DialogDescription>
          重置后该用户当前所有已登录会话立即失效，需重新登录。旧令牌无法恢复。
          <br />
          输入用户名 <code className="rounded bg-muted px-1">{user.username}</code> 以确认：
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm-username">用户名</Label>
        <Input
          id="reset-confirm-username"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
          placeholder={user.username}
          disabled={pending}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending} autoFocus>
          取消
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          disabled={!matches || pending}
        >
          {pending ? "重置中..." : "确认重置"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function TokenRevealDialog({
  title,
  token,
  onClose,
}: {
  title: string
  token: string
  onClose: () => void
}) {
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          令牌仅显示一次，请立即复制并交给用户。关闭后无法再次查看。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label>访问令牌</Label>
        <div className="flex gap-2">
          <code className="flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
            {token}
          </code>
          <Button
            variant="outline"
            size="icon"
            onClick={() => copy(token)}
            aria-label="复制令牌"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>我已保存</Button>
      </DialogFooter>
    </DialogContent>
  )
}
