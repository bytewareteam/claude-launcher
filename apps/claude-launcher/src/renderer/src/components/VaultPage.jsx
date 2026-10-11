import { useState } from 'react'
import { toast } from 'sonner'
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileKey,
  KeyRound,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  WandSparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchInput } from '@/components/SearchInput'
import { useAskVault } from '@/components/VaultProvider'
import { api, errMsg } from '@/lib/api'
import { useAction, useGeneralSecrets, useSettings, useVaultStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Los campos de cada categoría deben coincidir con CATEGORIES de src/main/vault.js.
const CATEGORIES = [
  {
    id: 'passwords',
    label: 'Contraseñas',
    icon: KeyRound,
    newLabel: 'Nueva contraseña',
    empty: 'Aún no has guardado ninguna contraseña.',
    fields: ['title', 'username', 'password', 'url', 'notes'],
    placeholders: { title: 'p. ej. Correo del trabajo', url: 'https://…' }
  },
  {
    id: 'system',
    label: 'Credenciales de sistema',
    icon: Server,
    newLabel: 'Nueva credencial',
    empty: 'Aún no has guardado ninguna credencial.',
    fields: ['title', 'username', 'password', 'url', 'notes'],
    labels: { url: 'Host o URL' },
    placeholders: { title: 'p. ej. Base de datos de staging', url: 'db.interno:5432' }
  },
  {
    id: 'ssh',
    label: 'Llaves SSH',
    icon: FileKey,
    newLabel: 'Nueva llave',
    empty: 'Aún no has guardado ninguna llave.',
    fields: ['title', 'username', 'privateKey', 'password', 'publicKey', 'notes'],
    labels: { username: 'Usuario o comentario', password: 'Frase de paso' },
    placeholders: { title: 'p. ej. id_ed25519 de GitHub' }
  },
  {
    id: 'personal',
    label: 'Secretos personales',
    icon: ShieldCheck,
    newLabel: 'Nuevo secreto',
    empty: 'Aún no has guardado ningún secreto.',
    fields: ['title', 'password', 'notes'],
    labels: { password: 'Valor' },
    placeholders: { title: 'p. ej. Códigos de recuperación' }
  }
]

const FIELDS = {
  title: { label: 'Nombre' },
  username: { label: 'Usuario' },
  password: { label: 'Contraseña', secret: true, generate: true },
  url: { label: 'URL' },
  notes: { label: 'Notas', multiline: true },
  publicKey: { label: 'Clave pública', multiline: true, mono: true },
  privateKey: { label: 'Clave privada', secret: true, multiline: true, mono: true }
}

const fieldLabel = (cat, f) => cat.labels?.[f] ?? FIELDS[f].label

const textareaClass =
  'min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

const readTab = () => {
  try {
    const t = localStorage.getItem('vaultTab')
    return CATEGORIES.some((c) => c.id === t) ? t : 'passwords'
  } catch {
    return 'passwords'
  }
}

export function VaultPage() {
  const { data: vault } = useVaultStatus()
  const askVault = useAskVault()
  const [tab, setTab] = useState(readTab)

  const changeTab = (t) => {
    setTab(t)
    try {
      localStorage.setItem('vaultTab', t)
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }

  return (
    <section>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Bóveda</h1>
        <p className="text-sm text-muted-foreground">
          Contraseñas, credenciales, llaves SSH y otros secretos tuyos. Se guardan cifrados en tu
          archivo KeePass y nunca se pasan a Claude, al servidor MCP ni a las extensiones.
        </p>
      </header>
      {!vault?.unlocked ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-4 text-sm">
          <span className="text-muted-foreground">
            {vault?.exists ? 'La bóveda está bloqueada.' : 'Aún no has creado la bóveda.'}
          </span>
          <Button size="sm" variant="outline" onClick={() => askVault()}>
            {vault?.exists ? 'Desbloquear' : 'Crear bóveda'}
          </Button>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList>
            {CATEGORIES.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id}>
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {CATEGORIES.map((cat) => (
            <TabsContent key={cat.id} value={cat.id} className="pt-2">
              <CategoryPanel category={cat} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  )
}

function CategoryPanel({ category }) {
  const { data: items = [], isLoading } = useGeneralSecrets(category.id)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // null = cerrado; {} = nuevo; item = editar
  const importKey = useAction(api.general.importSshKey, {
    onSuccess: (title) => title && toast.success(`Llave «${title}» importada`)
  })

  const q = query.trim().toLowerCase()
  const visible = items.filter(
    (i) => !q || [i.title, i.username, i.url, i.notes].some((v) => v && v.toLowerCase().includes(q))
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={`Buscar en ${category.label.toLowerCase()}…`}
          />
        </div>
        {category.id === 'ssh' && (
          <Button
            variant="outline"
            title="Guarda una llave privada (y su .pub si está al lado) desde un archivo"
            onClick={() => importKey.mutate()}
          >
            <FileKey /> Importar llave
          </Button>
        )}
        <Button onClick={() => setEditing({})}>
          <Plus /> {category.newLabel}
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map((item) => (
          <SecretCard
            key={item.id}
            category={category}
            item={item}
            onEdit={() => setEditing(item)}
          />
        ))}
        {!isLoading && !visible.length && (
          <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {q ? 'Sin resultados.' : category.empty}
          </li>
        )}
      </ul>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <SecretForm
            category={category}
            item={editing.id ? editing : null}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  )
}

function useCopy(category, item) {
  const { data: settings } = useSettings()
  const seconds = settings?.vault.clipboardSeconds ?? 30
  return useAction((field) => api.general.copy(category.id, item.id, field), {
    onSuccess: (_r, field) =>
      toast(`Copiado: ${fieldLabel(category, field)} (se borra en ${seconds} s)`)
  })
}

// Copia texto visible (usuario, clave pública…): no hace falta limpiarlo del portapapeles.
const copyPlain = async (label, text) => {
  try {
    await navigator.clipboard.writeText(text)
    toast(`Copiado: ${label}`)
  } catch (err) {
    toast.error(errMsg(err))
  }
}

function SecretCard({ category, item, onEdit }) {
  const remove = useAction(() => api.general.remove(category.id, item.id), {
    onSuccess: () => toast(`«${item.title}» está en la papelera de KeePass`)
  })
  const secretFields = category.fields.filter((f) => FIELDS[f].secret && item.secrets.includes(f))

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{item.title}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            {item.username && (
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground"
                title="Copiar usuario"
                onClick={() => copyPlain(fieldLabel(category, 'username'), item.username)}
              >
                <UserRound className="size-3.5" /> {item.username}
              </button>
            )}
            {item.url && <UrlLink url={item.url} />}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon-sm" variant="ghost" title="Editar" onClick={onEdit}>
            <Pencil />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="text-destructive" title="Borrar">
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar «{item.title}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Va a la papelera de KeePass: puedes recuperarla desde KeePassXC.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                  Borrar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {secretFields.map((f) => (
        <SecretField key={f} category={category} item={item} field={f} />
      ))}
      {item.publicKey && (
        <div className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5">
          <span className="w-28 shrink-0 text-xs text-muted-foreground">Clave pública</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs select-text">
            {item.publicKey}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Copiar clave pública"
            onClick={() => copyPlain('Clave pública', item.publicKey)}
          >
            <Copy />
          </Button>
        </div>
      )}
      {item.notes && (
        <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground select-text">
          {item.notes}
        </p>
      )}
    </li>
  )
}

function UrlLink({ url }) {
  if (!/^https:\/\//i.test(url)) return <span className="truncate select-text">{url}</span>
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-1 hover:text-foreground"
      title="Abrir en el navegador"
      onClick={() => api.openUrl(url).catch((err) => toast.error(errMsg(err)))}
    >
      <ExternalLink className="size-3.5 shrink-0" /> <span className="truncate">{url}</span>
    </button>
  )
}

function SecretField({ category, item, field }) {
  const [value, setValue] = useState(null) // null = oculto
  const copy = useCopy(category, item)
  const { multiline } = FIELDS[field]

  const toggle = async () => {
    try {
      setValue(value === null ? await api.general.get(category.id, item.id, field) : null)
    } catch (err) {
      toast.error(errMsg(err))
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-md bg-secondary px-3 py-1.5">
      <span className="w-28 shrink-0 pt-1 text-xs text-muted-foreground">
        {fieldLabel(category, field)}
      </span>
      {value !== null && multiline ? (
        <pre className="max-h-48 min-w-0 flex-1 overflow-auto pt-1 font-mono text-xs select-text">
          {value}
        </pre>
      ) : (
        <span className="min-w-0 flex-1 truncate pt-0.5 font-mono text-sm text-muted-foreground select-text">
          {value ?? '••••••••'}
        </span>
      )}
      <div className="flex shrink-0 gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          title={value === null ? 'Ver' : 'Ocultar'}
          onClick={toggle}
        >
          {value === null ? <Eye /> : <EyeOff />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Copiar (se borra del portapapeles pasado el plazo)"
          onClick={() => copy.mutate(field)}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}

// Contraseña aleatoria con getRandomValues; descarta valores para no sesgar el reparto.
function generatePassword(length = 24) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?'
  const limit = 256 - (256 % chars.length)
  let out = ''
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += chars[b % chars.length]
    }
  }
  return out
}

function SecretForm({ category, item, onDone }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(category.fields.map((f) => [f, FIELDS[f].secret ? '' : (item?.[f] ?? '')]))
  )
  const [shown, setShown] = useState({})
  const set = (f, v) => setValues((prev) => ({ ...prev, [f]: v }))
  const save = useAction(() => api.general.set(category.id, item?.id ?? null, values), {
    onSuccess: () => {
      toast.success(`Se guardó «${values.title.trim()}»`)
      onDone()
    }
  })

  return (
    <DialogContent className="sm:max-w-xl">
      <form
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (values.title.trim()) save.mutate()
        }}
      >
        <DialogHeader>
          <DialogTitle>{item ? `Editar «${item.title}»` : category.newLabel}</DialogTitle>
          <DialogDescription>
            {item
              ? 'Deja vacíos los campos secretos para conservar su valor actual.'
              : `Se guarda en el grupo «General › ${category.label}» de tu archivo KeePass.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-0.5">
          {category.fields.map((f) => {
            const def = FIELDS[f]
            const placeholder =
              item && def.secret && item.secrets.includes(f)
                ? 'Sin cambios'
                : (category.placeholders?.[f] ?? '')
            return (
              <label key={f} className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  {fieldLabel(category, f)}
                  {f === 'title' && <span className="text-destructive"> *</span>}
                </span>
                {def.multiline ? (
                  <textarea
                    className={cn(textareaClass, def.mono && 'font-mono text-xs')}
                    rows={def.mono ? 5 : 3}
                    spellCheck={false}
                    placeholder={placeholder}
                    value={values[f]}
                    onChange={(e) => set(f, e.target.value)}
                  />
                ) : (
                  <div className="flex gap-1.5">
                    <Input
                      autoFocus={f === 'title'}
                      className={cn(def.secret && 'font-mono')}
                      type={def.secret && !shown[f] ? 'password' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={placeholder}
                      value={values[f]}
                      onChange={(e) => set(f, e.target.value)}
                    />
                    {def.secret && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        title={shown[f] ? 'Ocultar' : 'Ver'}
                        onClick={() => setShown((s) => ({ ...s, [f]: !s[f] }))}
                      >
                        {shown[f] ? <EyeOff /> : <Eye />}
                      </Button>
                    )}
                    {def.generate && category.id !== 'ssh' && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        title="Generar contraseña aleatoria"
                        onClick={() => {
                          set(f, generatePassword())
                          setShown((s) => ({ ...s, [f]: true }))
                        }}
                      >
                        <WandSparkles />
                      </Button>
                    )}
                  </div>
                )}
              </label>
            )
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!values.title.trim() || save.isPending}>
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
