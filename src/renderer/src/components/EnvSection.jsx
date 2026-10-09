import { useState } from 'react'
import { ChevronRight, Copy, Eye, EyeOff, FileUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useAskVault } from '@/components/VaultProvider'
import { api, errMsg } from '@/lib/api'
import { useAction, useVars, useVaultStatus } from '@/lib/queries'
import { useRememberedOpen } from '@/lib/useRememberedOpen'

export function EnvSection({ id, scope, label }) {
  const [open, toggle] = useRememberedOpen(`env:${id}`)

  return (
    <Collapsible open={open} onOpenChange={toggle}>
      <CollapsibleTrigger className="group flex items-center gap-1 py-1 text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5">
        <EnvPanel scope={scope} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function EnvPanel({ scope }) {
  const { data: vault } = useVaultStatus()
  const askVault = useAskVault()
  const { data: vars = [] } = useVars(scope)

  if (!vault?.unlocked)
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {vault?.exists ? 'Bóveda bloqueada.' : 'Aún no has creado la bóveda.'}
        </span>
        <Button size="sm" variant="outline" onClick={() => askVault()}>
          {vault?.exists ? 'Desbloquear' : 'Crear bóveda'}
        </Button>
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {vars.length ? (
          vars.map((v) => <EnvRow key={v.id} scope={scope} variable={v} />)
        ) : (
          <li className="text-sm text-muted-foreground">Sin variables.</li>
        )}
      </ul>
      <AddVarForm scope={scope} />
    </div>
  )
}

function EnvRow({ scope, variable }) {
  const [value, setValue] = useState(null) // null = oculto
  const remove = useAction(() => api.vault.remove(scope, variable.id))

  const toggle = async () => {
    try {
      setValue(value === null ? await api.vault.get(scope, variable.id) : null)
    } catch (err) {
      toast.error(errMsg(err))
    }
  }
  const copy = useAction(() => api.vault.copy(scope, variable.id), {
    onSuccess: () => toast(`${variable.key} copiada (se borra en 30 s)`)
  })

  return (
    <li className="grid grid-cols-[minmax(120px,220px)_1fr_auto] items-center gap-3 rounded-md bg-secondary px-3 py-1.5">
      <span className="truncate font-mono text-sm font-semibold">{variable.key}</span>
      <span className="truncate font-mono text-sm text-muted-foreground select-text">{value ?? '••••••••'}</span>
      <div className="flex gap-1">
        <Button size="icon-sm" variant="ghost" title={value === null ? 'Ver' : 'Ocultar'} onClick={toggle}>
          {value === null ? <Eye /> : <EyeOff />}
        </Button>
        <Button size="icon-sm" variant="ghost" title="Copiar (se borra del portapapeles en 30 s)" onClick={() => copy.mutate()}>
          <Copy />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-destructive"
          title="Borrar (va a la papelera de KeePass)"
          onClick={() => remove.mutate()}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

function AddVarForm({ scope }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const save = useAction(() => api.vault.set(scope, key.trim(), value), {
    onSuccess: () => {
      toast.success(`${key.trim()} guardada`)
      setKey('')
      setValue('')
    }
  })
  const importEnv = useAction(() => api.vault.importEnv(scope), {
    onSuccess: (n) => n && toast.success(`${n} variables importadas`)
  })

  return (
    <form
      className="flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (key.trim()) save.mutate()
      }}
    >
      <Input
        className="max-w-56 font-mono"
        placeholder="NOMBRE"
        spellCheck={false}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <Input
        className="font-mono"
        type="password"
        placeholder="valor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" className="h-9">
        Guardar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9"
        title="Importar variables desde un archivo .env"
        onClick={() => importEnv.mutate()}
      >
        <FileUp /> Importar .env
      </Button>
    </form>
  )
}
