import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Check,
  ChevronRight,
  Code,
  Copy,
  FolderOpen,
  FolderSearch,
  KeyRound,
  Lock,
  LockOpen,
  Plug,
  Puzzle,
  RotateCcw,
  ShieldPlus,
  SquareTerminal,
  X
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ClaudeArgsInput } from '@/components/ClaudeArgsInput'
import { ExtensionsPage } from '@/components/ExtensionsPage'
import { useAskVault } from '@/components/VaultProvider'
import { api } from '@/lib/api'
import { ClaudeIcon, ideIcon } from '@/lib/brandIcons'
import { useAction, useIdes, useMcpStatus, useSettings, useVaultStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'claude', label: 'Claude', icon: ClaudeIcon },
  { id: 'ide', label: 'IDE', icon: Code },
  { id: 'vault', label: 'Bóveda', icon: KeyRound },
  { id: 'mcp', label: 'MCP', icon: Plug },
  { id: 'system', label: 'Sistema', icon: SquareTerminal },
  { id: 'extensions', label: 'Extensiones', icon: Puzzle }
]
const TABS = SECTIONS.map((s) => s.id)

const readTab = () => {
  try {
    const t = localStorage.getItem('settingsTab')
    return TABS.includes(t) ? t : 'claude'
  } catch {
    return 'claude'
  }
}

export function SettingsPage({ initialTab }) {
  const [tab, setTab] = useState(initialTab ?? readTab)

  const changeTab = (t) => {
    setTab(t)
    try {
      localStorage.setItem('settingsTab', t)
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }

  return (
    <section>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Cómo se abre Claude, el IDE por defecto, la bóveda de secretos, el servidor MCP, los
          programas del sistema que usa la app y las extensiones instaladas.
        </p>
      </header>
      <div className="flex gap-6">
        <nav
          className="flex w-44 shrink-0 flex-col gap-0.5"
          aria-label="Secciones de configuración"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => changeTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
                tab === id && 'bg-accent font-medium shadow-[inset_3px_0_0_var(--primary)]'
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'claude' && <ClaudeSettings />}
          {tab === 'ide' && <IdeSettings />}
          {tab === 'vault' && <VaultSettings />}
          {tab === 'mcp' && <McpSettings />}
          {tab === 'system' && <SystemSettings />}
          {tab === 'extensions' && <ExtensionsPage embedded />}
        </div>
      </div>
    </section>
  )
}

function Card({ title, description, children }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

const saved = () => toast.success('Configuración guardada')

function ClaudeSettings() {
  const { data: settings } = useSettings()
  const [args, setArgs] = useState('')
  const [newWindow, setNewWindow] = useState(false)
  const [claudePath, setClaudePath] = useState('')
  const save = useAction(api.settings.set, { onSuccess: saved })

  useEffect(() => {
    if (!settings) return
    setArgs(settings.claude.args)
    setNewWindow(settings.claude.newWindow)
    setClaudePath(settings.binaries.claude)
  }, [settings])

  if (!settings) return null
  const dirty =
    args.trim() !== settings.claude.args ||
    newWindow !== settings.claude.newWindow ||
    claudePath.trim() !== settings.binaries.claude

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ claude: { args, newWindow }, binaries: { claude: claudePath } })
      }}
    >
      <Card
        title="Al abrir Claude Code"
        description="Se aplica a todas las sesiones que abras desde la app."
      >
        <div className="flex flex-col gap-4">
          <Field
            label="Argumentos extra"
            hint="Se añaden a «claude». Escribe - para ver sus opciones; ↑↓ y Enter o Tab para elegir. Nunca pongas secretos aquí: guárdalos en la bóveda."
          >
            <ClaudeArgsInput
              className="font-mono"
              placeholder="Escribe - para ver las opciones (p. ej. --model opus)"
              value={args}
              onChange={setArgs}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={newWindow}
              onChange={(e) => setNewWindow(e.target.checked)}
            />
            Abrir cada sesión en una ventana nueva de Windows Terminal (si no, en una pestaña)
          </label>
          <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            wt -w {newWindow ? 'new' : '0'} nt … claude {args.trim()}
          </p>
        </div>
      </Card>
      <Collapsible defaultOpen={!!settings.binaries.claude}>
        <CollapsibleTrigger className="group flex items-center gap-1 py-1 text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Avanzado
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Card
            title="Ejecutable de Claude Code"
            description="Por defecto se usa el «claude» del PATH del sistema. Indica otro si tienes varias instalaciones o no está en el PATH."
          >
            <BinaryInput
              value={claudePath}
              onChange={setClaudePath}
              detected={settings.systemBinaries.claude}
            />
          </Card>
        </CollapsibleContent>
      </Collapsible>
      <div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  )
}

function IdeSettings() {
  const { data, isPending } = useIdes()
  const setDefault = useAction(api.ide.setDefault, { onSuccess: saved })
  const ides = data?.ides ?? []
  const installed = ides.filter((i) => i.path)
  const missing = ides.filter((i) => !i.path)
  // Sin elección (o si el elegido ya no está), se usa el primero instalado.
  const current = installed.find((i) => i.id === data?.selected) || installed[0]

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card
        title="IDE por defecto"
        description="El que abre el botón de IDE de cada repo y worktree. «Abrir con…» permite usar otro puntualmente."
      >
        {isPending && <p className="text-sm text-muted-foreground">Buscando IDEs instalados…</p>}
        {data && !installed.length && (
          <p className="text-sm text-destructive">No se ha encontrado ningún IDE compatible.</p>
        )}
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {installed.map((ide) => {
            const Icon = ideIcon(ide.id)
            const selected = ide.id === current?.id
            return (
              <li key={ide.id}>
                <button
                  type="button"
                  onClick={() => setDefault.mutate(ide.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/50',
                    selected && 'border-primary bg-primary/10 hover:bg-primary/10'
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{ide.name}</span>
                    <span
                      className="block truncate font-mono text-xs text-muted-foreground"
                      title={ide.path}
                    >
                      {ide.path}
                    </span>
                  </span>
                  {selected && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              </li>
            )
          })}
        </ul>
        {missing.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            También compatibles si los instalas: {missing.map((i) => i.name).join(', ')}.
          </p>
        )}
      </Card>
    </div>
  )
}

function VaultSettings() {
  const { data: settings } = useSettings()
  const { data: vault } = useVaultStatus()
  const askVault = useAskVault()
  const [autoLock, setAutoLock] = useState('')
  const [clipboard, setClipboard] = useState('')
  const save = useAction(api.settings.set, { onSuccess: saved })
  const lock = useAction(api.vault.lock)
  const useExisting = useAction(api.vault.useExisting)
  const resetPath = useAction(api.vault.resetPath)

  useEffect(() => {
    if (!settings) return
    setAutoLock(String(settings.vault.autoLockMinutes))
    setClipboard(String(settings.vault.clipboardSeconds))
  }, [settings])

  if (!settings || !vault) return null
  const isDefault = vault.path === settings.defaultVaultPath
  const dirty =
    Number(autoLock) !== settings.vault.autoLockMinutes ||
    Number(clipboard) !== settings.vault.clipboardSeconds

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card
        title="Archivo"
        description="Base de datos KeePass (.kdbx) donde se guardan los secretos."
      >
        <div className="mb-3 flex items-center gap-2">
          <Badge variant={vault.unlocked ? 'default' : 'secondary'}>
            {vault.unlocked ? 'Desbloqueada' : vault.exists ? 'Bloqueada' : 'Sin crear'}
          </Badge>
          {isDefault && <span className="text-xs text-muted-foreground">Ruta por defecto</span>}
        </div>
        <p className="mb-3 truncate font-mono text-xs text-muted-foreground" title={vault.path}>
          {vault.path}
        </p>
        <div className="flex flex-wrap gap-2">
          {vault.unlocked ? (
            <Button variant="outline" size="sm" onClick={() => lock.mutate()}>
              <Lock /> Bloquear
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => askVault()}>
              {vault.exists ? <LockOpen /> : <ShieldPlus />}
              {vault.exists ? 'Desbloquear' : 'Crear bóveda'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => useExisting.mutate()}>
            <FolderSearch /> Usar otro .kdbx
          </Button>
          {vault.exists && (
            <Button variant="outline" size="sm" onClick={() => api.vault.showFile()}>
              <FolderOpen /> Mostrar en la carpeta
            </Button>
          )}
          {!isDefault && (
            <Button variant="ghost" size="sm" onClick={() => resetPath.mutate()}>
              <RotateCcw /> Volver a la ruta por defecto
            </Button>
          )}
        </div>
      </Card>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate({
            vault: { autoLockMinutes: Number(autoLock), clipboardSeconds: Number(clipboard) }
          })
        }}
      >
        <Card title="Seguridad">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Autobloqueo (minutos)" hint="Tras este tiempo sin usarla. Entre 1 y 240.">
              <Input
                type="number"
                min={1}
                max={240}
                value={autoLock}
                onChange={(e) => setAutoLock(e.target.value)}
              />
            </Field>
            <Field
              label="Limpiar portapapeles (segundos)"
              hint="Tras copiar un secreto. Entre 5 y 300."
            >
              <Input
                type="number"
                min={5}
                max={300}
                value={clipboard}
                onChange={(e) => setClipboard(e.target.value)}
              />
            </Field>
          </div>
        </Card>
        <div>
          <Button type="submit" disabled={!dirty || save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </div>
  )
}

// Ruta de un ejecutable: vacía = la que se encuentra en el PATH del sistema (`detected`).
function BinaryInput({ value, onChange, detected }) {
  const pick = async () => {
    const file = await api.settings.pickBinary()
    if (file) onChange(file)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          className="font-mono text-xs"
          spellCheck={false}
          placeholder={detected || 'No se encuentra en el PATH del sistema'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={pick}>
          <FolderSearch /> Examinar
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            title="Usar el del sistema"
            aria-label="Usar el del sistema"
            onClick={() => onChange('')}
          >
            <X />
          </Button>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {value
          ? 'Ruta propia. Vacíala para volver a la del sistema.'
          : detected
            ? 'Se usa la del sistema.'
            : 'No se encuentra en el PATH del sistema: indica su ruta si lo necesitas.'}
      </span>
    </div>
  )
}

// Programas que lanza la app (Claude se configura en su pestaña).
const SYSTEM_BINARIES = [
  {
    title: 'Terminales',
    items: [
      { id: 'cmd', label: 'Símbolo del sistema (cmd.exe)' },
      { id: 'pwsh', label: 'PowerShell 7 (pwsh.exe)' },
      { id: 'wt', label: 'Windows Terminal (wt.exe)' }
    ]
  },
  { title: 'Control de versiones', items: [{ id: 'git', label: 'Git (git.exe)' }] },
  {
    title: 'JavaScript',
    items: [
      { id: 'node', label: 'Node.js (node.exe)' },
      { id: 'npm', label: 'npm' },
      { id: 'pnpm', label: 'pnpm' },
      { id: 'yarn', label: 'Yarn' },
      { id: 'bun', label: 'Bun' }
    ]
  },
  {
    title: 'Python y .NET',
    items: [
      { id: 'uv', label: 'uv' },
      { id: 'poetry', label: 'Poetry' },
      { id: 'dotnet', label: '.NET (dotnet.exe)' }
    ]
  }
]
const SYSTEM_IDS = SYSTEM_BINARIES.flatMap((g) => g.items.map((i) => i.id))

function SystemSettings() {
  const { data: settings } = useSettings()
  const [paths, setPaths] = useState({})
  const save = useAction(api.settings.set, { onSuccess: saved })

  useEffect(() => {
    if (!settings) return
    setPaths(Object.fromEntries(SYSTEM_IDS.map((id) => [id, settings.binaries[id]])))
  }, [settings])

  if (!settings) return null
  const dirty = SYSTEM_IDS.some((id) => (paths[id] ?? '').trim() !== settings.binaries[id])

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ binaries: paths })
      }}
    >
      <p className="text-sm text-muted-foreground">
        Por defecto la app busca cada programa en el PATH del sistema. Indica una ruta si alguno no
        está en el PATH o quieres fijar una versión concreta: su carpeta se antepone al PATH de lo
        que lance la app (sesiones de Claude, instalaciones y extensiones). Nunca se buscan en la
        carpeta del repositorio.
      </p>
      {SYSTEM_BINARIES.map((group) => (
        <Card key={group.title} title={group.title}>
          <div className="mt-3 flex flex-col gap-4">
            {group.items.map(({ id, label }) => (
              <div key={id} className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{label}</span>
                <BinaryInput
                  value={paths[id] ?? ''}
                  onChange={(v) => setPaths((p) => ({ ...p, [id]: v }))}
                  detected={settings.systemBinaries[id]}
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
      <div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  )
}

function McpSettings() {
  const { data: settings } = useSettings()
  const { data: status } = useMcpStatus()
  const [enabled, setEnabled] = useState(true)
  const [port, setPort] = useState('')
  const [autoConnect, setAutoConnect] = useState(true)
  const save = useAction(api.settings.set, { onSuccess: saved })
  const regenerate = useAction(api.mcp.regenerateToken, {
    onSuccess: () => toast.success('Token nuevo generado: vuelve a añadir el servidor en Claude')
  })

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.mcp.enabled)
    setPort(String(settings.mcp.port))
    setAutoConnect(settings.mcp.autoConnect)
  }, [settings])

  if (!settings || !status) return null
  const dirty =
    enabled !== settings.mcp.enabled ||
    Number(port) !== settings.mcp.port ||
    autoConnect !== settings.mcp.autoConnect
  const command = (token) =>
    `claude mcp add --transport http --scope user ${status.name} ${status.url} --header "Authorization: Bearer ${token}"`
  const copy = async () => {
    await navigator.clipboard.writeText(command(status.token))
    toast.success('Comando copiado')
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate({ mcp: { enabled, port: Number(port), autoConnect } })
        }}
      >
        <Card
          title="Servidor MCP"
          description="Permite que Claude Code consulte tus proyectos, repos y worktrees, abra sesiones y lance «Iniciar desarrollo». Solo escucha en este equipo y nunca da acceso a la bóveda."
        >
          <div className="mb-4 flex items-center gap-2">
            <Badge
              variant={status.running ? 'default' : status.error ? 'destructive' : 'secondary'}
            >
              {status.running
                ? 'Activo'
                : status.error
                  ? 'Error'
                  : status.enabled
                    ? 'Arrancando…'
                    : 'Apagado'}
            </Badge>
            {status.running && (
              <span className="font-mono text-xs text-muted-foreground">{status.url}</span>
            )}
            {status.error && <span className="text-xs text-destructive">{status.error}</span>}
          </div>
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Activar el servidor MCP
            </label>
            <Field
              label="Puerto"
              hint="Entre 1024 y 65535. Si lo cambias, vuelve a añadirlo en Claude."
            >
              <Input
                type="number"
                min={1024}
                max={65535}
                className="w-32"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={autoConnect}
                onChange={(e) => setAutoConnect(e.target.checked)}
              />
              Conectar automáticamente las sesiones que abre la app (--mcp-config)
            </label>
          </div>
        </Card>
        <div>
          <Button type="submit" disabled={!dirty || save.isPending}>
            Guardar
          </Button>
        </div>
      </form>

      <Card
        title="Usarlo en cualquier sesión"
        description="Ejecuta este comando una vez para que todas tus sesiones de Claude Code tengan el servidor, también las que no abres desde la app."
      >
        <p className="mb-3 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground">
          {command('•'.repeat(12))}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy /> Copiar comando
          </Button>
          <Button variant="ghost" size="sm" onClick={() => regenerate.mutate()}>
            <RotateCcw /> Generar token nuevo
          </Button>
        </div>
      </Card>
    </div>
  )
}
