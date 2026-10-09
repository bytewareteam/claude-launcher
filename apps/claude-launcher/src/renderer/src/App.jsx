import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { ProjectView } from '@/components/ProjectView'
import { Home } from '@/components/Home'
import { CommandPalette } from '@/components/CommandPalette'
import { useProjects } from '@/lib/queries'

const readSelected = () => {
  try {
    return localStorage.getItem('selectedProject') || null
  } catch {
    return null
  }
}

export default function App() {
  const { data: projects = [] } = useProjects()
  // null = pantalla de inicio
  const [selectedId, setSelectedId] = useState(readSelected)
  const [searchOpen, setSearchOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const project = projects.find((p) => p.id === selectedId)

  useEffect(() => {
    try {
      localStorage.setItem('selectedProject', selectedId ?? '')
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [selectedId])

  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <Sidebar
        projects={projects}
        selectedId={project?.id ?? null}
        onSelect={setSelectedId}
        onSearch={() => setSearchOpen(true)}
        newProjectOpen={newProjectOpen}
        onNewProjectOpenChange={setNewProjectOpen}
      />
      <main className="min-w-0 overflow-y-auto px-7 py-6">
        {project ? (
          <ProjectView key={project.id} project={project} onRemoved={() => setSelectedId(null)} />
        ) : (
          <Home projects={projects} onSelect={setSelectedId} />
        )}
      </main>
      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        projects={projects}
        onSelect={setSelectedId}
        onNewProject={() => setNewProjectOpen(true)}
      />
    </div>
  )
}
