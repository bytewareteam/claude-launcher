import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, FolderSearch, Lock, LockOpen, RotateCcw, ShieldPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClaudeArgsInput } from '@/components/ClaudeArgsInput'
import { ExtensionsPage } from '@/components/ExtensionsPage'
import { useAskVault } from '@/components/VaultProvider'
import { api } from '@/lib/api'
import { useAction, useSettings, useVaultStatus } from '@/lib/queries'

const TABS = ['claude', 'vault', 'extensions']

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
          Cómo se abre Claude, la bóveda de secretos y las extensiones instaladas.
        </p>
      </header>
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="claude">Claude</TabsTrigger>
          <TabsTrigger value="vault">Bóveda</TabsTrigger>
          <TabsTrigger value="extensions">Extensiones</TabsTrigger>
        </TabsList>
        <TabsContent value="claude" className="mt-4">
          <ClaudeSettings />
        </TabsContent>
        <TabsContent value="vault" className="mt-4">
          <VaultSettings />
        </TabsContent>
        <TabsContent value="extensions" className="mt-4">
          <ExtensionsPage embedded />
        </TabsContent>
      </Tabs>
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
  const save = useAction(api.settings.set, { onSuccess: saved })

  useEffect(() => {
    if (!settings) return
    setArgs(settings.claude.args)
    setNewWindow(settings.claude.newWindow)
  }, [settings])

  if (!settings) return null
  const dirty = args.trim() !== settings.claude.args || newWindow !== settings.claude.newWindow

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ claude: { args, newWindow } })
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
      <div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
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
      <Card title="Archivo" description="Base de datos KeePass (.kdbx) donde se guardan los secretos.">
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
