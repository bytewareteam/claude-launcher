// Extensión de Bitbucket: usa la sesión de bkt (`bkt auth login`), así que no guarda tokens.
// Vale para Bitbucket Cloud (workspaces) y Data Center (proyectos): cada contexto de bkt apunta
// a un host y, opcionalmente, a su workspace o proyecto por defecto.
const { join } = require('path')

const MAX_PAGES = 20
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

function timeAgo(iso) {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000)
  if (days > -1) return 'hoy'
  if (days > -30) return rtf.format(days, 'day')
  if (days > -365) return rtf.format(Math.round(days / 30), 'month')
  return rtf.format(Math.round(days / 365), 'year')
}

// El workspace/proyecto no existe o no tenemos acceso: la API responde 404 o 403.
const isNotFound = (err) => /(403|404)|Not Found|Forbidden/i.test(err.message)

const fail = (text) => ({
  view: {
    actions: [{ id: 'refresh', label: 'Recargar', icon: 'refresh' }],
    blocks: [{ type: 'text', text, tone: 'error' }]
  }
})

exports.activate = (ctx) => {
  const bkt = (...args) => ctx.exec('bkt', args)

  // GET paginado con `bkt api` (la respuesta en bruto ya es JSON). Cloud devuelve `next` como URL
  // absoluta, que bkt acepta tal cual; Data Center, `nextPageStart` mientras no sea la última.
  async function paginate(c, path, params) {
    const values = []
    let url = path
    let start = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = c.kind === 'cloud' ? (page ? {} : params) : { ...params, start }
      const res = JSON.parse(
        await bkt(
          'api',
          url,
          '--context',
          c.name,
          ...Object.entries(query).flatMap(([k, v]) => ['--param', `${k}=${v}`])
        )
      )
      // Sin `values` no es una página: mejor un error que una lista vacía engañosa.
      if (!Array.isArray(res.values)) throw new Error(`Respuesta inesperada de ${path}.`)
      values.push(...res.values)
      if (c.kind === 'cloud') {
        if (!res.next) break
        url = res.next
      } else {
        if (res.isLastPage !== false) break
        start = res.nextPageStart
      }
    }
    return values
  }

  // Contextos de bkt con su tipo de host, o una vista explicando qué falta.
  async function login() {
    let status
    try {
      status = JSON.parse(await bkt('auth', 'status', '--json'))
    } catch (err) {
      console.error(err.message)
      return fail(
        err.code === 'ENOENT'
          ? 'No se encuentra bkt. Instálalo con `winget install AvivSinai.Bitbucket-CLI` y reinicia la app.'
          : `bkt falló: ${err.message}`
      )
    }
    const hosts = Object.fromEntries((status.hosts || []).map((h) => [h.key, h]))
    if (!status.hosts?.length)
      return fail(
        'bkt no tiene sesión iniciada. Ejecuta `bkt auth login bitbucket.org --kind cloud --web` ' +
          '(o `bkt auth login <tu-servidor> --web` para Data Center) en una terminal y recarga.'
      )
    const contexts = (status.contexts || [])
      .filter((c) => hosts[c.host])
      .map((c) => ({ ...c, kind: hosts[c.host].kind, baseUrl: hosts[c.host].base_url }))
    if (!contexts.length)
      return fail(
        'bkt no tiene contextos. Crea uno en una terminal y recarga: ' +
          '`bkt context create cloud --host api.bitbucket.org --workspace <workspace> --set-active` ' +
          '(Data Center: `--host <tu-servidor> --project <CLAVE>`).'
      )
    return { contexts, active: status.active_context }
  }

  // Contexto elegido (o el activo de bkt) y su workspace/proyecto (elegido o el del contexto).
  async function current() {
    const res = await login()
    if (res.view) return res
    const saved = await ctx.storage.get('context')
    const c =
      res.contexts.find((x) => x.name === saved) ||
      res.contexts.find((x) => x.name === res.active) ||
      res.contexts[0]
    const scope = (await ctx.storage.get(`scope:${c.name}`)) || c.workspace || c.project_key
    return { ...res, c, scope }
  }

  const unit = (c) => (c.kind === 'cloud' ? 'workspace' : 'proyecto')

  async function listRepos(c, scope) {
    if (c.kind === 'cloud') {
      const repos = await paginate(c, `/repositories/${encodeURIComponent(scope)}`, {
        pagelen: 100,
        sort: '-updated_on'
      })
      return repos.map((r) => ({
        slug: r.slug,
        title: r.name,
        description: r.description || r.project?.name || '',
        badges: [
          r.is_private ? 'privado' : 'público',
          r.parent && 'fork',
          r.language,
          r.mainbranch?.name
        ].filter(Boolean),
        meta: r.updated_on ? `actualizado ${timeAgo(r.updated_on)}` : '',
        url: r.links?.html?.href
      }))
    }
    const repos = await paginate(c, `/rest/api/1.0/projects/${encodeURIComponent(scope)}/repos`, {
      limit: 1000
    })
    return repos
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        slug: r.slug,
        title: r.name,
        description: r.description || r.project?.name || '',
        badges: [
          r.public ? 'público' : 'privado',
          r.archived && 'archivado',
          r.origin && 'fork'
        ].filter(Boolean),
        meta: r.project?.key || '',
        url: r.links?.self?.[0]?.href
      }))
  }

  ctx.views.register('repos', {
    async render() {
      const { view, contexts, c, scope } = await current()
      if (view) return view
      const ssh = await ctx.storage.get('ssh')
      const actions = [
        contexts.length > 1 && {
          id: 'context',
          label: c.name,
          icon: 'globe',
          title: 'Cambiar de contexto de bkt'
        },
        {
          id: 'scope',
          label: scope || `Elegir ${unit(c)}`,
          icon: 'users',
          title: `Cambiar de ${unit(c)}`
        },
        {
          id: 'protocol',
          label: ssh ? 'SSH' : 'HTTPS',
          icon: 'lock',
          title: 'Clonar por HTTPS o por SSH'
        },
        { id: 'refresh', label: 'Recargar', icon: 'refresh' }
      ].filter(Boolean)
      if (!scope)
        return {
          actions,
          blocks: [
            {
              type: 'text',
              text: `El contexto ${c.name} no tiene ${unit(c)} por defecto: elige uno.`,
              tone: 'muted'
            }
          ]
        }
      let repos
      try {
        repos = await listRepos(c, scope)
      } catch (err) {
        if (!isNotFound(err)) throw err
        return unreachable(c, scope, actions, err)
      }
      return {
        description: `Repositorios del ${unit(c)} ${scope} en Bitbucket (${c.baseUrl}). Clona uno y añádelo a un proyecto.`,
        actions,
        blocks: [
          {
            type: 'list',
            searchable: true,
            empty: `${scope} no tiene repositorios.`,
            items: repos.map((r) => ({
              id: r.slug,
              title: r.title,
              description: r.description,
              badges: r.badges,
              meta: r.meta,
              actions: [
                r.url && {
                  id: 'open',
                  icon: 'external-link',
                  title: 'Abrir en Bitbucket',
                  args: { url: r.url }
                },
                {
                  id: 'clone',
                  label: 'Clonar',
                  icon: 'download',
                  args: { slug: r.slug, name: r.title }
                }
              ].filter(Boolean)
            }))
          }
        ]
      }
    },

    // Desde «Añadir repositorio» de un proyecto llega `context.project`: se clona en él.
    async action(id, args, context) {
      if (id === 'refresh') return
      if (id === 'open') return ctx.ui.openExternal(args.url)
      if (id === 'context') return chooseContext()
      if (id === 'scope') return chooseScope()
      if (id === 'useScope') return ctx.storage.set(`scope:${args.context}`, args.scope)
      if (id === 'protocol') return ctx.storage.set('ssh', !(await ctx.storage.get('ssh')))
      if (id === 'clone') return clone(args, context.project)
    }
  })

  async function chooseContext() {
    const { contexts } = await login()
    if (!contexts) return
    const name = await ctx.ui.quickPick(
      contexts.map((c) => ({
        id: c.name,
        label: c.name,
        description: [c.baseUrl, c.workspace || c.project_key].filter(Boolean).join(' · ')
      })),
      { placeholder: 'Usar el contexto de bkt…' }
    )
    if (name) await ctx.storage.set('context', name)
  }

  // Vista para un workspace/proyecto inaccesible (p. ej. el del contexto de bkt no existe):
  // explica el error y ofrece los que sí son accesibles, sin pasar por el selector.
  async function unreachable(c, scope, actions, err) {
    console.error(err.message)
    const blocks = [
      {
        type: 'text',
        text: `No se puede acceder al ${unit(c)} ${scope} en ${c.baseUrl}: no existe o no tienes permiso. Elige otro.`,
        tone: 'error'
      }
    ]
    try {
      const items = await listScopes(c)
      blocks.push({
        type: 'list',
        searchable: items.length > 10,
        empty: `No tienes acceso a ningún ${unit(c)} en ${c.baseUrl}.`,
        items: items.map((s) => ({
          id: s.id,
          title: s.label,
          description: s.description,
          actions: [
            { id: 'useScope', label: 'Usar', icon: 'users', args: { context: c.name, scope: s.id } }
          ]
        }))
      })
    } catch (listErr) {
      blocks.push({
        type: 'text',
        text: `Tampoco se pudo obtener la lista de ${unit(c)}s: ${listErr.message}`,
        tone: 'error'
      })
    }
    return { actions, blocks }
  }

  async function chooseScope() {
    const { view, c } = await current()
    if (view) return
    const items = await listScopes(c)
    if (!items.length) throw new Error(`No tienes acceso a ningún ${unit(c)} en ${c.baseUrl}.`)
    const scope = await ctx.ui.quickPick(items, { placeholder: 'Ver los repositorios de…' })
    if (scope) await ctx.storage.set(`scope:${c.name}`, scope)
  }

  // Workspaces (Cloud) o proyectos (Data Center) accesibles, ordenados por nombre.
  async function listScopes(c) {
    let items
    if (c.kind === 'cloud') {
      // /user/workspaces sustituye a /workspaces, que Atlassian está retirando. Si ambos fallan,
      // el error útil es el del primero.
      const values = await paginate(c, '/user/workspaces', { pagelen: 100 }).catch((err) =>
        paginate(c, '/workspaces', { pagelen: 100 }).catch(() => {
          throw err
        })
      )
      items = values
        .map((v) => v.workspace || v)
        .map((w) => ({
          id: w.slug,
          label: w.name || w.slug,
          description: `bitbucket.org/${w.slug}`
        }))
    } else {
      const values = await paginate(c, '/rest/api/1.0/projects', { limit: 1000 })
      items = values.map((p) => ({ id: p.key, label: p.name, description: p.key }))
    }
    return items.sort((a, b) => a.label.localeCompare(b.label))
  }

  async function clone({ slug, name }, target) {
    const { view, c, scope } = await current()
    if (view) return
    const parent = await ctx.ui.pickFolder({
      title: `¿Dónde clonar ${scope}/${name}?`,
      defaultPath: await ctx.storage.get('cloneDir')
    })
    if (!parent) return
    await ctx.storage.set('cloneDir', parent)
    const dest = join(parent, slug)
    const ssh = await ctx.storage.get('ssh')
    try {
      // bkt solo elige la URL: las credenciales las pone git (Git Credential Manager o la clave
      // SSH). Sin prompt de terminal: no hay nadie para contestarlo y el clone se quedaría colgado.
      await ctx.exec(
        'bkt',
        [
          'repo',
          'clone',
          slug,
          '--context',
          c.name,
          c.kind === 'cloud' ? '--workspace' : '--project',
          scope,
          '--dest',
          dest,
          ...(ssh ? ['--ssh'] : [])
        ],
        { timeout: 15 * 60_000, env: { GIT_TERMINAL_PROMPT: '0' } }
      )
    } catch (err) {
      if (
        /could not read Username|Authentication failed|Permission denied|terminal prompts disabled/i.test(
          err.message
        )
      )
        throw new Error(
          ssh
            ? 'Git no pudo autenticarse por SSH: añade tu clave pública a Bitbucket o cambia a HTTPS.'
            : 'Git no tiene credenciales para Bitbucket: inicia sesión con Git Credential Manager (p. ej. con un `git clone` en una terminal) o cambia a SSH.'
        )
      throw err
    }

    if (target) {
      await ctx.projects.addRepo(target.id, dest)
      return { toast: `${name} clonado y añadido a ${target.name}.`, close: true }
    }

    const projects = await ctx.projects.list()
    const projectId = await ctx.ui.quickPick(
      [
        ...projects.map((p) => ({
          id: p.id,
          label: p.name,
          description: `${p.repos.length} repos`
        })),
        { id: 'none', label: 'No añadir a ningún proyecto' }
      ],
      { placeholder: `${name} clonado. ¿A qué proyecto lo añades?` }
    )
    if (projectId && projectId !== 'none') {
      await ctx.projects.addRepo(projectId, dest)
      return { toast: `${name} clonado y añadido al proyecto.` }
    }
    return { toast: `${name} clonado en ${dest}` }
  }
}
