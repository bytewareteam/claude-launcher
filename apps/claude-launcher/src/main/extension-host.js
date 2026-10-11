// Proceso aislado (utilityProcess) donde corre UNA extensión. No comparte memoria con el
// proceso principal: no ve la bóveda desbloqueada ni puede hablar con la ventana. Todo lo
// que necesite de la app (también lanzar programas) lo pide por mensajes, y el principal
// comprueba sus permisos.
import { createRequire } from 'module'

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

const ctx = {
  get extension() {
    return { id: manifest.id, version: manifest.version }
  },
  views: {
    register: (id, provider) => views.set(id, provider),
    refresh: (id) => host('views.refresh', id)
  },
  // Este proceso no puede lanzar programas (ver `start` en extensions.js): los lanza el
  // principal tras comprobar el permiso.
  exec: (cmd, args = [], options = {}) => host('exec', cmd, args, options),
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
    // Sin el modelo de permisos la extensión leería cualquier archivo: mejor no arrancar.
    if (!process.permission || process.permission.has('child'))
      throw new Error('El aislamiento de extensiones no está activo en esta versión de la app.')
    manifest = m
    const ext = createRequire(m.entry)(m.entry)
    deactivate = ext.deactivate
    await ext.activate?.(ctx)
  },
  render: (viewId, context) => view(viewId).render(context ?? {}),
  action: (viewId, actionId, args, context) => view(viewId).action?.(actionId, args, context ?? {}),
  async deactivate() {
    await deactivate?.()
    views = new Map()
  }
}

port.on('message', async ({ data: msg }) => {
  if (msg.type === 'hostResult') {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    // `code` (p. ej. ENOENT o el código de salida de `exec`) se conserva para la extensión.
    if (msg.error)
      p?.reject(Object.assign(new Error(msg.error), msg.code != null && { code: msg.code }))
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
