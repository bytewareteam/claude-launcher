import { exec } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { gitPath } from './git'

// «Iniciar desarrollo»: worktree nuevo desde la rama principal, dependencias instaladas y Claude
// abierto en modo plan con el elemento de trabajo (historia, tarea o bug) como contexto.

// Carpeta (ignorada por git) donde se deja el contexto dentro del worktree.
export const CONTEXT_DIR = '.claude-launcher'
const CONTEXT_FILE = 'contexto.md'
const MAX_CONTEXT = 200_000

// Junto al repo, como en el flujo de AGENTS.md: ../<repo>-worktrees/<rama>.
export const worktreePath = (repoPath, branch) =>
  join(dirname(repoPath), `${basename(repoPath)}-worktrees`, ...branch.split('/'))

// Comando de instalación según los archivos de la raíz; null si no se reconoce ninguno.
// Por orden: el lockfile decide el gestor de paquetes antes que el package.json.
const INSTALLERS = [
  ['pnpm-lock.yaml', 'pnpm install'],
  ['yarn.lock', 'yarn install'],
  ['bun.lock', 'bun install'],
  ['bun.lockb', 'bun install'],
  ['package-lock.json', 'npm install'],
  ['package.json', 'npm install'],
  ['uv.lock', 'uv sync'],
  ['poetry.lock', 'poetry install']
]

export function installCommand(dir) {
  const found = INSTALLERS.find(([file]) => existsSync(join(dir, file)))
  if (found) return found[1]
  if (readdirSync(dir).some((f) => /\.(sln|slnx)$/i.test(f))) return 'dotnet restore'
  return null
}

// Instala con el entorno completo del usuario (como su terminal): los registros privados suelen
// necesitar su configuración. Sin secretos de la bóveda.
export function install(dir) {
  const cmd = installCommand(dir)
  if (!cmd) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    // Comando fijo de la lista: la shell solo resuelve npm.cmd, pnpm.cmd…
    exec(
      cmd,
      { cwd: dir, timeout: 20 * 60_000, windowsHide: true, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve(cmd)
        const tail = (stderr || stdout || err.message).trim().split(/\r?\n/).slice(-15).join('\n')
        reject(new Error(`«${cmd}» falló:\n${tail}`))
      }
    )
  })
}

// Escribe el contexto en el worktree y lo excluye de git (info/exclude es común a los worktrees).
// Devuelve la ruta relativa que se le pasa a Claude.
export async function writeContext(wtPath, markdown) {
  const dir = join(wtPath, CONTEXT_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, CONTEXT_FILE), String(markdown).slice(0, MAX_CONTEXT))
  const exclude = await gitPath(wtPath, 'info/exclude')
  const line = `/${CONTEXT_DIR}/`
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!current.split(/\r?\n/).includes(line)) {
    mkdirSync(dirname(exclude), { recursive: true })
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`)
  }
  return `${CONTEXT_DIR}/${CONTEXT_FILE}`
}

// Prompt inicial: sin comillas, punto y coma ni caracteres que cmd.exe interprete.
export const planPrompt = (file) =>
  `Lee ${file}: contiene el elemento de trabajo que vamos a desarrollar en esta rama. ` +
  'Analiza el código del repositorio y propón un plan de cambios. ' +
  'No modifiques ningún archivo hasta que apruebe el plan.'
