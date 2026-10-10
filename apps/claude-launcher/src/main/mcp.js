import { createServer } from 'http'
import { timingSafeEqual } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

// Servidor MCP local: deja que una sesión de Claude Code consulte proyectos, repos y worktrees y
// pida acciones a la app. Solo escucha en 127.0.0.1 y exige el token de la configuración.
// Nunca expone la bóveda: como mucho dice cuántas variables recibe una sesión nueva.

export const SERVER_NAME = 'claude-launcher'

let server = null
let state = { running: false, port: null, error: null }

export const status = () => ({ ...state })
export const urlFor = (port) => `http://127.0.0.1:${port}/mcp`

// Comparación en tiempo constante para no filtrar el token por tiempos de respuesta.
function validToken(header, token) {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const reject = (res, code, message) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

// `app` son las funciones de index.js que pueden usar las herramientas (ver `buildServer`).
export function start({ port, token, app, version }) {
  stop()
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  server = createServer(async (req, res) => {
    // Host fijo contra DNS rebinding y sin Origin: ninguna web abierta en el navegador puede llamarlo.
    if (!hosts.has(req.headers.host) || req.headers.origin) return reject(res, 403, 'Prohibido')
    if (!validToken(req.headers.authorization, token)) return reject(res, 401, 'Token no válido')
    if (new URL(req.url, 'http://x').pathname !== '/mcp') return reject(res, 404, 'No encontrado')
    // Sin sesiones: un servidor y un transporte por petición.
    if (req.method !== 'POST') return reject(res, 405, 'Método no permitido')
    const mcp = buildServer(app, version)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => {
      transport.close()
      mcp.close()
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      if (!res.headersSent) reject(res, 500, err.message)
    }
  })
  state = { running: false, port, error: null }
  server.on('listening', () => (state = { running: true, port, error: null }))
  server.on('error', (err) => {
    state = {
      running: false,
      port,
      error: err.code === 'EADDRINUSE' ? `El puerto ${port} ya está en uso.` : err.message
    }
  })
  server.listen(port, '127.0.0.1')
}

export function stop() {
  server?.close()
  server = null
  state = { running: false, port: null, error: null }
}

const text = (value) => ({
  content: [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
  ]
})

function buildServer(app, version) {
  const mcp = new McpServer(
    { name: SERVER_NAME, version },
    {
      instructions:
        'Claude Launcher gestiona los proyectos, repositorios git y worktrees del usuario. ' +
        'Usa list_projects para obtener los ids de proyecto y repo que piden las demás herramientas. ' +
        'Las acciones que abren ventanas o diálogos las ve el usuario en su escritorio.'
    }
  )
  const readOnly = { readOnlyHint: true, openWorldHint: false }

  mcp.registerTool(
    'list_projects',
    {
      title: 'Listar proyectos',
      description:
        'Proyectos registrados en Claude Launcher con sus repositorios (id, nombre, ruta y rama base).',
      annotations: readOnly
    },
    async () => text(app.projects())
  )

  mcp.registerTool(
    'list_worktrees',
    {
      title: 'Listar worktrees',
      description:
        'Worktrees de un repositorio. Con includeStatus indica, para cada uno, los cambios sin commitear ' +
        'y los commits que no están en la rama base del repo.',
      inputSchema: {
        projectId: z.string().describe('Id del proyecto (list_projects)'),
        repoId: z.string().describe('Id del repositorio (list_projects)'),
        includeStatus: z.boolean().optional().describe('Añadir el estado frente a la rama base')
      },
      annotations: readOnly
    },
    async (args) => text(await app.worktrees(args))
  )

  mcp.registerTool(
    'recent_sessions',
    {
      title: 'Sesiones recientes',
      description:
        'Últimas sesiones de Claude Code abiertas desde la app (fecha, carpeta y título).',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Por defecto 20')
      },
      annotations: readOnly
    },
    async ({ limit }) => text(app.launches(limit ?? 20))
  )

  mcp.registerTool(
    'open_claude',
    {
      title: 'Abrir sesión de Claude',
      description:
        'Abre una sesión nueva de Claude Code en una pestaña de Windows Terminal, en un repo registrado o ' +
        'en uno de sus worktrees, con las variables de la bóveda de ese repo si está desbloqueada.',
      inputSchema: {
        path: z.string().describe('Ruta del repo o de uno de sus worktrees'),
        title: z.string().max(100).optional().describe('Título de la pestaña')
      },
      annotations: { openWorldHint: false }
    },
    async (args) => text(await app.openClaude(args))
  )

  mcp.registerTool(
    'start_development',
    {
      title: 'Iniciar desarrollo',
      description:
        'Abre en la app el diálogo «Iniciar desarrollo»: el usuario elige repo y rama, se crea el worktree, ' +
        'se instalan las dependencias y se abre Claude en modo plan con el contexto indicado. ' +
        'No espera a que el usuario lo complete.',
      inputSchema: {
        projectId: z.string().describe('Id del proyecto (list_projects)'),
        repoId: z.string().optional().describe('Repo preseleccionado'),
        title: z.string().max(300).describe('Título del trabajo'),
        branch: z.string().max(200).optional().describe('Rama propuesta, p. ej. feat/login'),
        context: z.string().max(200_000).describe('Markdown con la descripción del trabajo')
      },
      annotations: { openWorldHint: false }
    },
    async (args) => {
      app.startDevelopment(args)
      return text('Diálogo abierto en Claude Launcher. El usuario debe confirmarlo.')
    }
  )

  mcp.registerTool(
    'open_in_ide',
    {
      title: 'Abrir en el IDE',
      description:
        'Abre un repo registrado o uno de sus worktrees en el IDE por defecto del usuario.',
      inputSchema: { path: z.string().describe('Ruta del repo o de uno de sus worktrees') },
      annotations: { openWorldHint: false }
    },
    async ({ path }) => {
      await app.openIde(path)
      return text('Abierto.')
    }
  )

  mcp.registerTool(
    'notify',
    {
      title: 'Notificar',
      description: 'Muestra un aviso en la ventana de Claude Launcher.',
      inputSchema: {
        message: z.string().max(500),
        kind: z.enum(['info', 'error']).optional()
      },
      annotations: { openWorldHint: false }
    },
    async ({ message, kind }) => {
      app.notify(message, kind)
      return text('Aviso mostrado.')
    }
  )

  return mcp
}
