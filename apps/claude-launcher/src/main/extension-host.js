// Proceso aislado (utilityProcess) donde corre UNA extensión. No comparte memoria con el
// proceso principal: no ve la bóveda desbloqueada ni puede hablar con la ventana. Todo lo
// que necesite de la app lo pide por mensajes, y el principal comprueba sus permisos.
import { createRequire } from 'module'
import { execFile } from 'child_process'
import { CMD_UNSAFE, isScript, whichWin } from './which'

const port = process.parentPort
let manifest
let views = new Map()
let deactivate

// --- Llamadas al proceso principal ---------------------------------------------------

let nextId = 0
const pending = new Map()

function host(method, ...params) {
  const id = ++nextId
  port.postMessage({ type: 'host', id, method, params })
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

// --- API que recibe la extensión en activate(ctx) ------------------------------------

function exec(cmd, args = [], { cwd, timeout = 60_000, env } = {}) {
  // El principal no ve este proceso hijo: el permiso se comprueba aquí contra el manifest.
  if (!manifest.permissions.exec.includes(cmd))
    return Promise.reject(new Error(`La extensión no tiene permiso para ejecutar «${cmd}».`))
  let file = cmd
  let shell = false
  if (process.platform === 'win32') {
    const found = whichWin(cmd)
    if (!found) {
      const e = new Error(`No se encuentra «${cmd}».`)
      e.code = 'ENOENT'
      return Promise.reject(e)
    }
    if (isScript(found)) {
      if (args.some((a) => CMD_UNSAFE.test(String(a))))
        return Promise.reject(new Error(`Argumento no admitido para «${cmd}» (es un script .cmd).`))
      // La línea se monta aquí (no con args + shell, obsoleto en Node): ya está validada.
      const quote = (a) => (/[\s,;=]/.test(a) ? `"${a}"` : a)
      file = [`"${found}"`, ...args.map(String).map(quote)].join(' ')
      args = []
      shell = true
    }
  }
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd,
        timeout,
        shell,
        env: env ? { ...process.env, ...env } : undefined,
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const e = new Error(stderr.trim() || err.message)
        e.code = err.code
        reject(e)
      }
    )
  })
}

const ctx = {
  get extension() {
    return { id: manifest.id, version: manifest.version }
  },
  views: {
    register: (id, provider) => views.set(id, provider),
    refresh: (id) => host('views.refresh', id)
  },
  exec,
  projects: {
    list: () => host('projects.list'),
    addRepo: (projectId, path) => host('projects.addRepo', projectId, path)
  },
  ui: {
    toast: (message, kind = 'info') => host('ui.toast', message, kind),
    quickPick: (items, options = {}) => host('ui.quickPick', items, options),
    input: (options = {}) => host('ui.input', options),
    pickFolder: (options = {}) => host('ui.pickFolder', options),
    openExternal: (url) => host('ui.openExternal', url)
  },
  // Diálogo «Iniciar desarrollo»: worktree desde la rama principal, dependencias y Claude en
  // modo plan con `context` (Markdown). Vuelve en cuanto se abre el diálogo.
  dev: {
    start: (request) => host('dev.start', request)
  },
  storage: {
    get: (key) => host('storage.get', key),
    set: (key, value) => host('storage.set', key, value)
  },
  // Cifrados en el principal; `set(clave, null)` los borra.
  secrets: {
    get: (key) => host('secrets.get', key),
    set: (key, value) => host('secrets.set', key, value)
  }
}

// --- Peticiones del proceso principal ------------------------------------------------

function view(id) {
  const v = views.get(id)
  if (!v) throw new Error(`La extensión no registra la vista «${id}».`)
  return v
}

const handlers = {
  async activate(m) {
    manifest = m
    const ext = createRequire(m.entry)(m.entry)
    deactivate = ext.deactivate
    await ext.activate?.(ctx)
  },
  render: (viewId, context) => view(viewId).render(context ?? {}),
  action: (viewId, actionId, args, context) =>
    view(viewId).action?.(actionId, args, context ?? {}),
  async deactivate() {
    await deactivate?.()
    views = new Map()
  }
}

port.on('message', async ({ data: msg }) => {
  if (msg.type === 'hostResult') {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) p?.reject(new Error(msg.error))
    else p?.resolve(msg.result)
    return
  }
  if (msg.type !== 'call') return
  try {
    const result = await handlers[msg.method](...msg.params)
    port.postMessage({ type: 'result', id: msg.id, result: result ?? null })
  } catch (err) {
    port.postMessage({ type: 'result', id: msg.id, error: String(err?.message || err) })
  }
})
