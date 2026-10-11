import { execFile } from 'child_process'
import { normalize, resolve } from 'path'
import { existsSync } from 'fs'
import { resolveBin } from './which'

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(resolveBin('git') || 'git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}

export async function repoRoot(dir) {
  try {
    return normalize((await git(['rev-parse', '--show-toplevel'], dir)).trim())
  } catch {
    throw new Error('La carpeta seleccionada no es un repositorio git.')
  }
}

// Parsea la salida de `git worktree list --porcelain`.
export async function listWorktrees(repoPath) {
  const out = await git(['worktree', 'list', '--porcelain'], repoPath)
  return out
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => {
      const wt = { main: i === 0 }
      for (const line of block.split(/\r?\n/)) {
        const [key, ...rest] = line.split(' ')
        const value = rest.join(' ')
        if (key === 'worktree') wt.path = normalize(value)
        else if (key === 'HEAD') wt.head = value.slice(0, 7)
        else if (key === 'branch') wt.branch = value.replace('refs/heads/', '')
        else if (key === 'detached') wt.detached = true
        else if (key === 'bare') wt.bare = true
        else if (key === 'locked') wt.locked = true
        else if (key === 'prunable') wt.prunable = true
      }
      return wt
    })
}

// Ramas remotas (origin/develop, ...), sin los alias HEAD.
export async function remoteBranches(repoPath) {
  const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], repoPath)
  return out
    .split(/\r?\n/)
    .filter((b) => b.includes('/') && !b.endsWith('/HEAD'))
    .sort()
}

// URL web del remoto (origin o, si no existe, el primero) a partir de su URL https o ssh.
export async function remoteWebUrl(repoPath) {
  const remotes = (await git(['remote'], repoPath)).split(/\r?\n/).filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote) throw new Error('El repositorio no tiene remotos configurados.')
  const url = (await git(['remote', 'get-url', remote], repoPath)).trim()
  // git@host:org/repo.git · ssh://git@host[:puerto]/org/repo.git · https://user@host/org/repo.git
  const m =
    url.match(/^[\w.-]+@([^:/]+):(.+)$/) ||
    url.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/) ||
    url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/)
  if (!m) throw new Error(`No se reconoce la URL del remoto: ${url}`)
  let [, host, path] = m
  path = path.replace(/\.git\/?$/, '').replace(/\/$/, '')
  // Azure DevOps por ssh: ssh.dev.azure.com:v3/org/proyecto/repo → dev.azure.com/org/proyecto/_git/repo
  if (host === 'ssh.dev.azure.com' && path.startsWith('v3/')) {
    const [org, project, repo] = path.slice(3).split('/')
    return `https://dev.azure.com/${org}/${project}/_git/${repo}`
  }
  return `https://${host}/${path}`
}

// Rama base (p. ej. origin/develop). Sin `-` inicial ni `..`: git la tomaría por una opción
// (`--output=…` escribe un archivo) o por un rango.
export function checkBaseBranch(base) {
  if (typeof base !== 'string' || !/^[\w][\w./-]*$/.test(base) || base.includes('..'))
    throw new Error('La rama base solo admite letras, números y los caracteres _ . / -')
  return base
}

// Qué se perdería al borrar un worktree: cambios sin commitear y commits que no están en la rama base.
export async function worktreeStatus(wtPath, base) {
  checkBaseBranch(base)
  if (!existsSync(wtPath)) return { missing: true }
  const lines = (s) => s.split(/\r?\n/).filter(Boolean)
  const dirty = lines(await git(['status', '--porcelain'], wtPath))
  const result = { dirtyCount: dirty.length, dirty: dirty.slice(0, 8), aheadCount: 0, ahead: [] }
  try {
    const ahead = lines(await git(['log', '--oneline', `${base}..HEAD`], wtPath))
    Object.assign(result, { aheadCount: ahead.length, ahead: ahead.slice(0, 8) })
  } catch {
    result.baseError = `No se pudo comparar con ${base}: ¿existe esa rama remota?`
  }
  return result
}

export async function removeWorktree(repoPath, wtPath, force) {
  if (!existsSync(wtPath)) return git(['worktree', 'prune'], repoPath)
  return git(['worktree', 'remove', ...(force ? ['--force'] : []), wtPath], repoPath)
}

// Resumen rápido de un repo para la pantalla de inicio.
export async function repoSummary(repoPath) {
  if (!existsSync(repoPath)) return { error: 'La carpeta ya no existe' }
  try {
    const [branch, last, worktrees] = await Promise.all([
      git(['branch', '--show-current'], repoPath),
      git(['log', '-1', '--format=%cI'], repoPath).catch(() => ''),
      listWorktrees(repoPath)
    ])
    // Worktrees (incluido el principal) con cambios sin commitear.
    const dirty = await Promise.all(
      worktrees
        .filter((w) => !w.bare && existsSync(w.path))
        .map((w) => git(['status', '--porcelain'], w.path).then((s) => s.trim() !== '', () => false))
    )
    return {
      branch: branch.trim(),
      dirtyWorktrees: dirty.filter(Boolean).length,
      lastCommitAt: last.trim() || null,
      worktreeCount: worktrees.filter((w) => !w.main).length
    }
  } catch (err) {
    return { error: err.message }
  }
}

// Rama por defecto del remoto (origin/HEAD → origin/main), o null si no se conoce.
export async function defaultRemoteBranch(repoPath) {
  try {
    return (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoPath)).trim() || null
  } catch {
    return null
  }
}

// Nombres de rama que admite la app: los de git, pero solo con caracteres que no interpretan ni
// Windows Terminal ni cmd.exe (el nombre acaba en el título de la pestaña).
export async function checkBranchName(repoPath, branch) {
  if (!/^[\w./-]+$/.test(branch))
    throw new Error('La rama solo admite letras, números y los caracteres _ . / -')
  try {
    await git(['check-ref-format', '--branch', branch], repoPath)
  } catch {
    throw new Error(`«${branch}» no es un nombre de rama válido.`)
  }
}

// Crea un worktree en `wtPath` con la rama `branch`. Si la rama ya existe se reutiliza; si no, se
// crea desde `base` (actualizada antes con un fetch) sin seguirla: `git push` no debe ir a la base.
export async function addWorktree(repoPath, wtPath, branch, base) {
  const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoPath).then(
    () => true,
    () => false
  )
  if (exists) return git(['worktree', 'add', wtPath, branch], repoPath)
  const remotes = (await git(['remote'], repoPath)).split(/\r?\n/).filter(Boolean)
  const remote = remotes.find((r) => base.startsWith(`${r}/`))
  // Sin red se sigue con lo que haya en local.
  if (remote) await git(['fetch', remote, base.slice(remote.length + 1)], repoPath).catch(() => {})
  return git(['worktree', 'add', '--no-track', '-b', branch, wtPath, base], repoPath)
}

// Ruta de un archivo de git del repo (p. ej. info/exclude, común a todos los worktrees).
export async function gitPath(dir, path) {
  return resolve(dir, (await git(['rev-parse', '--git-path', path], dir)).trim())
}
