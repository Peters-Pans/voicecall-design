import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AudioLines,
  Clock,
  FileAudio2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import AudioRecorderPanel from "@/components/AudioRecorderPanel"
import { voicesAPI, type VoiceProfile } from "@/lib/api"

const MAX_BYTES = 10 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export default function VoicesPage() {
  const qc = useQueryClient()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [replacing, setReplacing] = useState<VoiceProfile | null>(null)
  const [deleting, setDeleting] = useState<VoiceProfile | null>(null)

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["voices"],
    queryFn: voicesAPI.list,
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => voicesAPI.remove(id),
    onSuccess: () => {
      toast.success("音色已删除")
      qc.invalidateQueries({ queryKey: ["voices"] })
      setDeleting(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">音色管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            上传参考音频创建克隆音色，30 秒以上 MP3/WAV 效果最佳
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            刷新
          </Button>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                新建音色
              </Button>
            </DialogTrigger>
            <UploadDialog
              mode="create"
              onDone={() => {
                setUploadOpen(false)
                qc.invalidateQueries({ queryKey: ["voices"] })
              }}
            />
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-40 animate-pulse">
              <CardContent className="h-full" />
            </Card>
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState onCreate={() => setUploadOpen(true)} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((profile) => (
            <VoiceCard
              key={profile.profile_id}
              profile={profile}
              onReplace={() => setReplacing(profile)}
              onDelete={() => setDeleting(profile)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={!!replacing}
        onOpenChange={(o) => !o && setReplacing(null)}
      >
        {replacing ? (
          <UploadDialog
            mode="replace"
            profile={replacing}
            onDone={() => {
              setReplacing(null)
              qc.invalidateQueries({ queryKey: ["voices"] })
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        {deleting ? (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>删除音色档案？</DialogTitle>
              <DialogDescription>
                将永久删除「{deleting.audio_name}」及其参考音频文件，此操作不可恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleting(null)}
                disabled={removeMutation.isPending}
                autoFocus
              >
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => removeMutation.mutate(deleting.profile_id)}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending ? "删除中..." : "确认删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

function VoiceCard({
  profile,
  onReplace,
  onDelete,
}: {
  profile: VoiceProfile
  onReplace: () => void
  onDelete: () => void
}) {
  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <AudioLines className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">{profile.audio_name}</CardTitle>
              <CardDescription className="mt-0.5 font-mono text-[11px]">
                {profile.profile_id}
              </CardDescription>
            </div>
          </div>
          <span className="rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {profile.audio_format}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-1.5 text-xs text-muted-foreground">
        {profile.duration_sec ? (
          <div className="flex items-center gap-1.5">
            <FileAudio2 className="h-3 w-3" />
            时长 {profile.duration_sec.toFixed(1)}s
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          创建于 {formatDate(profile.created_at)}
        </div>
      </CardContent>
      <CardFooter className="gap-2 pt-0">
        <Button variant="outline" size="sm" onClick={onReplace}>
          <Upload className="h-3.5 w-3.5" />
          更换
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </Button>
      </CardFooter>
    </Card>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <AudioLines className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">还没有音色档案</p>
          <p className="mt-1 text-xs text-muted-foreground">
            上传一段清晰的参考录音，系统会在调用 TTS 时使用它作为克隆来源
          </p>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          上传第一个音色
        </Button>
      </CardContent>
    </Card>
  )
}

function UploadDialog({
  mode,
  profile,
  onDone,
}: {
  mode: "create" | "replace"
  profile?: VoiceProfile
  onDone: () => void
}) {
  const [name, setName] = useState(profile?.audio_name ?? "")
  const [file, setFile] = useState<File | null>(null)

  const createMut = useMutation({
    mutationFn: () => voicesAPI.create(file!, name.trim() || "默认音色"),
    onSuccess: () => {
      toast.success("音色已创建")
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const replaceMut = useMutation({
    mutationFn: () => voicesAPI.update(profile!.profile_id, file!),
    onSuccess: () => {
      toast.success("音色已更新")
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pending = createMut.isPending || replaceMut.isPending

  function handleFile(f: File | undefined) {
    if (!f) return
    if (f.size > MAX_BYTES) {
      toast.error(`文件过大 (${formatSize(f.size)})，最多 10MB`)
      return
    }
    const ok =
      f.type === "audio/mpeg" ||
      f.type === "audio/mp3" ||
      f.type === "audio/wav" ||
      f.type === "audio/x-wav" ||
      f.type === "audio/wave"
    if (!ok) {
      toast.error(`仅支持 MP3 / WAV (收到 ${f.type || "未知"})`)
      return
    }
    setFile(f)
  }

  function handleSubmit() {
    if (!file) {
      toast.error("请选择参考音频")
      return
    }
    if (mode === "create") createMut.mutate()
    else replaceMut.mutate()
  }

  const filenameBase =
    mode === "replace" && profile
      ? profile.audio_name
      : name.trim() || "recording"

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {mode === "create" ? "新建音色档案" : "更换参考音频"}
        </DialogTitle>
        <DialogDescription>
          推荐 30 秒以上清晰人声，MP3 或 WAV，单文件 ≤ 10MB
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {mode === "create" ? (
          <div className="space-y-2">
            <Label htmlFor="voice-name">名称</Label>
            <Input
              id="voice-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：助理小雅"
              disabled={pending}
            />
          </div>
        ) : null}

        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">上传文件</TabsTrigger>
            <TabsTrigger value="record">直接录音</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="space-y-2">
            <Label htmlFor="voice-file">参考音频</Label>
            <Input
              id="voice-file"
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
              disabled={pending}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </TabsContent>
          <TabsContent value="record">
            <AudioRecorderPanel
              filenameBase={filenameBase}
              disabled={pending}
              onConfirm={(f) => {
                setFile(f)
                toast.success(`录音已就绪：${f.name}`)
              }}
            />
          </TabsContent>
        </Tabs>

        {file ? (
          <p className="text-xs text-muted-foreground">
            待提交：{file.name} · {formatSize(file.size)}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          取消
        </Button>
        <Button onClick={handleSubmit} disabled={pending || !file}>
          {pending ? "上传中..." : mode === "create" ? "创建" : "更换"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
