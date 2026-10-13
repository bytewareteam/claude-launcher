// Extensión de Jira: pestaña «Jira» en cada proyecto con el sprint activo y tus incidencias de un
// proyecto de Jira Cloud, vía su API REST. El token de API lo guarda cifrado la app (permiso
// `secrets`); el sitio y el email, el almacenamiento normal de la extensión.
// «Iniciar desarrollo» pide a la app un worktree y una sesión de Claude con la incidencia como
// contexto (permiso `develop`).

const FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'priority', 'updated', 'parent']
const LIMIT = 300
const PAGE = 100
// Los datos se guardan en memoria 15 min: moverse entre pestañas e incidencias no llama a
// Jira. «Sincronizar» los descarta.
const TTL = 15 * 60_000
const TOKENS_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'

// Categorías de estado de Jira → tono de la app y orden de las columnas.
const CATEGORIES = { new: 'muted', indeterminate: 'info', done: 'success' }
const RANK = { new: 0, indeterminate: 1, done: 2 }

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/
const jql = (s) => `"${String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const enc = encodeURIComponent
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' })

// «https://acme.atlassian.net/jira/…», «acme.atlassian.net» o «acme» → «acme.atlassian.net».
function siteHost(input) {
  const host = String(input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase()
  if (!host) return null
  return host.includes('.') ? host : `${host}.atlassian.net`
}

// Sin credenciales o rechazadas: la pestaña ofrece conectar en vez de mostrar el error.
class AuthError extends Error {}

// --- Atlassian Document Format (descripciones y comentarios de la API v3) ----------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c])

// ADF → HTML para la vista (la app lo sanea). Los nodos desconocidos dejan su texto.
function toHtml(node) {
  if (!node) return ''
  if (typeof node === 'string') return esc(node).replace(/\n/g, '<br>')
  const inner = () => (node.content ?? []).map(toHtml).join('')
  switch (node.type) {
    case 'text': {
      let html = esc(node.text)
      for (const m of node.marks ?? []) {
        if (m.type === 'strong') html = `<strong>${html}</strong>`
        else if (m.type === 'em') html = `<em>${html}</em>`
        else if (m.type === 'code') html = `<code>${html}</code>`
        else if (m.type === 'link' && /^https:\/\//.test(m.attrs?.href ?? ''))
          html = `<a href="${esc(m.attrs.href)}">${html}</a>`
      }
      return html
    }
    case 'paragraph':
      return `<p>${inner()}</p>`
    case 'heading': {
      const h = `h${Math.min(6, (node.attrs?.level ?? 1) + 2)}`
      return `<${h}>${inner()}</${h}>`
    }
    case 'bulletList':
      return `<ul>${inner()}</ul>`
    case 'orderedList':
      return `<ol>${inner()}</ol>`
    case 'listItem':
      return `<li>${inner()}</li>`
    case 'codeBlock':
      return `<pre><code>${inner()}</code></pre>`
    case 'blockquote':
      return `<blockquote>${inner()}</blockquote>`
    case 'hardBreak':
      return '<br>'
    case 'rule':
      return '<hr>'
    case 'table':
      return `<table>${inner()}</table>`
    case 'tableRow':
      return `<tr>${inner()}</tr>`
    case 'tableHeader':
      return `<th>${inner()}</th>`
    case 'tableCell':
      return `<td>${inner()}</td>`
    case 'mention':
      return esc(node.attrs?.text ?? '@')
    case 'emoji':
      return esc(node.attrs?.text ?? '')
    case 'inlineCard':
    case 'blockCard': {
      const url = node.attrs?.url ?? ''
      return /^https:\/\//.test(url) ? `<a href="${esc(url)}">${esc(url)}</a>` : ''
    }
    default:
      return inner()
  }
}

// ADF → Markdown para el contexto que lee Claude.
function toMarkdown(node, depth = 0) {
  if (!node) return ''
  if (typeof node === 'string') return node
  const inner = (sep = '') => (node.content ?? []).map((n) => toMarkdown(n, depth)).join(sep)
  switch (node.type) {
    case 'text': {
      let text = node.text
      for (const m of node.marks ?? []) {
        if (m.type === 'strong') text = `**${text}**`
        else if (m.type === 'em') text = `_${text}_`
        else if (m.type === 'code') text = `\`${text}\``
        else if (m.type === 'link') text = `[${text}](${m.attrs?.href})`
      }
      return text
    }
    case 'doc':
      return inner('\n\n').trim()
    case 'paragraph':
      return inner()
    case 'heading':
      return `${'#'.repeat(Math.min(6, (node.attrs?.level ?? 1) + 3))} ${inner()}`
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? [])
        .map((li, i) => {
          const mark = node.type === 'orderedList' ? `${i + 1}.` : '-'
          const body = (li.content ?? []).map((n) => toMarkdown(n, depth + 1)).join('\n')
          return `${'  '.repeat(depth)}${mark} ${body.trimStart()}`
        })
        .join('\n')
    case 'codeBlock':
      return `\`\`\`${node.attrs?.language ?? ''}\n${inner()}\n\`\`\``
    case 'blockquote':
      return inner('\n\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    case 'hardBreak':
      return '\n'
    case 'rule':
      return '---'
    case 'table':
      return inner('\n')
    case 'tableRow':
      return `| ${(node.content ?? []).map((c) => toMarkdown(c, depth).replace(/\n+/g, ' ')).join(' | ')} |`
    case 'tableHeader':
    case 'tableCell':
      return inner(' ')
    case 'mention':
    case 'emoji':
      return node.attrs?.text ?? ''
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url ?? ''
    default:
      return inner()
  }
}

const hasText = (adf) => /\S/.test(toMarkdown(adf))

const refresh = { id: 'refresh', icon: 'refresh', title: 'Sincronizar con Jira' }
const linkAction = { id: 'link', label: 'Vincular proyecto', icon: 'link' }
const teamAction = (link) => ({
  id: 'team',
  label: link?.team?.name ?? 'Todos los equipos',
  icon: 'users',
  title: 'Elegir equipo'
})

const connectAction = { id: 'connect', label: 'Conectar con Jira', icon: 'link' }

exports.activate = (ctx) => {
  const openIssue = new Map() // id de proyecto → clave de la incidencia abierta.
  const store = new Map() // clave → { at, value }: ver `TTL`.

  // Guarda la promesa (no el resultado) para que dos renders a la vez compartan la petición.
  // Si falla no se guarda, para reintentar en el siguiente render.
  function remember(key, fn) {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < TTL) return hit
    const entry = { at: Date.now(), value: fn() }
    entry.value.catch(() => store.get(key) === entry && store.delete(key))
    store.set(key, entry)
    return entry
  }
  const forget = (prefix = '') => {
    for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
  }

  // --- Cuenta de Jira -----------------------------------------------------------------------

  let account // { site, email, token } en memoria; el token sale de ctx.secrets.

  async function credentials() {
    if (account) return account
    const saved = await ctx.storage.get('account')
    const token = saved && (await ctx.secrets.get('token'))
    if (!saved?.site || !saved.email || !token) throw new AuthError()
    account = { ...saved, token }
    return account
  }

  async function request({ site, email, token }, path, body) {
    const res = await fetch(`https://${site}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        Accept: 'application/json',
        ...(body && { 'Content-Type': 'application/json' })
      },
      body: body && JSON.stringify(body)
    })
    if (res.status === 401) throw new AuthError('Jira rechazó el email o el token de API.')
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      const messages = [...(detail?.errorMessages ?? []), ...Object.values(detail?.errors ?? {})]
      throw new Error(messages.join(' ') || `Jira respondió ${res.status} en ${path.split('?')[0]}`)
    }
    return res.json()
  }

  const api = async (path, body) => request(await credentials(), path, body)

  // Pide sitio, email y token; los comprueba con /myself antes de guardarlos.
  async function connect() {
    const saved = (await ctx.storage.get('account')) ?? {}
    const site = siteHost(
      await ctx.ui.input({
        title: 'Sitio de Jira',
        description: 'La dirección de tu Jira Cloud, p. ej. acme.atlassian.net.',
        placeholder: 'acme.atlassian.net',
        value: saved.site ?? ''
      })
    )
    if (!site) return
    const email = (
      (await ctx.ui.input({
        title: 'Email de tu cuenta de Atlassian',
        placeholder: 'tu@empresa.com',
        value: saved.email ?? ''
      })) ?? ''
    ).trim()
    if (!email) return
    const token = (
      (await ctx.ui.input({
        title: 'Token de API de Atlassian',
        description: `Créalo en ${TOKENS_URL}. Se guarda cifrado en este equipo.`,
        password: true
      })) ?? ''
    ).trim()
    if (!token) return
    const me = await request({ site, email, token }, '/rest/api/3/myself')
    await ctx.secrets.set('token', token)
    await ctx.storage.set('account', { site, email })
    account = { site, email, token }
    forget()
    return { toast: `Conectado a ${site} como ${me.displayName}.` }
  }

  async function disconnect() {
    await ctx.secrets.set('token', null)
    account = null
    forget()
    return { toast: 'Token de Jira borrado de este equipo.' }
  }

  // --- Vínculo proyecto de la app → proyecto de Jira --------------------------------------

  const linkKey = (projectId) => `link:${projectId}`
  const linkOf = (project) => ctx.storage.get(linkKey(project.id))

  async function projects() {
    const all = []
    for (let startAt = 0; ; startAt += PAGE) {
      const res = await api(
        `/rest/api/3/project/search?orderBy=name&maxResults=${PAGE}&startAt=${startAt}`
      )
      all.push(...res.values)
      if (res.isLast || !res.values.length) return all
    }
  }

  // Tableros (Jira Software) que muestran incidencias del proyecto: uno por equipo.
  async function boards(key) {
    const all = []
    for (let startAt = 0; ; startAt += 50) {
      const res = await api(
        `/rest/agile/1.0/board?projectKeyOrId=${enc(key)}&maxResults=50&startAt=${startAt}`
      )
      all.push(...res.values)
      if (res.isLast || !res.values.length) return all
    }
  }

  // Equipo = tablero: se guarda su filtro para acotar las búsquedas JQL a lo que muestra el
  // tablero. `null` es «todos los equipos» y `undefined`, que se canceló.
  async function pickTeam(list, current) {
    if (!list.length) return null
    const id = await ctx.ui.quickPick(
      [
        { id: 'all', label: 'Todos los equipos', description: 'Todo el proyecto' },
        ...list
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((b) => ({
            id: String(b.id),
            label: b.name,
            description: b.id === current?.id ? 'actual' : b.type
          }))
      ],
      { placeholder: 'Equipo (tablero) cuyas métricas quieres ver…' }
    )
    if (!id) return undefined
    if (id === 'all') return null
    const { name } = list.find((b) => String(b.id) === id)
    const { filter } = await api(`/rest/agile/1.0/board/${enc(id)}/configuration`)
    if (!filter?.id) throw new Error(`No se pudo leer el filtro del tablero «${name}».`)
    return { id: Number(id), name, filter: String(filter.id) }
  }

  async function saveLink(project, link) {
    await ctx.storage.set(linkKey(project.id), link)
    openIssue.delete(project.id)
    forget(`${project.id}:`)
  }

  async function chooseLink(project) {
    const list = await projects()
    if (!list.length) throw new Error('Tu cuenta de Jira no ve ningún proyecto.')
    const key = await ctx.ui.quickPick(
      list.map((p) => ({ id: p.key, label: p.name, description: p.key })),
      { placeholder: `Proyecto de Jira para «${project.name}»…` }
    )
    if (!key) return
    const { name } = list.find((p) => p.key === key)
    const team = await pickTeam(await boards(key))
    if (team === undefined) return
    await saveLink(project, { key, name, team })
    const scope = team ? `, equipo ${team.name}` : ''
    return { toast: `«${project.name}» vinculado a ${name} (${key}${scope}).` }
  }

  async function chooseTeam(project) {
    const link = await linkOf(project)
    if (!link) return
    const list = await boards(link.key)
    if (!list.length) return { toast: `${link.key} no tiene tableros de equipo en Jira.` }
    const team = await pickTeam(list, link.team)
    if (team === undefined) return
    await saveLink(project, { ...link, team })
  }

  // --- Datos de Jira ------------------------------------------------------------------------

  function issue(raw, site) {
    const f = raw.fields ?? {}
    const category = f.status?.statusCategory?.key
    return {
      key: raw.key,
      site,
      title: f.summary ?? '',
      type: f.issuetype?.name ?? 'Incidencia',
      subtask: Boolean(f.issuetype?.subtask),
      state: f.status?.name ?? '—',
      category,
      tone: CATEGORIES[category] ?? 'muted',
      assignee: f.assignee?.displayName,
      priority: f.priority?.name,
      updated: f.updated,
      parent: f.parent && {
        key: f.parent.key,
        title: f.parent.fields?.summary ?? '',
        type: f.parent.fields?.issuetype?.name ?? 'Incidencia'
      }
    }
  }

  // Búsqueda JQL paginada con `nextPageToken` (Jira Cloud retiró la /search clásica).
  async function search(query, limit = LIMIT) {
    const { site } = await credentials()
    const issues = []
    let nextPageToken
    do {
      const res = await api('/rest/api/3/search/jql', {
        jql: query,
        fields: FIELDS,
        maxResults: Math.min(PAGE, limit - issues.length),
        nextPageToken
      })
      issues.push(...(res.issues ?? []))
      nextPageToken = res.nextPageToken
    } while (nextPageToken && issues.length < limit)
    return issues.map((raw) => issue(raw, site))
  }

  // Sprint activo y mis incidencias abiertas del proyecto vinculado, o solo de lo que muestra
  // el tablero del equipo elegido.
  async function fetchBoard(link) {
    const scope = link.team ? `filter = ${link.team.filter}` : `project = ${jql(link.key)}`
    const [sprint, mine] = await Promise.all([
      search(`${scope} AND sprint in openSprints() ORDER BY rank`),
      search(
        `${scope} AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`,
        100
      )
    ])
    return { link, sprint, mine }
  }

  async function load(project) {
    const link = await linkOf(project)
    if (!link) return null
    const { at, value } = remember(`${project.id}:board`, () => fetchBoard(link))
    return { ...(await value), syncedAt: at }
  }

  // Descripción, comentarios e hijas (subtareas o incidencias de una épica) de una incidencia.
  async function fetchDetail(key) {
    const { site } = await credentials()
    const fields = [...FIELDS, 'description', 'labels'].join(',')
    const [raw, { comments = [] }, children] = await Promise.all([
      api(`/rest/api/3/issue/${enc(key)}?fields=${fields}`),
      api(`/rest/api/3/issue/${enc(key)}/comment?orderBy=-created&maxResults=50`),
      search(`parent = ${jql(key)} ORDER BY rank`, 100)
    ])
    return {
      ...issue(raw, site),
      description: raw.fields?.description,
      labels: raw.fields?.labels ?? [],
      notes: comments.map((c) => ({
        id: c.id,
        author: c.author?.displayName ?? 'Desconocido',
        date: dateTimeFmt.format(new Date(c.created)),
        body: c.body
      })),
      children
    }
  }

  const detail = (project, key) => remember(`${project.id}:issue:${key}`, () => fetchDetail(key))

  // --- Vista ----------------------------------------------------------------------------

  const ownerOf = (it) => it.assignee || 'Sin asignar'
  const urlOf = (it) => `https://${it.site}/browse/${it.key}`

  const openAction = (it) => ({
    id: 'open',
    icon: 'external-link',
    title: 'Abrir en Jira',
    args: { url: urlOf(it) }
  })

  // Solo si la app lo admite (las versiones anteriores no tienen `ctx.dev`).
  const developActions = (it) =>
    ctx.dev
      ? [{ id: 'develop', icon: 'play', title: 'Iniciar desarrollo', args: { key: it.key } }]
      : []

  const meta = (it) =>
    [
      it.type,
      it.priority,
      it.parent && `en ${it.parent.key}`,
      it.updated && `actualizada el ${dateFmt.format(new Date(it.updated))}`
    ]
      .filter(Boolean)
      .join(' · ')

  const row = (it) => ({
    id: it.key,
    title: `${it.key} ${it.title}`,
    description: ownerOf(it),
    badges: [{ label: it.state, tone: it.tone }],
    meta: meta(it),
    actions: [
      { id: 'issue', icon: 'list-todo', title: 'Ver detalle', args: { key: it.key } },
      ...developActions(it),
      openAction(it)
    ]
  })

  const issueList = (list, empty) => ({
    type: 'list',
    searchable: list.length > 5,
    empty,
    items: list.map(row)
  })

  // Avance de las subtareas por estado (barra apilada).
  function progress(subtasks) {
    const counts = new Map()
    for (const t of subtasks) {
      const c = counts.get(t.state) ?? {
        label: t.state,
        value: 0,
        tone: t.tone,
        category: t.category
      }
      c.value++
      counts.set(t.state, c)
    }
    return [...counts.values()]
      .sort((a, b) => (RANK[a.category] ?? 1) - (RANK[b.category] ?? 1))
      .map(({ category, ...c }) => c)
  }

  // Columnas por estado, ordenadas por categoría (por hacer → en curso → hecho). Las subtareas
  // van dentro de su padre cuando también está en el sprint.
  function kanban(list) {
    const keys = new Set(list.map((it) => it.key))
    const nested = (it) => it.subtask && keys.has(it.parent?.key)
    const subtasksOf = new Map()
    for (const it of list.filter(nested))
      subtasksOf.set(it.parent.key, [...(subtasksOf.get(it.parent.key) ?? []), it])
    const cards = list.filter((it) => !nested(it))
    const states = new Map()
    for (const it of cards)
      if (!states.has(it.state))
        states.set(it.state, { tone: it.tone, rank: RANK[it.category] ?? 1 })
    return {
      type: 'kanban',
      filter: { label: 'Asignado a', all: 'Todas las personas' },
      empty: 'No hay incidencias en el sprint activo.',
      columns: [...states]
        .sort(([, a], [, b]) => a.rank - b.rank)
        .map(([state, { tone }]) => ({
          id: state,
          title: state,
          tone,
          items: cards
            .filter((it) => it.state === state)
            .map((it) => {
              const subtasks = subtasksOf.get(it.key) ?? []
              return {
                id: it.key,
                title: `${it.key} ${it.title}`,
                description: ownerOf(it),
                meta: [it.type, it.parent && `en ${it.parent.key}`].filter(Boolean).join(' · '),
                ...(subtasks.length && {
                  breakdown: progress(subtasks),
                  childrenLabel: `Subtareas (${subtasks.length})`,
                  children: subtasks.map((t) => ({ ...row(t), filterValues: [ownerOf(t)] }))
                }),
                // Se filtra por el responsable y por los de sus subtareas.
                filterValues: [...new Set([ownerOf(it), ...subtasks.map(ownerOf)])],
                action: { id: 'issue', args: { key: it.key } },
                actions: developActions(it)
              }
            })
        }))
    }
  }

  // Recuento por categoría de estado para las cifras de arriba.
  function stats(sprint, mine) {
    const count = (cat) => sprint.filter((it) => it.category === cat).length
    const done = count('done')
    return {
      type: 'stats',
      items: [
        {
          label: 'Hechas en el sprint',
          value: `${done}/${sprint.length}`,
          progress: sprint.length ? done / sprint.length : 0,
          tone: 'success'
        },
        { label: 'En curso', value: count('indeterminate'), tone: 'info' },
        { label: 'Por hacer', value: count('new') },
        {
          label: 'Mis incidencias abiertas',
          value: mine.length,
          detail: {
            title: 'Mis incidencias abiertas',
            blocks: [issueList(mine, 'No tienes incidencias abiertas.')]
          }
        }
      ]
    }
  }

  const ago = (at) => {
    const min = Math.floor((Date.now() - at) / 60_000)
    return min < 1 ? 'ahora mismo' : `hace ${min} min (${timeFmt.format(at)})`
  }

  const unlinked = {
    actions: [linkAction],
    blocks: [
      {
        type: 'text',
        tone: 'muted',
        text: 'Este proyecto no está vinculado a ningún proyecto de Jira.\nVincúlalo para ver su sprint activo y tus incidencias.'
      }
    ]
  }

  const disconnected = (reason) => ({
    actions: [
      connectAction,
      { id: 'open', label: 'Crear token de API', icon: 'external-link', args: { url: TOKENS_URL } }
    ],
    blocks: [
      {
        type: 'text',
        tone: reason ? 'error' : 'muted',
        text: [
          reason,
          'Conecta tu Jira Cloud con tu email y un token de API de Atlassian. El token se guarda cifrado en este equipo.'
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]
  })

  async function renderBoard(project) {
    // Primero la cuenta: sin ella no tiene sentido vincular el proyecto.
    const { site, email } = await credentials()
    const data = await load(project)
    if (!data) return unlinked
    const { link, sprint, mine, syncedAt } = data
    const url = link.team
      ? `https://${site}/secure/RapidBoard.jspa?rapidView=${link.team.id}`
      : `https://${site}/browse/${link.key}`
    return {
      description: [
        `${link.name} (${link.key})`,
        link.team?.name,
        email,
        `sincronizado ${ago(syncedAt)}`
      ]
        .filter(Boolean)
        .join(' · '),
      actions: [
        teamAction(link),
        { id: 'open', label: 'Abrir en Jira', icon: 'external-link', args: { url } },
        { id: 'goto', icon: 'list-todo', title: 'Abrir una incidencia por clave' },
        { id: 'link', icon: 'link', title: 'Vincular a otro proyecto de Jira' },
        { id: 'disconnect', icon: 'lock', title: 'Desconectar de Jira (borra el token)' },
        refresh
      ],
      blocks: [
        stats(sprint, mine),
        {
          type: 'tabs',
          tabs: [
            { id: 'sprint', label: `Sprint activo (${sprint.length})`, blocks: [kanban(sprint)] },
            {
              id: 'mine',
              label: `Mis incidencias (${mine.length})`,
              blocks: [issueList(mine, 'No tienes incidencias abiertas en este proyecto.')]
            }
          ]
        }
      ]
    }
  }

  async function renderIssue(project, key) {
    const { value, at } = detail(project, key)
    const it = await value
    const section = (title, blocks, open = true, id) => ({
      type: 'section',
      id,
      title,
      open,
      blocks
    })
    return {
      description: [it.type, ownerOf(it), `sincronizado ${ago(at)}`].join(' · '),
      actions: [
        { id: 'back', label: 'Volver', icon: 'arrow-left' },
        ...developActions(it).map((a) => ({ ...a, label: 'Iniciar desarrollo' })),
        { ...openAction(it), label: 'Abrir en Jira' },
        refresh
      ],
      blocks: [
        { type: 'heading', text: `${it.key} ${it.title}` },
        {
          type: 'list',
          items: [
            {
              id: it.key,
              title: 'Estado',
              badges: [
                { label: it.state, tone: it.tone },
                ...(it.priority ? [it.priority] : []),
                ...it.labels
              ],
              meta: meta(it),
              actions: it.parent
                ? [
                    {
                      id: 'issue',
                      label: `Padre: ${it.parent.key}`,
                      icon: 'arrow-left',
                      args: { key: it.parent.key }
                    }
                  ]
                : []
            }
          ]
        },
        section('Descripción', [
          hasText(it.description)
            ? { type: 'html', html: toHtml(it.description) }
            : { type: 'text', tone: 'muted', text: 'Sin descripción.' }
        ]),
        ...(it.children.length
          ? [section(`Hijas (${it.children.length})`, [issueList(it.children)], true, 'children')]
          : []),
        section(
          `Comentarios (${it.notes.length})`,
          [
            {
              type: 'list',
              empty: 'Sin comentarios.',
              items: it.notes.map((c) => ({
                id: String(c.id),
                title: c.author,
                meta: c.date,
                html: toHtml(c.body)
              }))
            }
          ],
          false,
          'comments'
        )
      ]
    }
  }

  // --- Iniciar desarrollo -----------------------------------------------------------------

  // bugfix/<CLAVE> para bugs y feature/<CLAVE> para lo demás: Jira enlaza la rama por la clave.
  const branchFor = (it) => `${/bug|error|fallo/i.test(it.type) ? 'bugfix' : 'feature'}/${it.key}`

  function describe(it) {
    const parts = [
      `## ${it.type} ${it.key}: ${it.title}`,
      [
        `- Estado: ${it.state}`,
        `- Asignado a: ${ownerOf(it)}`,
        it.priority && `- Prioridad: ${it.priority}`,
        it.labels?.length && `- Etiquetas: ${it.labels.join(', ')}`,
        `- Jira: ${urlOf(it)}`
      ]
        .filter(Boolean)
        .join('\n')
    ]
    const add = (title, text) => text && parts.push(`### ${title}\n\n${text}`)
    add('Descripción', toMarkdown(it.description))
    add(
      'Hijas',
      (it.children ?? []).map((c) => `- ${c.key} ${c.title} (${c.state}, ${ownerOf(c)})`).join('\n')
    )
    add(
      'Comentarios recientes',
      (it.notes ?? [])
        .slice(0, 10)
        .map((c) => `**${c.author}** (${c.date}):\n${toMarkdown(c.body)}`)
        .join('\n\n')
    )
    return parts.join('\n\n')
  }

  async function develop(project, key) {
    const it = await detail(project, key).value
    const parent = it.parent && (await detail(project, it.parent.key).value)
    const branch = branchFor(it)
    const intro = parent
      ? `# ${it.type} a desarrollar\n\nForma parte de: ${parent.type} ${parent.key}. Céntrate en esta incidencia; lo demás es contexto.`
      : `# ${it.type} a desarrollar`
    const sections = [intro, describe(it)]
    if (parent) sections.push(describe(parent))
    sections.push(
      `# Cómo trabajar\n\nRama: \`${branch}\`. Analiza el código, aclara dudas y propón un plan antes de modificar nada.`
    )
    await ctx.dev.start({
      projectId: project.id,
      branch,
      title: `${it.key} ${it.title}`,
      context: sections.join('\n\n')
    })
  }

  // Abre cualquier incidencia escribiendo su clave (p. ej. una que no está en el sprint).
  async function goto(project) {
    const link = await linkOf(project)
    const key = (
      (await ctx.ui.input({
        title: 'Abrir incidencia',
        placeholder: `${link.key}-123`,
        value: `${link.key}-`
      })) ?? ''
    )
      .trim()
      .toUpperCase()
    if (!key) return
    if (!KEY.test(key))
      throw new Error(`«${key}» no es una clave de Jira (p. ej. ${link.key}-123).`)
    openIssue.set(project.id, key)
  }

  async function action(id, args, { project }) {
    if (id === 'open') return ctx.ui.openExternal(args.url)
    if (id === 'connect') return connect()
    if (id === 'disconnect') return disconnect()
    if (id === 'develop') return develop(project, args.key)
    if (id === 'issue') return void openIssue.set(project.id, args.key)
    if (id === 'back') return void openIssue.delete(project.id)
    if (id === 'goto') return goto(project)
    if (id === 'link') return chooseLink(project)
    if (id === 'team') return chooseTeam(project)
    if (id === 'refresh') forget(`${project.id}:`)
  }

  async function render({ project }) {
    const key = openIssue.get(project.id)
    if (!key) return renderBoard(project)
    try {
      return await renderIssue(project, key)
    } catch (err) {
      if (err instanceof AuthError) throw err
      // Incidencia borrada o sin permiso: vuelve al tablero en vez de quedarse atascado.
      console.error(err.message)
      openIssue.delete(project.id)
      ctx.ui.toast(`No se pudo abrir ${key}: ${err.message}`, 'error')
      return renderBoard(project)
    }
  }

  // Sin credenciales se ofrece conectar; los demás errores se muestran en la propia pestaña.
  async function safeRender(context) {
    try {
      return await render(context)
    } catch (err) {
      if (err instanceof AuthError) {
        account = null
        return disconnected(err.message)
      }
      console.error(err.message)
      return {
        actions: [
          { id: 'team', icon: 'users', title: 'Elegir equipo' },
          linkAction,
          connectAction,
          refresh
        ],
        blocks: [{ type: 'text', tone: 'error', text: err.message }]
      }
    }
  }

  ctx.views.register('jira', { render: safeRender, action })
}

exports.deactivate = () => {}
