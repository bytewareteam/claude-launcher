import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { ProjectView } from '@/components/ProjectView'
import { Home } from '@/components/Home'
import { CommandPalette } from '@/components/CommandPalette'
import { ExtensionView } from '@/components/ExtensionView'
import { SettingsPage } from '@/components/SettingsPage'
import { Onboarding } from '@/components/Onboarding'
import { useExtensions, useOnboardingPending, useProjects } from '@/lib/queries'

const readSelected = () => {
  try {
    return localStorage.getItem('selectedProject') || null
  } catch {
    return null
  }
}

// 'extensions' era la página del gestor antes de Configuración: abre su pestaña.
const SETTINGS_IDS = ['settings', 'extensions']

export default function App() {
  const { data: projects = [] } = useProjects()
  const { data: extensions = [] } = useExtensions()
  // null = inicio; 'settings' = configuración; 'ext:<id>/<vista>' = vista de una extensión.
  const [selectedId, setSelectedId] = useState(readSelected)
  const [searchOpen, setSearchOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const { data: onboardingPending } = useOnboardingPending()
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const project = projects.find((p) => p.id === selectedId)
  const extViews = extensions
    .filter((e) => e.enabled)
    .flatMap((e) => e.views.map((v) => ({ key: `ext:${e.id}/${v.id}`, extension: e, view: v })))
  const extView = extViews.find((v) => v.key === selectedId)
  const activeId =
    project?.id ?? extView?.key ?? (SETTINGS_IDS.includes(selectedId) ? 'settings' : null)

  useEffect(() => {
    try {
      localStorage.setItem('selectedProject', selectedId ?? '')
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [selectedId])

  // Primera ejecución: el tutorial se abre solo una vez.
  useEffect(() => {
    if (onboardingPending) setTutorialOpen(true)
  }, [onboardingPending])

  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <Sidebar
        projects={projects}
        extViews={extViews}
        selectedId={activeId}
        onSelect={setSelectedId}
        onSearch={() => setSearchOpen(true)}
        newProjectOpen={newProjectOpen}
        onNewProjectOpenChange={setNewProjectOpen}
      />
      <main className="min-w-0 overflow-y-auto px-7 py-6">
        {project ? (
          <ProjectView
            key={project.id}
            project={project}
            onRemoved={() => setSelectedId(null)}
            onOpenExtensions={() => setSelectedId('extensions')}
          />
        ) : extView ? (
          <ExtensionView key={extView.key} extension={extView.extension} view={extView.view} />
        ) : activeId === 'settings' ? (
          <SettingsPage initialTab={selectedId === 'extensions' ? 'extensions' : undefined} />
        ) : (
          <Home projects={projects} onSelect={setSelectedId} onTutorial={() => setTutorialOpen(true)} />
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
