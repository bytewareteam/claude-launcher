import { useEffect, useState } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { Sidebar, sidebarShortcut } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { ProjectView } from '@/components/ProjectView'
import { Home } from '@/components/Home'
import { CommandPalette, isMac } from '@/components/CommandPalette'
import { ExtensionView } from '@/components/ExtensionView'
import { SettingsPage } from '@/components/SettingsPage'
import { VaultPage } from '@/components/VaultPage'
import { Onboarding } from '@/components/Onboarding'
import { useExtensions, useOnboardingPending, useProjects } from '@/lib/queries'

const readSelected = () => {
  try {
    return localStorage.getItem('selectedProject') || null
  } catch {
    return null
  }
}

const readSidebarOpen = () => {
  try {
    return localStorage.getItem('sidebarOpen') !== 'false'
  } catch {
    return true
  }
}

// 'extensions' era la página del gestor antes de Configuración: abre su pestaña.
const SETTINGS_IDS = ['settings', 'extensions']

export default function App() {
  const { data: projects = [] } = useProjects()
  const { data: extensions = [] } = useExtensions()
  // null = inicio; 'vault' y 'settings' = esas páginas; 'ext:<id>/<vista>' = vista de una extensión.
  const [selectedId, setSelectedId] = useState(readSelected)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const { data: onboardingPending } = useOnboardingPending()
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const project = projects.find((p) => p.id === selectedId)
  const extViews = extensions
    .filter((e) => e.enabled)
    .flatMap((e) => e.views.map((v) => ({ key: `ext:${e.id}/${v.id}`, extension: e, view: v })))
  const extView = extViews.find((v) => v.key === selectedId)
  const activeId =
    project?.id ??
    extView?.key ??
    (SETTINGS_IDS.includes(selectedId) ? 'settings' : selectedId === 'vault' ? 'vault' : null)

  useEffect(() => {
    try {
      localStorage.setItem('selectedProject', selectedId ?? '')
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [selectedId])

  useEffect(() => {
    try {
      localStorage.setItem('sidebarOpen', String(sidebarOpen))
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [sidebarOpen])

  // Doble pulsación de Ctrl (⌘ en Mac). En captura, para que ningún componente que pare el evento
  // se lo trague; otra tecla entre medias (Ctrl+K, Ctrl+C…) lo anula.
  useEffect(() => {
    const mod = isMac ? 'Meta' : 'Control'
    let clean = false
    let lastUp = 0
    const onDown = (e) => {
      if (e.key !== mod) {
        clean = false
        lastUp = 0
      } else if (!e.repeat) {
        if (performance.now() - lastUp < 400) {
          lastUp = 0
          clean = false
          setSidebarOpen((o) => !o)
        } else clean = true
      }
    }
    const onUp = (e) => {
      if (e.key === mod) lastUp = clean ? performance.now() : 0
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [])

  // Primera ejecución: el tutorial se abre solo una vez.
  useEffect(() => {
    if (onboardingPending) setTutorialOpen(true)
  }, [onboardingPending])

  return (
    <div className="flex h-screen">
      {/* Cerrado sigue montado (ancho 0): aloja el diálogo de nuevo proyecto que abre la paleta. */}
      <div
        className="shrink-0 overflow-hidden transition-[width] duration-200"
        style={{ width: sidebarOpen ? 260 : 0 }}
        inert={!sidebarOpen}
      >
        <Sidebar
          projects={projects}
          extViews={extViews}
          selectedId={activeId}
          onSelect={setSelectedId}
          onSearch={() => setSearchOpen(true)}
          onClose={() => setSidebarOpen(false)}
          newProjectOpen={newProjectOpen}
          onNewProjectOpenChange={setNewProjectOpen}
        />
      </div>
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 left-3 z-10 text-muted-foreground"
          title={`Mostrar menú (${sidebarShortcut})`}
          onClick={() => setSidebarOpen(true)}
        >
          <PanelLeftOpen />
        </Button>
      )}
      <main className={`min-w-0 flex-1 overflow-y-auto py-6 pr-7 ${sidebarOpen ? 'pl-7' : 'pl-14'}`}>
        {project ? (
          <ProjectView
            key={project.id}
            project={project}
            onRemoved={() => setSelectedId(null)}
            onOpenExtensions={() => setSelectedId('extensions')}
          />
        ) : extView ? (
          <ExtensionView key={extView.key} extension={extView.extension} view={extView.view} />
        ) : activeId === 'vault' ? (
          <VaultPage />
        ) : activeId === 'settings' ? (
          <SettingsPage initialTab={selectedId === 'extensions' ? 'extensions' : undefined} />
        ) : (
          <Home
            projects={projects}
            onSelect={setSelectedId}
            onTutorial={() => setTutorialOpen(true)}
          />
        )}
      </main>
      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        projects={projects}
        onSelect={setSelectedId}
        onNewProject={() => setNewProjectOpen(true)}
      />
      <Onboarding
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        projects={projects}
        onSelect={setSelectedId}
      />
    </div>
  )
}
