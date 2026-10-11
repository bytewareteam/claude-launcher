import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage } from 'electron'
import { join, basename, resolve, normalize } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes, randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import dotenv from 'dotenv'
import * as vault from './vault'
import {
  repoRoot,
  listWorktrees,
  remoteBranches,
  worktreeStatus,
  removeWorktree,
  repoSummary,
  remoteWebUrl,
  defaultRemoteBranch,
  checkBranchName,
  checkBaseBranch,
  addWorktree
} from './git'
import { openClaude, openShell, hasClaudeSession, CLAUDE_ARGS } from './terminal'
import { claudeOptions } from './claude-cli'
import { BINARIES, checkBinary, setBinaries, systemBinaries } from './which'
import * as dev from './dev'
import * as ide from './ide'
import * as extensions from './extensions'
import * as mcp from './mcp'
import { writeSecret } from './clipboard'
import icon from '../../resources/icon.png?asset'

// Misma carpeta de datos en desarrollo y en la app instalada
// (si no, la instalada usaría "Claude Launcher" por el productName).
app.setPath('userData', join(app.getPath('appData'), 'claude-launcher'))

// Reutiliza el data.json de la versión anterior.
const store = new Store({ name: 'data', defaults: { projects: [], launches: [] } })

const DEFAULT_BASE_BRANCH = 'origin/develop'

// Configuración editable desde la pantalla «Configuración».
const DEFAULT_SETTINGS = {
  claude: { args: '', newWindow: false },
  vault: { autoLockMinutes: 15, clipboardSeconds: 30 },
  mcp: { enabled: true, port: 47821, autoConnect: true },
  // Ruta propia de cada programa que lanza la app; vacía = la del PATH del sistema.
  binaries: Object.fromEntries(Object.keys(BINARIES).map((n) => [n, '']))
}

function settings() {
  const saved = store.get('settings', {})
  return {
    claude: { ...DEFAULT_SETTINGS.claude, ...saved.claude },
    vault: { ...DEFAULT_SETTINGS.vault, ...saved.vault },
    mcp: { ...DEFAULT_SETTINGS.mcp, ...saved.mcp },
    binaries: { ...DEFAULT_SETTINGS.binaries, ...saved.binaries }
  }
}

const clampInt = (value, min, max, name) => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} debe ser un número entero entre ${min} y ${max}.`)
  return n
}

// Valida solo los campos recibidos y guarda el resultado completo.
function updateSettings(patch = {}) {
  const next = settings()
  if (patch.claude) {
    const { args, newWindow } = patch.claude
    if (args !== undefined) {
      if (typeof args !== 'string' || !CLAUDE_ARGS.test(args))
        throw new Error('Los argumentos solo admiten letras, números, espacios y - = . : / , @')
      next.claude.args = args.trim()
    }
    if (newWindow !== undefined) next.claude.newWindow = !!newWindow
  }
  if (patch.vault) {
    const { autoLockMinutes, clipboardSeconds } = patch.vault
    if (autoLockMinutes !== undefined)
      next.vault.autoLockMinutes = clampInt(autoLockMinutes, 1, 240, 'El autobloqueo')
    if (clipboardSeconds !== undefined)
      next.vault.clipboardSeconds = clampInt(
        clipboardSeconds,
        5,
        300,
        'La limpieza del portapapeles'
      )
  }
  if (patch.mcp) {
    const { enabled, port, autoConnect } = patch.mcp
    if (enabled !== undefined) next.mcp.enabled = !!enabled
    if (port !== undefined) next.mcp.port = clampInt(port, 1024, 65535, 'El puerto')
    if (autoConnect !== undefined) next.mcp.autoConnect = !!autoConnect
  }
  if (patch.binaries)
    for (const [name, file] of Object.entries(patch.binaries))
      next.binaries[name] = checkBinary(name, file)
  const mcpChanged = JSON.stringify(next.mcp) !== JSON.stringify(settings().mcp)
  store.set('settings', next)
  vault.setAutoLockMinutes(next.vault.autoLockMinutes)
  setBinaries(next.binaries)
  if (mcpChanged) startMcp()
  return next
}

const defaultVaultPath = () => join(app.getPath('userData'), 'secrets.kdbx')
const vaultPath = () => store.get('vaultPath') || defaultVaultPath()

const projects = () => store.get('projects')

function updateProjects(fn) {
  const list = projects()
  fn(list)
  store.set('projects', list)
  return list
}

const findProject = (list, id) => {
  const p = list.find((x) => x.id === id)
  if (!p) throw new Error('Proyecto no encontrado')
  return p
}

// Traduce { projectId, repoId? } del renderer a un scope con nombres para la bóveda.
function resolveScope({ projectId, repoId }) {
  const p = findProject(projects(), projectId)
  const scope = { projectId, projectName: p.name }
  if (repoId) {
    const r = p.repos.find((x) => x.id === repoId)
    if (!r) throw new Error('Repositorio no encontrado')
    Object.assign(scope, { repoId, repoName: r.name })
  }
  return scope
}

const windowOf = (e) => BrowserWindow.fromWebContents(e.sender)

const devRendererUrl = () => (is.dev ? process.env.ELECTRON_RENDERER_URL : null)
const rendererIndex = () => join(__dirname, '../renderer/index.html')

// Solo la página de la app, en su marco principal, habla con el proceso principal: si el renderer
// llegara a navegar o a cargar otro marco, esos no heredan la API.
function isAppFrame(frame) {
  if (!frame || frame.parent) return false
  try {
    const url = new URL(frame.url)
    const dev = devRendererUrl()
    if (dev) return url.origin === new URL(dev).origin
    return (
      url.protocol === 'file:' &&
      normalize(fileURLToPath(url)).toLowerCase() === normalize(rendererIndex()).toLowerCase()
    )
  } catch {
    return false
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isAppFrame(e.senderFrame)) throw new Error('Petición rechazada: no viene de la app.')
    return fn(e, ...args)
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: '#1b1d22',
    title: 'Claude Launcher',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  // La ventana nunca sale de su página: los enlaces https van al navegador y el resto se descarta.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('ready-to-show', () => win.show())
  if (devRendererUrl()) win.loadURL(devRendererUrl())
  else win.loadFile(rendererIndex())
}

// --- Proyectos y repos ------------------------------------------------------------

handle('projects:list', () => projects())

handle('project:add', (_e, name) => {
  const id = randomUUID()
  updateProjects((list) => list.push({ id, name, repos: [] }))
  return id
})

handle('project:rename', (_e, id, name) =>
  updateProjects((list) => (findProject(list, id).name = name))
)

// Extensión de tablero (Jira, Azure Boards…) cuyas pestañas muestra el proyecto; null la quita.
handle('project:setBoard', (_e, id, extId) =>
  updateProjects((list) => {
    const p = findProject(list, id)
    if (extId) p.board = String(extId)
    else delete p.board
  })
)

handle('project:remove', (_e, id) =>
  store.set(
    'projects',
    projects().filter((p) => p.id !== id)
  )
)

// Carpetas elegidas en el diálogo de `repo:pick`: `repo:add` solo acepta una de estas.
const pickedRepos = new Set()

handle('repo:pick', async (e) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Selecciona la carpeta del repositorio',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  const root = await repoRoot(res.filePaths[0])
  pickedRepos.add(root)
  return root
})

const findRepo = (projectId, repoId) => {
  const r = findProject(projects(), projectId).repos.find((x) => x.id === repoId)
  if (!r) throw new Error('Repositorio no encontrado')
  return r
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const allRepos = () => projects().flatMap((p) => p.repos.map((r) => ({ project: p, repo: r })))

// Repo registrado con esa ruta exacta.
function registeredRepo(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath) throw new Error('Ruta no válida.')
  const found = allRepos().find(({ repo }) => samePath(repo.path, repoPath))
  if (!found) throw new Error(`${repoPath} no es un repositorio registrado.`)
  return found.repo
}

// Últimos worktrees vistos de cada repo: validar una ruta conocida no relanza git cada vez.
const worktreeCache = new Map()

async function worktreesOf(repoPath) {
  const list = await listWorktrees(repoPath)
  worktreeCache.set(repoPath, list)
  return list
}

// Repo registrado (o worktree suyo) que contiene exactamente `dir`. Mira primero los worktrees ya
// conocidos y, si no está, vuelve a preguntar a git.
async function findByPath(dir) {
  if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida.')
  const all = allRepos()
  const direct = all.find(({ repo }) => samePath(repo.path, dir))
  if (direct) return { ...direct, branch: null }
  const match = (entry, wts) => {
    const wt = wts.find((w) => w.path && samePath(w.path, dir))
    return wt && { ...entry, branch: wt.branch ?? null, path: wt.path }
  }
  for (const entry of all) {
    const found = match(entry, worktreeCache.get(entry.repo.path) ?? [])
    if (found) return found
  }
  // La caché puede no tener aún un worktree recién creado (o estar vacía): se pregunta a git.
  for (const entry of all) {
    const found = match(entry, await worktreesOf(entry.repo.path).catch(() => []))
    if (found) return found
  }
  throw new Error(
    `${dir} no es un repositorio registrado ni uno de sus worktrees (¿lo quitaste o se borró?).`
  )
}

// Ruta registrada (repo o worktree) tal y como la conoce la app.
const knownDir = async (dir) => {
  const { repo, path } = await findByPath(dir)
  return path || repo.path
}

// La rama principal empieza siendo la del remoto (origin/HEAD) si git la conoce.
async function addRepo(projectId, repoPath) {
  const baseBranch = (await defaultRemoteBranch(repoPath)) || DEFAULT_BASE_BRANCH
  return updateProjects((list) => {
    const p = findProject(list, projectId)
    if (!p.repos.some((r) => samePath(r.path, repoPath))) {
      p.repos.push({ id: randomUUID(), name: basename(repoPath), path: repoPath, baseBranch })
    }
  })
}

handle('repo:add', (_e, projectId, repoPath) => {
  if (!pickedRepos.has(repoPath)) throw new Error('Elige el repositorio desde el diálogo.')
  pickedRepos.delete(repoPath)
  return addRepo(projectId, repoPath)
})

handle('repo:remove', (_e, projectId, repoId) =>
  updateProjects((list) => {
    const p = findProject(list, projectId)
    p.repos = p.repos.filter((r) => r.id !== repoId)
  })
)

handle('repo:worktrees', (_e, repoPath) => worktreesOf(registeredRepo(repoPath).path))
handle('repo:remoteBranches', (_e, repoPath) => remoteBranches(registeredRepo(repoPath).path))

handle('repo:setBase', (_e, projectId, repoId, branch) =>
  updateProjects((list) => {
    const r = findProject(list, projectId).repos.find((x) => x.id === repoId)
    if (r) r.baseBranch = checkBaseBranch(branch)
  })
)

handle('worktree:status', async (_e, wtPath, base) =>
  worktreeStatus(await knownDir(wtPath), base || DEFAULT_BASE_BRANCH)
)
// Solo worktrees secundarios del propio repo, comprobados con git justo antes de borrar.
handle('worktree:remove', async (_e, repoPath, wtPath, force) => {
  const repo = registeredRepo(repoPath)
  const wt = (await worktreesOf(repo.path)).find(
    (w) => !w.main && w.path && samePath(w.path, String(wtPath))
  )
  if (!wt) throw new Error(`${wtPath} no es un worktree de ${repo.name}.`)
  return removeWorktree(repo.path, wt.path, !!force)
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cada sesión lleva un id propio (`--session-id`) para poder reanudarla después con `--resume`.
// Las entradas antiguas del historial no lo tienen: se continúa la última conversación de la
// carpeta. Si el usuario fija ya estos argumentos en la configuración, mandan los suyos.
function sessionArgs(dir, { resume = false, sessionId } = {}) {
  if (/(^|\s)(-c|-r|--continue|--resume|--session-id)(\s|=|$)/.test(settings().claude.args))
    return { args: [] }
  if (resume && sessionId) {
    if (!UUID.test(sessionId)) throw new Error('Id de sesión no válido.')
    // Sin ningún mensaje Claude no la guardó: se abre de nuevo con el mismo id.
    const flag = hasClaudeSession(dir, sessionId) ? '--resume' : '--session-id'
    return { sessionId, args: [flag, sessionId] }
  }
  if (resume && hasClaudeSession(dir)) return { args: ['--continue'] }
  const id = randomUUID()
  return { sessionId: id, args: ['--session-id', id] }
}

// Abre Claude con las variables de la bóveda del scope (si está desbloqueada) y lo apunta en el
// historial. Devuelve cuántas variables se inyectaron.
function launchClaude(dir, title, scope, extraArgs = [], resume) {
  let env = {}
  if (scope && vault.isUnlocked()) {
    const project = resolveScope({ projectId: scope.projectId })
    env = vault.envFor(project, scope.repoId ? resolveScope(scope) : null)
  }
  const session = sessionArgs(dir, resume)
  const tabTitle = openClaude(dir, title, env, settings().claude, [
    ...mcpArgs(),
    ...session.args,
    ...extraArgs
  ])
  // Historial de sesiones para la pantalla de inicio (últimas 500).
  const launch = { at: new Date().toISOString(), dir, title: tabTitle, ...scope }
  if (session.sessionId) launch.sessionId = session.sessionId
  store.set('launches', [launch, ...store.get('launches')].slice(0, 500))
  return Object.keys(env).length
}

// `resume`: `{ resume: true, sessionId }` reanuda esa sesión del historial.
// Las variables del scope solo se inyectan en una carpeta de ese mismo proyecto/repo.
handle('open:claude', async (_e, dir, title, scope, resume) => {
  const { repo, path } = await findByPath(dir)
  if (scope) {
    const p = findProject(projects(), scope.projectId)
    const owners = scope.repoId ? [findRepo(p.id, scope.repoId)] : p.repos
    if (!owners.some((r) => samePath(r.path, repo.path)))
      throw new Error('La carpeta no pertenece a ese proyecto o repositorio.')
  }
  return launchClaude(path || repo.path, title, scope, [], resume)
})

// --- Iniciar desarrollo -----------------------------------------------------------
// Una extensión lo pide (`ctx.dev.start`), el renderer muestra el diálogo y va llamando a cada
// paso. La ruta del worktree y el contexto se quedan aquí: el renderer solo maneja el id.

const devRequests = new Map()

function devRequest(id) {
  const req = devRequests.get(id)
  if (!req) throw new Error('La petición de desarrollo ya no existe.')
  return req
}

handle('dev:worktree', async (_e, id, repoId, branch) => {
  const req = devRequest(id)
  const repo = findRepo(req.projectId, repoId)
  await checkBranchName(repo.path, branch)
  // Si la rama ya tiene worktree se retoma ahí, sin crear nada.
  const existing = (await listWorktrees(repo.path)).find((w) => w.branch === branch)
  let path = existing?.path
  if (!path) {
    path = dev.worktreePath(repo.path, branch)
    if (existsSync(path)) throw new Error(`Ya existe la carpeta ${path}.`)
    await addWorktree(repo.path, path, branch, repo.baseBranch || DEFAULT_BASE_BRANCH)
  }
  Object.assign(req, { repoId, branch, path })
  return { path, created: !existing, install: dev.installCommand(path) }
})

handle('dev:install', (_e, id) => dev.install(devRequest(id).path))

handle('dev:open', async (_e, id) => {
  const req = devRequest(id)
  if (!req.path) throw new Error('Falta crear el worktree.')
  const file = await dev.writeContext(req.path, req.context)
  // Modo plan salvo que el usuario ya fije otro en la configuración.
  const mode = /--permission-mode/.test(settings().claude.args) ? [] : ['--permission-mode', 'plan']
  const repo = findRepo(req.projectId, req.repoId)
  const scope = { projectId: req.projectId, repoId: req.repoId }
  const n = launchClaude(req.path, `${repo.name}:${req.branch}`, scope, [
    ...mode,
    dev.planPrompt(file)
  ])
  devRequests.delete(id)
  return n
})

handle('dev:cancel', (_e, id) => devRequests.delete(id))

handle('dashboard', async () => {
  const list = projects()
  const repos = list.flatMap((p) => p.repos)
  const summaries = await Promise.all(repos.map((r) => repoSummary(r.path)))
  return {
    repos: Object.fromEntries(repos.map((r, i) => [r.id, summaries[i]])),
    launches: store.get('launches')
  }
})

handle('open:shell', async (_e, dir, title) => openShell(await knownDir(dir), title))
// `shell.openPath` abre (o ejecuta) cualquier archivo: solo carpetas de repos y worktrees.
handle('open:folder', async (_e, dir) => shell.openPath(await knownDir(dir)))
// IDE: el elegido por el usuario o, si no hay, el primero que se encuentre.
handle('ide:list', () => ({
  ides: ide.detect().map(({ id, name, file }) => ({ id, name, path: file })),
  selected: store.get('ide') ?? null
}))
handle('ide:setDefault', (_e, id) => store.set('ide', id))
// Con `id` abre ese IDE solo esta vez; el predeterminado se elige en Configuración.
handle('ide:open', async (_e, dir, id) => ide.open(await knownDir(dir), id || store.get('ide')))
handle('open:web', async (_e, repoPath) =>
  shell.openExternal(await remoteWebUrl(registeredRepo(repoPath).path))
)
// Enlaces del contenido HTML de las extensiones: solo https y siempre en el navegador.
handle('open:url', (_e, url) => {
  if (!/^https:\/\//i.test(url)) throw new Error('Solo se pueden abrir enlaces https.')
  return shell.openExternal(url)
})

// --- Configuración --------------------------------------------------------------

handle('settings:get', () => ({
  ...settings(),
  defaultVaultPath: defaultVaultPath(),
  systemBinaries: systemBinaries()
}))
handle('settings:pickBinary', async (e) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Selecciona el ejecutable',
    filters: [{ name: 'Programas', extensions: ['exe', 'cmd', 'bat'] }],
    properties: ['openFile']
  })
  return res.canceled ? null : res.filePaths[0] || null
})
handle('settings:set', (_e, patch) => updateSettings(patch))
handle('claude:options', () => claudeOptions())

// --- Tutorial -------------------------------------------------------------------

// Quien actualiza con proyectos ya creados no necesita el tutorial de bienvenida.
handle('onboarding:pending', () => !(store.get('onboardingDone') ?? projects().length > 0))
handle('onboarding:done', () => store.set('onboardingDone', true))

// --- Bóveda ---------------------------------------------------------------------

handle('vault:status', () => vault.status(vaultPath()))
handle('vault:create', (_e, password) => vault.create(vaultPath(), password))
handle('vault:unlock', (_e, password) => vault.unlock(vaultPath(), password))
handle('vault:lock', () => vault.lock())

handle('vault:useExisting', async (e) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Selecciona tu base de datos KeePass',
    filters: [{ name: 'KeePass', extensions: ['kdbx'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return false
  vault.lock()
  store.set('vaultPath', res.filePaths[0])
  return true
})

handle('vault:resetPath', () => {
  vault.lock()
  store.delete('vaultPath')
})
handle('vault:showFile', () => shell.showItemInFolder(vaultPath()))

handle('vault:list', (_e, scope) => vault.listVars(resolveScope(scope)))
handle('vault:get', (_e, scope, id) => vault.getValue(resolveScope(scope), id))
handle('vault:set', (_e, scope, key, value) => vault.setVars(resolveScope(scope), [{ key, value }]))
handle('vault:delete', (_e, scope, id) => vault.deleteVar(resolveScope(scope), id))

async function copySecret(value) {
  await writeSecret(value)
  // Limpia el portapapeles pasado el plazo configurado si sigue conteniendo el secreto.
  setTimeout(() => {
    if (clipboard.readText() === value) clipboard.clear()
  }, settings().vault.clipboardSeconds * 1000)
}

handle('vault:copy', (_e, scope, id) => copySecret(vault.getValue(resolveScope(scope), id)))

handle('vault:importEnv', async (e, scope) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Importar archivo .env',
    properties: ['openFile', 'showHiddenFiles']
  })
  if (res.canceled || !res.filePaths[0]) return 0
  const parsed = dotenv.parse(readFileSync(res.filePaths[0]))
  const vars = Object.entries(parsed).map(([key, value]) => ({ key, value }))
  if (vars.length) await vault.setVars(resolveScope(scope), vars)
  return vars.length
})

// Secretos generales (contraseñas, credenciales, llaves SSH…): no se inyectan en ninguna sesión.
handle('general:list', (_e, category) => vault.listGeneral(category))
handle('general:get', (_e, category, id, field) => vault.getGeneral(category, id, field))
handle('general:set', (_e, category, id, values) => vault.setGeneral(category, id, values))
handle('general:delete', (_e, category, id) => vault.deleteGeneral(category, id))
handle('general:copy', (_e, category, id, field) =>
  copySecret(vault.getGeneral(category, id, field))
)

// Guarda una llave privada (y su .pub si está al lado) sin que pase por el renderer.
handle('general:importSshKey', async (e) => {
  if (!vault.isUnlocked()) throw new Error('La bóveda está bloqueada.')
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Importar llave SSH privada',
    defaultPath: join(app.getPath('home'), '.ssh'),
    properties: ['openFile', 'showHiddenFiles']
  })
  const file = res.filePaths[0]
  if (res.canceled || !file) return null
  const privateKey = readFileSync(file, 'utf8')
  if (privateKey.length > 64 * 1024 || !/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(privateKey))
    throw new Error('El archivo no parece una llave privada SSH.')
  const pub = `${file}.pub`
  const publicKey = existsSync(pub) ? readFileSync(pub, 'utf8').trim() : ''
  const title = basename(file)
  await vault.setGeneral('ssh', null, { title, privateKey, publicKey })
  return title
})

// --- Servidor MCP ----------------------------------------------------------------
// Las sesiones de Claude hablan con la app por MCP (ver mcp.js). Sin acceso a la bóveda.

const mcpToken = () => {
  if (!store.get('mcpToken')) store.set('mcpToken', randomBytes(32).toString('hex'))
  return store.get('mcpToken')
}
const mcpConfigPath = () => join(app.getPath('userData'), 'mcp.json')

// Archivo que reciben las sesiones abiertas desde la app con --mcp-config.
function writeMcpConfig(port) {
  const config = {
    mcpServers: {
      [mcp.SERVER_NAME]: {
        type: 'http',
        url: mcp.urlFor(port),
        headers: { Authorization: `Bearer ${mcpToken()}` }
      }
    }
  }
  writeFileSync(mcpConfigPath(), JSON.stringify(config, null, 2))
}

// Con `=`: --mcp-config admite varios valores y se comería el prompt que va detrás.
function mcpArgs() {
  const { enabled, autoConnect } = settings().mcp
  return enabled && autoConnect && existsSync(mcpConfigPath())
    ? [`--mcp-config=${mcpConfigPath()}`]
    : []
}

const focusWindow = () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

const mcpApp = {
  projects: () =>
    projects().map(({ id, name, repos }) => ({
      id,
      name,
      repos: repos.map(({ id, name, path, baseBranch }) => ({ id, name, path, baseBranch }))
    })),
  worktrees: async ({ projectId, repoId, includeStatus }) => {
    const repo = findRepo(projectId, repoId)
    const list = await worktreesOf(repo.path)
    if (!includeStatus) return list
    const base = repo.baseBranch || DEFAULT_BASE_BRANCH
    return Promise.all(
      list.map(async (w) => (w.bare ? w : { ...w, status: await worktreeStatus(w.path, base) }))
    )
  },
  launches: (limit) => store.get('launches').slice(0, limit),
  openClaude: async ({ path, title }) => {
    const { project, repo, branch, path: wtPath } = await findByPath(path)
    const dir = wtPath || repo.path
    const n = launchClaude(dir, title || (branch ? `${repo.name}:${branch}` : repo.name), {
      projectId: project.id,
      repoId: repo.id
    })
    return `Sesión abierta en ${dir} con ${n} variable(s) de la bóveda.`
  },
  startDevelopment: (request) => {
    hostApi['dev.start']({ displayName: 'Claude Code' }, request)
    focusWindow()
  },
  openIde: async (path) => {
    const { repo, path: wtPath } = await findByPath(path)
    return ide.open(wtPath || repo.path, store.get('ide'))
  },
  notify: (message, kind) => broadcast('ext:toast', { from: 'Claude Code', message, kind })
}

function startMcp() {
  mcp.stop()
  const { enabled, port } = settings().mcp
  if (!enabled) return
  writeMcpConfig(port)
  mcp.start({ port, token: mcpToken(), app: mcpApp, version: app.getVersion() })
}

handle('mcp:status', () => {
  const { enabled, port } = settings().mcp
  const url = mcp.urlFor(port)
  return { ...mcp.status(), enabled, url, token: mcpToken(), name: mcp.SERVER_NAME }
})
handle('mcp:regenerateToken', () => {
  store.delete('mcpToken')
  startMcp()
})

// --- Extensiones -----------------------------------------------------------------

const broadcast = (channel, ...args) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

// Selecciones que una extensión ha pedido al usuario y esperan respuesta del renderer.
const prompts = new Map()

// Lo que una extensión puede pedir a la app. Los permisos se comprueban en extensions.js;
// nada de aquí da acceso a la bóveda.
const publicProject = ({ id, name, repos }) => ({
  id,
  name,
  repos: repos.map(({ id, name, path }) => ({ id, name, path }))
})

const hostApi = {
  'projects.list': () => projects().map(publicProject),
  'projects.addRepo': async (_ext, projectId, path) => addRepo(projectId, await repoRoot(path)),
  'views.refresh': (ext, viewId) => broadcast('ext:changed', ext.id, viewId),
  'ui.toast': (ext, message, kind) =>
    broadcast('ext:toast', { from: ext.displayName, message: String(message), kind }),
  'ui.quickPick': (ext, items, options) =>
    new Promise((resolve) => {
      const id = randomUUID()
      prompts.set(id, resolve)
      const placeholder = options?.placeholder
      broadcast('ext:quickPick', { id, from: ext.displayName, items, placeholder })
    }),
  'ui.input': (ext, options) =>
    new Promise((resolve) => {
      const id = randomUUID()
      prompts.set(id, (value) => resolve(value == null ? null : String(value)))
      broadcast('ext:input', {
        id,
        from: ext.displayName,
        title: String(options?.title ?? ''),
        description: String(options?.description ?? ''),
        placeholder: String(options?.placeholder ?? ''),
        value: String(options?.value ?? ''),
        password: !!options?.password
      })
    }),
  'ui.pickFolder': async (_ext, options) => {
    const res = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
      title: options?.title || 'Selecciona una carpeta',
      defaultPath: options?.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0] || null
  },
  // Abre el diálogo «Iniciar desarrollo»; no espera a que el usuario lo complete.
  'dev.start': (ext, request = {}) => {
    const project = findProject(projects(), request.projectId)
    const id = randomUUID()
    devRequests.set(id, { projectId: project.id, context: String(request.context ?? '') })
    broadcast('dev:request', {
      id,
      from: ext.displayName,
      projectId: project.id,
      repoId: project.repos.some((r) => r.id === request.repoId) ? request.repoId : null,
      title: String(request.title ?? '').slice(0, 300),
      branch: String(request.branch ?? '').slice(0, 200)
    })
  },
  'ui.openExternal': (_ext, url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Solo se pueden abrir enlaces https.')
    return shell.openExternal(url)
  },
  'storage.get': (ext, key) => store.get('extensionData', {})[ext.id]?.[key] ?? null,
  'storage.set': (ext, key, value) => {
    const all = store.get('extensionData', {})
    store.set('extensionData', { ...all, [ext.id]: { ...all[ext.id], [key]: value } })
  },
  // Credenciales propias de cada extensión (p. ej. un token de API), cifradas con safeStorage
  // (DPAPI en Windows). Aparte de la bóveda: una extensión solo ve lo que ella misma guardó.
  'secrets.get': (ext, key) => {
    const enc = store.get('extensionSecrets', {})[ext.id]?.[key]
    return enc ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : null
  },
  'secrets.set': (ext, key, value) => {
    const all = store.get('extensionSecrets', {})
    const mine = { ...all[ext.id] }
    if (value == null || value === '') delete mine[key]
    else {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('El sistema no permite cifrar credenciales.')
      mine[key] = safeStorage.encryptString(String(value)).toString('base64')
    }
    store.set('extensionSecrets', { ...all, [ext.id]: mine })
  }
}

handle('ext:list', () => extensions.list())
handle('ext:setEnabled', (_e, id, enabled) => extensions.setEnabled(id, enabled))
handle('ext:reload', () => extensions.scan())
handle('ext:log', (_e, id) => extensions.logOf(id))
handle('ext:openFolder', () => shell.openPath(extensions.userDir()))
handle('ext:catalog', (_e, force) => extensions.catalog(force))
handle('ext:install', (_e, name) => extensions.installFromCatalog(name))
handle('ext:uninstall', (_e, id) => extensions.uninstall(id))
handle('ext:pickZip', async (e) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Instalar extensión desde .zip',
    filters: [{ name: 'Extensión', extensions: ['zip'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return extensions.stageZip(res.filePaths[0])
})
handle('ext:installStaged', (_e, token) => extensions.installStaged(token))
handle('ext:discardStaged', (_e, token) => extensions.discardStaged(token))
// Una pestaña de proyecto recibe solo el proyecto que se está viendo (sin permiso `projects`).
const extContext = (projectId) =>
  projectId ? { project: publicProject(findProject(projects(), projectId)) } : {}

handle('ext:render', (_e, id, viewId, projectId) =>
  extensions.render(id, viewId, extContext(projectId))
)
handle('ext:action', (_e, id, viewId, actionId, args, projectId) =>
  extensions.action(id, viewId, actionId, args, extContext(projectId))
)
handle('ext:reply', (_e, id, value) => {
  prompts.get(id)?.(value ?? null)
  prompts.delete(id)
})

vault.setOnLock(() => {
  broadcast('vault:locked')
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.claude-launcher.app')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  vault.setAutoLockMinutes(settings().vault.autoLockMinutes)
  setBinaries(settings().binaries)
  extensions.initExtensions({ store, hostApi })
  startMcp()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  extensions.stopAll()
  mcp.stop()
})
