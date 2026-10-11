import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage } from 'electron'
import { join, basename, resolve } from 'path'
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
  addWorktree
} from './git'
import { openClaude, openShell, hasClaudeSession, CLAUDE_ARGS } from './terminal'
import { claudeOptions } from './claude-cli'
import * as dev from './dev'
import * as ide from './ide'
import * as extensions from './extensions'
import * as mcp from './mcp'
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
  mcp: { enabled: true, port: 47821, autoConnect: true }
}

function settings() {
  const saved = store.get('settings', {})
  return {
    claude: { ...DEFAULT_SETTINGS.claude, ...saved.claude },
    vault: { ...DEFAULT_SETTINGS.vault, ...saved.vault },
    mcp: { ...DEFAULT_SETTINGS.mcp, ...saved.mcp }
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
  const mcpChanged = JSON.stringify(next.mcp) !== JSON.stringify(settings().mcp)
  store.set('settings', next)
  vault.setAutoLockMinutes(next.vault.autoLockMinutes)
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
      preload: join(__dirname, '../preload/index.js')
    }
  })
  win.on('ready-to-show', () => win.show())
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// --- Proyectos y repos ------------------------------------------------------------

ipcMain.handle('projects:list', () => projects())

ipcMain.handle('project:add', (_e, name) => {
  const id = randomUUID()
  updateProjects((list) => list.push({ id, name, repos: [] }))
  return id
})

ipcMain.handle('project:rename', (_e, id, name) =>
  updateProjects((list) => (findProject(list, id).name = name))
)

// Extensión de tablero (Jira, Azure Boards…) cuyas pestañas muestra el proyecto; null la quita.
ipcMain.handle('project:setBoard', (_e, id, extId) =>
  updateProjects((list) => {
    const p = findProject(list, id)
    if (extId) p.board = String(extId)
    else delete p.board
  })
)

ipcMain.handle('project:remove', (_e, id) =>
  store.set(
    'projects',
    projects().filter((p) => p.id !== id)
  )
)

ipcMain.handle('repo:pick', async (e) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Selecciona la carpeta del repositorio',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return repoRoot(res.filePaths[0])
})

const findRepo = (projectId, repoId) => {
  const r = findProject(projects(), projectId).repos.find((x) => x.id === repoId)
  if (!r) throw new Error('Repositorio no encontrado')
  return r
}

// La rama principal empieza siendo la del remoto (origin/HEAD) si git la conoce.
async function addRepo(projectId, repoPath) {
  const baseBranch = (await defaultRemoteBranch(repoPath)) || DEFAULT_BASE_BRANCH
  return updateProjects((list) => {
    const p = findProject(list, projectId)
    if (!p.repos.some((r) => r.path.toLowerCase() === repoPath.toLowerCase())) {
      p.repos.push({ id: randomUUID(), name: basename(repoPath), path: repoPath, baseBranch })
    }
  })
}

ipcMain.handle('repo:add', (_e, projectId, repoPath) => addRepo(projectId, repoPath))

ipcMain.handle('repo:remove', (_e, projectId, repoId) =>
  updateProjects((list) => {
    const p = findProject(list, projectId)
    p.repos = p.repos.filter((r) => r.id !== repoId)
  })
)

ipcMain.handle('repo:worktrees', (_e, repoPath) => listWorktrees(repoPath))
ipcMain.handle('repo:remoteBranches', (_e, repoPath) => remoteBranches(repoPath))

ipcMain.handle('repo:setBase', (_e, projectId, repoId, branch) =>
  updateProjects((list) => {
    const r = findProject(list, projectId).repos.find((x) => x.id === repoId)
    if (r) r.baseBranch = branch
  })
)

ipcMain.handle('worktree:status', (_e, wtPath, base) =>
  worktreeStatus(wtPath, base || DEFAULT_BASE_BRANCH)
)
ipcMain.handle('worktree:remove', (_e, repoPath, wtPath, force) =>
  removeWorktree(repoPath, wtPath, force)
)

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
  openClaude(dir, title, env, settings().claude, [...mcpArgs(), ...session.args, ...extraArgs])
  // Historial de sesiones para la pantalla de inicio (últimas 500).
  const launch = { at: new Date().toISOString(), dir, title, ...scope }
  if (session.sessionId) launch.sessionId = session.sessionId
  store.set('launches', [launch, ...store.get('launches')].slice(0, 500))
  return Object.keys(env).length
}

// `resume`: `{ resume: true, sessionId }` reanuda esa sesión del historial.
ipcMain.handle('open:claude', (_e, dir, title, scope, resume) =>
  launchClaude(dir, title, scope, [], resume)
)

// --- Iniciar desarrollo -----------------------------------------------------------
// Una extensión lo pide (`ctx.dev.start`), el renderer muestra el diálogo y va llamando a cada
// paso. La ruta del worktree y el contexto se quedan aquí: el renderer solo maneja el id.

const devRequests = new Map()

function devRequest(id) {
  const req = devRequests.get(id)
  if (!req) throw new Error('La petición de desarrollo ya no existe.')
  return req
}

ipcMain.handle('dev:worktree', async (_e, id, repoId, branch) => {
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

ipcMain.handle('dev:install', (_e, id) => dev.install(devRequest(id).path))

ipcMain.handle('dev:open', async (_e, id) => {
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

ipcMain.handle('dev:cancel', (_e, id) => devRequests.delete(id))

ipcMain.handle('dashboard', async () => {
  const list = projects()
  const repos = list.flatMap((p) => p.repos)
  const summaries = await Promise.all(repos.map((r) => repoSummary(r.path)))
  return {
    repos: Object.fromEntries(repos.map((r, i) => [r.id, summaries[i]])),
    launches: store.get('launches')
  }
})

ipcMain.handle('open:shell', (_e, dir, title) => openShell(dir, title))
ipcMain.handle('open:folder', (_e, dir) => shell.openPath(dir))
// IDE: el elegido por el usuario o, si no hay, el primero que se encuentre.
ipcMain.handle('ide:list', () => ({
  ides: ide.detect().map(({ id, name, file }) => ({ id, name, path: file })),
  selected: store.get('ide') ?? null
}))
ipcMain.handle('ide:setDefault', (_e, id) => store.set('ide', id))
// Con `id` abre ese IDE solo esta vez; el predeterminado se elige en Configuración.
ipcMain.handle('ide:open', (_e, dir, id) => ide.open(dir, id || store.get('ide')))
ipcMain.handle('open:web', async (_e, repoPath) => shell.openExternal(await remoteWebUrl(repoPath)))
// Enlaces del contenido HTML de las extensiones: solo https y siempre en el navegador.
ipcMain.handle('open:url', (_e, url) => {
  if (!/^https:\/\//i.test(url)) throw new Error('Solo se pueden abrir enlaces https.')
  return shell.openExternal(url)
})

// --- Configuración --------------------------------------------------------------

ipcMain.handle('settings:get', () => ({ ...settings(), defaultVaultPath: defaultVaultPath() }))
ipcMain.handle('settings:set', (_e, patch) => updateSettings(patch))
ipcMain.handle('claude:options', () => claudeOptions())

// --- Tutorial -------------------------------------------------------------------

// Quien actualiza con proyectos ya creados no necesita el tutorial de bienvenida.
ipcMain.handle('onboarding:pending', () => !(store.get('onboardingDone') ?? projects().length > 0))
ipcMain.handle('onboarding:done', () => store.set('onboardingDone', true))

// --- Bóveda ---------------------------------------------------------------------

ipcMain.handle('vault:status', () => vault.status(vaultPath()))
ipcMain.handle('vault:create', (_e, password) => vault.create(vaultPath(), password))
ipcMain.handle('vault:unlock', (_e, password) => vault.unlock(vaultPath(), password))
ipcMain.handle('vault:lock', () => vault.lock())

ipcMain.handle('vault:useExisting', async (e) => {
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

ipcMain.handle('vault:resetPath', () => {
  vault.lock()
  store.delete('vaultPath')
})
ipcMain.handle('vault:showFile', () => shell.showItemInFolder(vaultPath()))

ipcMain.handle('vault:list', (_e, scope) => vault.listVars(resolveScope(scope)))
ipcMain.handle('vault:get', (_e, scope, id) => vault.getValue(resolveScope(scope), id))
ipcMain.handle('vault:set', (_e, scope, key, value) =>
  vault.setVars(resolveScope(scope), [{ key, value }])
)
ipcMain.handle('vault:delete', (_e, scope, id) => vault.deleteVar(resolveScope(scope), id))

ipcMain.handle('vault:copy', (_e, scope, id) => {
  const value = vault.getValue(resolveScope(scope), id)
  clipboard.writeText(value)
  // Limpia el portapapeles pasado el plazo configurado si sigue conteniendo el secreto.
  setTimeout(() => {
    if (clipboard.readText() === value) clipboard.clear()
  }, settings().vault.clipboardSeconds * 1000)
})

ipcMain.handle('vault:importEnv', async (e, scope) => {
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

// Repo registrado (o worktree suyo) que contiene exactamente `dir`.
async function findByPath(dir) {
  const target = resolve(dir).toLowerCase()
  const all = projects().flatMap((p) => p.repos.map((r) => ({ project: p, repo: r })))
  const same = (path) => resolve(path).toLowerCase() === target
  const direct = all.find(({ repo }) => same(repo.path))
  if (direct) return { ...direct, branch: null }
  for (const entry of all) {
    const wts = await listWorktrees(entry.repo.path).catch(() => [])
    const wt = wts.find((w) => w.path && same(w.path))
    if (wt) return { ...entry, branch: wt.branch ?? null, path: wt.path }
  }
  throw new Error(`${dir} no es un repositorio registrado ni uno de sus worktrees.`)
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
    const list = await listWorktrees(repo.path)
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

ipcMain.handle('mcp:status', () => {
  const { enabled, port } = settings().mcp
  const url = mcp.urlFor(port)
  return { ...mcp.status(), enabled, url, token: mcpToken(), name: mcp.SERVER_NAME }
})
ipcMain.handle('mcp:regenerateToken', () => {
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

ipcMain.handle('ext:list', () => extensions.list())
ipcMain.handle('ext:setEnabled', (_e, id, enabled) => extensions.setEnabled(id, enabled))
ipcMain.handle('ext:reload', () => extensions.scan())
ipcMain.handle('ext:log', (_e, id) => extensions.logOf(id))
ipcMain.handle('ext:openFolder', () => shell.openPath(extensions.userDir()))
ipcMain.handle('ext:catalog', (_e, force) => extensions.catalog(force))
ipcMain.handle('ext:install', (_e, name) => extensions.installFromCatalog(name))
ipcMain.handle('ext:uninstall', (_e, id) => extensions.uninstall(id))
ipcMain.handle('ext:pickZip', async (e) => {
  const res = await dialog.showOpenDialog(windowOf(e), {
    title: 'Instalar extensión desde .zip',
    filters: [{ name: 'Extensión', extensions: ['zip'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return extensions.stageZip(res.filePaths[0])
})
ipcMain.handle('ext:installStaged', (_e, token) => extensions.installStaged(token))
ipcMain.handle('ext:discardStaged', (_e, token) => extensions.discardStaged(token))
// Una pestaña de proyecto recibe solo el proyecto que se está viendo (sin permiso `projects`).
const extContext = (projectId) =>
  projectId ? { project: publicProject(findProject(projects(), projectId)) } : {}

ipcMain.handle('ext:render', (_e, id, viewId, projectId) =>
  extensions.render(id, viewId, extContext(projectId))
)
ipcMain.handle('ext:action', (_e, id, viewId, actionId, args, projectId) =>
  extensions.action(id, viewId, actionId, args, extContext(projectId))
)
ipcMain.handle('ext:reply', (_e, id, value) => {
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
  extensions.initExtensions({ store, hostApi })
  startMcp()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  extensions.stopAll()
  mcp.stop()
})
