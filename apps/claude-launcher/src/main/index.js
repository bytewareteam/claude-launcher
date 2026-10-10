import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join, basename } from 'path'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
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
  remoteWebUrl
} from './git'
import { openClaude } from './terminal'
import * as extensions from './extensions'
import icon from '../../resources/icon.png?asset'

// Misma carpeta de datos en desarrollo y en la app instalada
// (si no, la instalada usaría "Claude Launcher" por el productName).
app.setPath('userData', join(app.getPath('appData'), 'claude-launcher'))

// Reutiliza el data.json de la versión anterior.
const store = new Store({ name: 'data', defaults: { projects: [], launches: [] } })

const DEFAULT_BASE_BRANCH = 'origin/develop'

const vaultPath = () => store.get('vaultPath') || join(app.getPath('userData'), 'secrets.kdbx')

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

const addRepo = (projectId, repoPath) =>
  updateProjects((list) => {
    const p = findProject(list, projectId)
    if (!p.repos.some((r) => r.path.toLowerCase() === repoPath.toLowerCase())) {
      p.repos.push({
        id: randomUUID(),
        name: basename(repoPath),
        path: repoPath,
        baseBranch: DEFAULT_BASE_BRANCH
      })
    }
  })

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

ipcMain.handle('open:claude', (_e, dir, title, scope) => {
  let env = {}
  if (scope && vault.isUnlocked()) {
    const project = resolveScope({ projectId: scope.projectId })
    env = vault.envFor(project, scope.repoId ? resolveScope(scope) : null)
  }
  openClaude(dir, title, env)
  // Historial de sesiones para la pantalla de inicio (últimas 500).
  const launch = { at: new Date().toISOString(), dir, title, ...scope }
  store.set('launches', [launch, ...store.get('launches')].slice(0, 500))
  return Object.keys(env).length
})

ipcMain.handle('dashboard', async () => {
  const list = projects()
  const repos = list.flatMap((p) => p.repos)
  const summaries = await Promise.all(repos.map((r) => repoSummary(r.path)))
  return {
    repos: Object.fromEntries(repos.map((r, i) => [r.id, summaries[i]])),
    launches: store.get('launches')
  }
})

ipcMain.handle('open:folder', (_e, dir) => shell.openPath(dir))
ipcMain.handle('open:web', async (_e, repoPath) =>
  shell.openExternal(await remoteWebUrl(repoPath))
)

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

ipcMain.handle('vault:list', (_e, scope) => vault.listVars(resolveScope(scope)))
ipcMain.handle('vault:get', (_e, scope, id) => vault.getValue(resolveScope(scope), id))
ipcMain.handle('vault:set', (_e, scope, key, value) =>
  vault.setVars(resolveScope(scope), [{ key, value }])
)
ipcMain.handle('vault:delete', (_e, scope, id) => vault.deleteVar(resolveScope(scope), id))

ipcMain.handle('vault:copy', (_e, scope, id) => {
  const value = vault.getValue(resolveScope(scope), id)
  clipboard.writeText(value)
  // Limpia el portapapeles a los 30 s si sigue conteniendo el secreto.
  setTimeout(() => {
    if (clipboard.readText() === value) clipboard.clear()
  }, 30_000)
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

// --- Extensiones -----------------------------------------------------------------

const broadcast = (channel, ...args) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

// Selecciones que una extensión ha pedido al usuario y esperan respuesta del renderer.
const prompts = new Map()

// Lo que una extensión puede pedir a la app. Los permisos se comprueban en extensions.js;
// nada de aquí da acceso a la bóveda.
const hostApi = {
  'projects.list': () => projects().map(({ id, name, repos }) => ({ id, name, repos })),
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
  'ui.pickFolder': async (_ext, options) => {
    const res = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], {
      title: options?.title || 'Selecciona una carpeta',
      defaultPath: options?.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0] || null
  },
  'ui.openExternal': (_ext, url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Solo se pueden abrir enlaces https.')
    return shell.openExternal(url)
  },
  'storage.get': (ext, key) => store.get('extensionData', {})[ext.id]?.[key] ?? null,
  'storage.set': (ext, key, value) => {
    const all = store.get('extensionData', {})
    store.set('extensionData', { ...all, [ext.id]: { ...all[ext.id], [key]: value } })
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
ipcMain.handle('ext:render', (_e, id, viewId) => extensions.render(id, viewId))
ipcMain.handle('ext:action', (_e, id, viewId, actionId, args) =>
  extensions.action(id, viewId, actionId, args)
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
  extensions.initExtensions({ store, hostApi })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => extensions.stopAll())
