import { useState } from 'react'
import { Check, FolderGit2, FolderPlus, GitBranch, KeyRound, Puzzle, Search, ShieldPlus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { searchShortcut } from '@/components/CommandPalette'
import { useAskVault } from '@/components/VaultProvider'
import { api } from '@/lib/api'
import { useAction, useVaultStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'
import logo from '@claude-launcher/design-tokens/logo.svg'

const STEPS = ['welcome', 'project', 'repo', 'vault', 'launch']

// Tutorial guiado: cada paso se puede hacer desde aquí mismo o saltarse.
export function Onboarding({ open, onOpenChange, projects, onSelect }) {
  const [step, setStep] = useState(0)
  const [projectId, setProjectId] = useState(null)
  // El diálogo de la bóveda es otro modal: ocultamos el tutorial mientras está abierto.
  const [hidden, setHidden] = useState(false)
  const project = projects.find((p) => p.id === projectId) ?? projects[0]
  const last = step === STEPS.length - 1

  const finish = useAction(api.onboarding.done)
  const close = () => {
    finish.mutate()
    onOpenChange(false)
    setStep(0)
    if (project) onSelect(project.id)
  }

  return (
    <Dialog open={open && !hidden} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-xl">
        <Progress step={step} />
        {STEPS[step] === 'welcome' && <Welcome />}
        {STEPS[step] === 'project' && <ProjectStep project={project} onCreated={setProjectId} />}
        {STEPS[step] === 'repo' && <RepoStep project={project} />}
        {STEPS[step] === 'vault' && <VaultStep onHide={setHidden} />}
        {STEPS[step] === 'launch' && <LaunchStep />}
        <DialogFooter className="items-center sm:justify-between">
          <Button variant="ghost" className={cn('text-muted-foreground', last && 'invisible')} onClick={close}>
            Saltar tutorial
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                Atrás
              </Button>
            )}
            <Button onClick={() => (last ? close() : setStep(step + 1))}>
              {last ? 'Empezar' : step === 0 ? 'Comenzar' : 'Siguiente'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Progress({ step }) {
  return (
    <div className="flex gap-1.5" aria-label={`Paso ${step + 1} de ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <span key={s} className={cn('h-1 flex-1 rounded-full bg-muted', i <= step && 'bg-primary')} />
      ))}
    </div>
  )
}

function Step({ icon: Icon, title, description, children }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Icon className="size-5 text-primary" /> {title}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
    </>
  )
}

const Done = ({ children }) => (
  <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
    <Check className="size-4 text-primary" /> {children}
  </p>
)

function Welcome() {
  return (
    <>
      <DialogHeader className="items-center text-center sm:text-center">
        <img src={logo} alt="" className="mb-2 size-14" />
        <DialogTitle>Te damos la bienvenida a Claude Launcher</DialogTitle>
        <DialogDescription>
          En cuatro pasos tendrás tu primer proyecto listo para abrir Claude Code con sus variables de entorno.
        </DialogDescription>
      </DialogHeader>
      <ul className="grid gap-2 text-sm">
        <Bullet icon={FolderGit2}>Agrupa tus repositorios git por proyecto.</Bullet>
        <Bullet icon={GitBranch}>Ve sus worktrees y su estado frente a la rama base.</Bullet>
        <Bullet icon={KeyRound}>Guarda secretos en una bóveda KeePass cifrada.</Bullet>
        <Bullet icon={Terminal}>Abre Claude Code con solo esas variables inyectadas.</Bullet>
      </ul>
    </>
  )
}

const Bullet = ({ icon: Icon, children }) => (
  <li className="flex items-center gap-3 rounded-md bg-card px-3 py-2">
    <Icon className="size-4 shrink-0 text-muted-foreground" /> {children}
  </li>
)

function ProjectStep({ project, onCreated }) {
  const [name, setName] = useState('')
  const addProject = useAction(api.addProject, {
    onSuccess: (id) => {
      setName('')
      onCreated(id)
    }
  })

  return (
    <Step
      icon={FolderPlus}
      title="Crea un proyecto"
      description="Un proyecto agrupa los repositorios con los que trabajas juntos (p. ej. el front y la API de un producto)."
    >
      {project && <Done>Proyecto «{project.name}» listo.</Done>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) addProject.mutate(name.trim())
        }}
      >
        <Input
          autoFocus
          placeholder={project ? 'Otro proyecto (opcional)' : 'Nombre del proyecto'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant={project ? 'outline' : 'default'} disabled={!name.trim() || addProject.isPending}>
          Crear
        </Button>
      </form>
    </Step>
  )
}

function RepoStep({ project }) {
  const addRepo = useAction(async () => {
    const path = await api.pickRepo()
    if (path) await api.addRepo(project.id, path)
  })

  return (
    <Step
      icon={FolderGit2}
      title="Añade un repositorio"
      description="Elige la carpeta de un repositorio git. La app listará sus worktrees y si tienen cambios sin commitear o commits pendientes frente a la rama base."
    >
      {!project ? (
        <p className="text-sm text-muted-foreground">Crea antes un proyecto en el paso anterior.</p>
      ) : (
        <>
          {project.repos.length > 0 && (
            <Done>
              {project.repos.length === 1
                ? `Repositorio «${project.repos[0].name}» añadido.`
                : `${project.repos.length} repositorios en «${project.name}».`}
            </Done>
          )}
          <Button
            variant={project.repos.length ? 'outline' : 'default'}
            className="self-start"
            disabled={addRepo.isPending}
            onClick={() => addRepo.mutate()}
          >
            <FolderPlus /> Añadir repositorio a «{project.name}»
          </Button>
        </>
      )}
    </Step>
  )
}

function VaultStep({ onHide }) {
  const { data: vault } = useVaultStatus()
  const askVault = useAskVault()

  const open = async () => {
    onHide(true)
    await askVault()
    onHide(false)
  }

  return (
    <Step
      icon={ShieldPlus}
      title="Guarda tus secretos"
      description="Las variables de entorno (tokens, claves de API…) se guardan cifradas en una bóveda KeePass, por proyecto o por repositorio. Solo se inyectan en la sesión de Claude que abras."
    >
      {vault?.unlocked ? (
        <Done>Bóveda desbloqueada. Añade variables desde la vista de cada proyecto.</Done>
      ) : (
        <Button className="self-start" onClick={open}>
          <ShieldPlus /> {vault?.exists ? 'Desbloquear bóveda' : 'Crear bóveda'}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Puedes usar un .kdbx que ya tengas. La bóveda se bloquea sola tras 15 minutos de inactividad.
      </p>
    </Step>
  )
}

function LaunchStep() {
  return (
    <Step icon={Terminal} title="Abre Claude Code" description="Todo listo. Así se usa en el día a día:">
      <ul className="grid gap-2 text-sm">
        <Bullet icon={Terminal}>
          Pulsa «Abrir Claude» en un repo o worktree: se abre una pestaña de Windows Terminal con sus variables.
        </Bullet>
        <Bullet icon={Search}>
          <span>
            Pulsa <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">{searchShortcut}</kbd> para
            buscar proyectos y worktrees desde cualquier sitio.
          </span>
        </Bullet>
        <Bullet icon={Puzzle}>Amplía la app desde «Configuración → Extensiones» en la barra lateral.</Bullet>
      </ul>
      <p className="text-xs text-muted-foreground">Puedes volver a ver este tutorial desde la pantalla de inicio.</p>
    </Step>
  )
}
