// Extensión de GitHub Projects: pestaña «GitHub» en cada proyecto con el tablero de un GitHub
// Project (v2) o, si no se usa ninguno, con las issues de los repos del proyecto. Usa la sesión de GitHub CLI vía su API GraphQL, así que no guarda tokens; el
// token de gh necesita el scope `project` (`read:project` basta para ver el tablero, no para
// mover tarjetas).
// «Iniciar desarrollo» pide a la app un worktree y una sesión de Claude con la issue como
// contexto (permiso `develop`).

const LIMIT = 500
const PAGE = 100
// Los datos se guardan en memoria 15 min: moverse entre pestañas y elementos no llama a
// GitHub. «Sincronizar» los descarta.
const TTL = 15 * 60_000
const SCOPE_CMD = 'gh auth refresh -s project'
const NO_STATUS = 'Sin estado'

// Colores de las opciones de un campo de GitHub → tono de la app.
const TONES = {
  GRAY: 'muted',
  BLUE: 'info',
  GREEN: 'success',
  YELLOW: 'warning',
  ORANGE: 'warning',
  RED: 'error',
  PINK: 'info',
  PURPLE: 'info'
}

const REF = /^([\w.-]+)\/([\w.-]+)#(\d+)$/
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' })

// Sin gh, sin sesión o sin el scope de proyectos: la pestaña explica qué hacer.
class AuthError extends Error {}

// --- Consultas GraphQL ------------------------------------------------------------------

const PEOPLE = 'assignees(first: 10) { nodes { login } }'
const LABELS = 'labels(first: 20) { nodes { name } }'
const COMMON = `number title url state updatedAt repository { nameWithOwner name } ${PEOPLE} ${LABELS}`

const VIEWER = `query { viewer { login organizations(first: 100) { nodes { login } } } }`

const PROJECTS = `query($login: String!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectsV2(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { number title closed shortDescription }
      }
    }
  }
}`

const ITEMS = `query($login: String!, $number: Int!, $cursor: String) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        id title url viewerCanUpdate
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name color } }
        }
        items(first: ${PAGE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isArchived
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            content {
              __typename
              ... on DraftIssue { title body bodyHTML updatedAt ${PEOPLE} }
              ... on Issue {
                ${COMMON} stateReason issueType { name }
                parent { number repository { nameWithOwner } }
              }
              ... on PullRequest { ${COMMON} isDraft }
            }
          }
        }
      }
    }
  }
}`

const MOVE = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`

const CLEAR = `mutation($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
    projectV2Item { id }
  }
}`

// Issues abiertas y las últimas cerradas de un repo (modo sin GitHub Project).
const ISSUE = `__typename ${COMMON} stateReason issueType { name } parent { number repository { nameWithOwner } }`
const REPO_ISSUES = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    open: issues(first: ${PAGE}, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${ISSUE} }
    }
    closed: issues(first: 30, states: CLOSED, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${ISSUE} }
    }
  }
}`

// Columnas del modo «issues de los repos»: GitHub no tiene estados, se deducen.
const REPO_COLUMNS = [
  { id: 'todo', name: 'Por hacer', tone: 'muted' },
  { id: 'doing', name: 'En curso', tone: 'info' },
  { id: 'done', name: 'Cerradas', tone: 'success' }
]
const REPO_MOVES = {
  todo: 'Reabre la issue o te quita de ella',
  doing: 'Te la asigna (y la reabre si está cerrada)',
  done: 'Cierra la issue como completada'
}
const repoStatus = (it) => REPO_COLUMNS[it.done ? 2 : it.assignees.length ? 1 : 0].name

// «git@github.com:owner/repo.git» o «https://github.com/owner/repo» → «owner/repo».
function githubRepo(url) {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m && `${m[1]}/${m[2]}`
}

const COMMENTS = 'comments(last: 50) { nodes { author { login } createdAt body bodyHTML } }'

const DETAIL = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        ${COMMON} stateReason body bodyHTML ${COMMENTS}
        issueType { name } milestone { title }
        parent { number title repository { nameWithOwner } }
        subIssues(first: 50) { nodes { ${COMMON} } }
      }
      ... on PullRequest { ${COMMON} isDraft body bodyHTML headRefName baseRefName ${COMMENTS} }
    }
  }
}`

// --- Modelo -------------------------------------------------------------------------------

const logins = (c) => (c?.assignees?.nodes ?? []).map((a) => a.login)
const refOf = (c) => `${c.repository.nameWithOwner}#${c.number}`

// Elemento de GitHub (issue, PR o borrador) con lo que necesita la vista.
function element(c, status) {
  const kind = c.__typename === 'PullRequest' ? 'pr' : c.__typename === 'Issue' ? 'issue' : 'draft'
  const done = c.state === 'CLOSED' || c.state === 'MERGED'
  return {
    kind,
    ref: kind === 'draft' ? null : refOf(c),
    repo: c.repository,
    number: c.number,
    title: c.title ?? '',
    url: c.url,
    type:
      kind === 'pr'
        ? c.isDraft
          ? 'PR borrador'
          : 'Pull request'
        : kind === 'draft'
          ? 'Borrador'
          : (c.issueType?.name ?? 'Issue'),
    state: c.state,
    stateReason: c.stateReason,
    done,
    status,
    assignees: logins(c),
    labels: (c.labels?.nodes ?? []).map((l) => l.name),
    updated: c.updatedAt,
    parent: c.parent && `${c.parent.repository.nameWithOwner}#${c.parent.number}`
  }
}

// Estado de GitHub (no la columna del proyecto) para issues y PR.
function ghState(it) {
  if (it.kind === 'draft') return { label: 'Borrador', tone: 'muted' }
  if (it.state === 'MERGED') return { label: 'Fusionada', tone: 'success' }
  if (it.state === 'CLOSED')
    return it.stateReason === 'NOT_PLANNED'
      ? { label: 'Descartada', tone: 'muted' }
      : { label: 'Cerrada', tone: 'success' }
  return { label: 'Abierta', tone: 'info' }
}

const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // Corta por la última palabra entera que quepa.
    .replace(/^(.{0,40})(-.*)?$/, '$1')
    .slice(0, 40)
    .replace(/-+$/, '')

exports.activate = (ctx) => {
  const openItem = new Map() // id de proyecto → ref (o id de borrador) del elemento abierto.
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

  // --- GitHub CLI ---------------------------------------------------------------------------

  // `gh api graphql`: -F convierte los números; -f deja el texto tal cual.
  async function graphql(query, vars = {}) {
    const args = ['api', 'graphql', '-f', `query=${query}`]
    for (const [k, v] of Object.entries(vars))
      if (v != null) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
    return JSON.parse(await gh(...args)).data
  }

  async function gh(...args) {
    try {
      return await ctx.exec('gh', args)
    } catch (err) {
      if (err.code === 'ENOENT')
        throw new AuthError(
          'No se encuentra GitHub CLI. Instálalo con `winget install GitHub.cli` y reinicia la app.'
        )
      if (/read:project|required scopes/i.test(err.message))
        throw new AuthError(
          `El token de GitHub CLI no tiene permiso sobre los GitHub Projects. Ejecuta \`${SCOPE_CMD}\` en una terminal y sincroniza.`
        )
      if (/auth login|not logged|HTTP 401/i.test(err.message))
        throw new AuthError(
          'GitHub CLI no tiene sesión iniciada. Ejecuta `gh auth login` en una terminal y sincroniza.'
        )
      throw new Error(err.message.replace(/^gh: /, ''))
    }
  }

  const viewer = () => remember('viewer', () => graphql(VIEWER).then((d) => d.viewer)).value

  // --- Vínculo proyecto de la app → GitHub Project ----------------------------------------

  const linkKey = (projectId) => `link:${projectId}`
  const linkOf = (project) => ctx.storage.get(linkKey(project.id))

  async function chooseLink(project) {
    const mode = await ctx.ui.quickPick(
      [
        {
          id: 'repos',
          label: 'Issues de los repositorios',
          description: 'Las issues de los repos de GitHub de este proyecto'
        },
        {
          id: 'project',
          label: 'Un GitHub Project',
          description: 'Tablero de github.com/…/projects'
        }
      ],
      { placeholder: `¿Qué tablero de GitHub muestra «${project.name}»?` }
    )
    if (mode === 'project') return chooseProject(project)
    if (mode !== 'repos') return
    const repos = await githubRepos(project)
    await ctx.storage.set(linkKey(project.id), { mode: 'repos' })
    openItem.delete(project.id)
    forget(`${project.id}:`)
    return { toast: `«${project.name}» muestra las issues de ${repos.join(', ')}.` }
  }

  // Repos de GitHub del proyecto, según su remoto `origin`.
  async function githubRepos(project) {
    const found = await Promise.all(
      project.repos.map((r) =>
        ctx
          .exec('git', ['remote', 'get-url', 'origin'], { cwd: r.path })
          .then(githubRepo)
          .catch(() => null)
      )
    )
    const repos = [...new Set(found.filter(Boolean))]
    if (!repos.length)
      throw new Error('Ningún repositorio de este proyecto tiene su remoto «origin» en GitHub.')
    return repos
  }

  async function chooseProject(project) {
    const me = await viewer()
    const orgs = me.organizations.nodes.map((o) => o.login)
    const owner = orgs.length
      ? await ctx.ui.quickPick(
          [
            { id: me.login, label: me.login, description: 'Tu cuenta' },
            ...orgs.map((o) => ({ id: o, label: o, description: 'Organización' }))
          ],
          { placeholder: '¿De quién es el GitHub Project?' }
        )
      : me.login
    if (!owner) return
    const data = await graphql(PROJECTS, { login: owner })
    const list = (data.repositoryOwner?.projectsV2?.nodes ?? []).filter(Boolean)
    if (!list.length)
      throw new Error(
        `${owner} no tiene GitHub Projects que puedas ver. Vincula las issues de los repositorios.`
      )
    const picked = await ctx.ui.quickPick(
      list.map((p) => ({
        id: String(p.number),
        label: p.title,
        description: [`#${p.number}`, p.closed && 'cerrado', p.shortDescription]
          .filter(Boolean)
          .join(' · ')
      })),
      { placeholder: `GitHub Project para «${project.name}»…` }
    )
    if (!picked) return
    const { number, title } = list.find((p) => String(p.number) === picked)
    await ctx.storage.set(linkKey(project.id), { owner, number, title })
    openItem.delete(project.id)
    forget(`${project.id}:`)
    return { toast: `«${project.name}» vinculado a ${title} (${owner}).` }
  }

  // --- Datos de GitHub --------------------------------------------------------------------

  async function fetchRepoIssues(project) {
    const repos = await githubRepos(project)
    const results = await Promise.all(
      repos.map((full) => {
        const [owner, name] = full.split('/')
        return graphql(REPO_ISSUES, { owner, name })
      })
    )
    const items = results.flatMap(({ repository: r }) =>
      [...(r?.open.nodes ?? []), ...(r?.closed.nodes ?? [])].map((c) => {
        const it = { ...element(c), movable: true }
        it.status = repoStatus(it)
        return it
      })
    )
    const { login } = await viewer()
    return {
      title: `Issues de ${repos.join(', ')}`,
      url: repos.length === 1 ? `https://github.com/${repos[0]}/issues` : null,
      repos,
      columns: REPO_COLUMNS,
      items,
      drafts: new Map(),
      me: login
    }
  }

  async function fetchBoard(link, project) {
    if (link.mode === 'repos') return fetchRepoIssues(project)
    const items = []
    let board
    let cursor
    do {
      const data = await graphql(ITEMS, { login: link.owner, number: link.number, cursor })
      board = data.repositoryOwner?.projectV2
      if (!board) throw new Error(`No se encuentra el proyecto #${link.number} de ${link.owner}.`)
      items.push(...board.items.nodes)
      cursor = board.items.pageInfo.hasNextPage && board.items.pageInfo.endCursor
    } while (cursor && items.length < LIMIT)

    const options = board.field?.options ?? []
    const movable = Boolean(board.viewerCanUpdate && board.field?.id)
    const drafts = new Map() // id → cuerpo, para abrir el borrador sin otra consulta.
    const list = items
      .filter((n) => !n.isArchived && n.content?.__typename)
      .map((n) => {
        const it = { ...element(n.content, n.status?.name ?? NO_STATUS), itemId: n.id, movable }
        if (it.kind === 'draft') {
          it.ref = n.id
          drafts.set(n.id, { ...it, body: n.content.body, bodyHTML: n.content.bodyHTML })
        }
        return it
      })
    const { login } = await viewer()
    return {
      id: board.id,
      fieldId: board.field?.id,
      title: board.title,
      url: board.url,
      columns: [
        { id: null, name: NO_STATUS, tone: 'muted' },
        ...options.map((o) => ({ id: o.id, name: o.name, tone: TONES[o.color] ?? 'muted' }))
      ],
      items: list,
      drafts,
      me: login
    }
  }

  async function load(project) {
    const link = await linkOf(project)
    if (!link) return null
    const { at, value } = remember(`${project.id}:board`, () => fetchBoard(link, project))
    return { link, ...(await value), syncedAt: at }
  }

  async function fetchDetail(ref) {
    const [, owner, name, number] = REF.exec(ref)
    const data = await graphql(DETAIL, { owner, name, number: Number(number) })
    const c = data.repository?.issueOrPullRequest
    if (!c) throw new Error(`No existe ${ref}.`)
    return {
      ...element(c),
      body: c.body,
      bodyHTML: c.bodyHTML,
      milestone: c.milestone?.title,
      branch: c.headRefName && `${c.headRefName} → ${c.baseRefName}`,
      parentTitle: c.parent?.title,
      notes: (c.comments?.nodes ?? []).reverse().map((n, i) => ({
        id: String(i),
        author: n.author?.login ?? 'fantasma',
        date: dateTimeFmt.format(new Date(n.createdAt)),
        body: n.body,
        html: n.bodyHTML
      })),
      children: (c.subIssues?.nodes ?? []).map((s) => element(s))
    }
  }

  // Los borradores solo existen en el proyecto: salen de los datos del tablero.
  async function detail(project, ref) {
    if (REF.test(ref)) {
      const { at, value } = remember(`${project.id}:item:${ref}`, () => fetchDetail(ref))
      return { at, it: await value }
    }
    const data = await load(project)
    const it = data?.drafts.get(ref)
    if (!it) throw new Error('El borrador ya no está en el proyecto.')
    return { at: data.syncedAt, it: { ...it, notes: [], children: [] } }
  }

  // --- Vista ------------------------------------------------------------------------------

  const ownerOf = (it) => (it.assignees.length ? it.assignees.join(', ') : 'Sin asignar')
  const people = (it) => (it.assignees.length ? it.assignees : ['Sin asignar'])
  const label = (it) => (it.kind === 'draft' ? it.title : `#${it.number} ${it.title}`)

  const openAction = (it) =>
    it.url
      ? [{ id: 'open', icon: 'external-link', title: 'Abrir en GitHub', args: { url: it.url } }]
      : []

  // Las PR ya tienen rama; solo se desarrollan issues y borradores. Y solo si la app lo admite.
  const developActions = (it) =>
    ctx.dev && it.kind !== 'pr' && !it.done
      ? [{ id: 'develop', icon: 'play', title: 'Iniciar desarrollo', args: { ref: it.ref } }]
      : []

  // Sin permiso de escritura en el proyecto no se ofrece mover.
  const moveActions = (it) =>
    it.movable
      ? [{ id: 'move', icon: 'kanban', title: 'Mover a otra columna', args: { ref: it.ref } }]
      : []

  const meta = (it) =>
    [
      it.type,
      it.repo?.nameWithOwner,
      it.parent && `en ${it.parent}`,
      it.updated && `actualizada el ${dateFmt.format(new Date(it.updated))}`
    ]
      .filter(Boolean)
      .join(' · ')

  const row = (it) => ({
    id: it.ref,
    title: label(it),
    description: ownerOf(it),
    badges: [ghState(it), ...(it.status ? [it.status] : []), ...it.labels],
    meta: meta(it),
    actions: [
      { id: 'item', icon: 'list-todo', title: 'Ver detalle', args: { ref: it.ref } },
      ...moveActions(it),
      ...developActions(it),
      ...openAction(it)
    ]
  })

  const itemList = (list, empty) => ({
    type: 'list',
    searchable: list.length > 5,
    empty,
    items: list.map(row)
  })

  // Avance de las sub-issues por columna del proyecto (barra apilada).
  function progress(children, tones) {
    const counts = new Map()
    for (const t of children) {
      const c = counts.get(t.status) ?? { label: t.status, value: 0, tone: tones.get(t.status) }
      c.value++
      counts.set(t.status, c)
    }
    return [...counts.values()]
  }

  // Una columna por opción de «Status», en el orden del proyecto. Las sub-issues van dentro de
  // su padre cuando también está en el proyecto.
  function kanban({ columns, items }) {
    const refs = new Set(items.map((it) => it.ref))
    const nested = (it) => Boolean(it.parent) && refs.has(it.parent)
    const childrenOf = new Map()
    for (const it of items.filter(nested))
      childrenOf.set(it.parent, [...(childrenOf.get(it.parent) ?? []), it])
    const cards = items.filter((it) => !nested(it))
    const tones = new Map(columns.map((c) => [c.name, c.tone]))
    return {
      type: 'kanban',
      filter: { label: 'Asignado a', all: 'Todas las personas' },
      empty: 'El proyecto no tiene elementos.',
      columns: columns
        // «Sin estado» solo si hay algo en ella, como en GitHub.
        .filter((c) => c.name !== NO_STATUS || cards.some((it) => it.status === NO_STATUS))
        .map((c) => ({
          id: c.name,
          title: c.name,
          tone: c.tone,
          items: cards
            .filter((it) => it.status === c.name)
            .map((it) => {
              const children = childrenOf.get(it.ref) ?? []
              return {
                id: it.ref,
                title: label(it),
                description: ownerOf(it),
                badges: it.kind === 'issue' && !it.done ? [] : [ghState(it)],
                meta: [it.type, it.repo?.name].filter(Boolean).join(' · '),
                ...(children.length && {
                  breakdown: progress(children, tones),
                  childrenLabel: `Sub-issues (${children.length})`,
                  children: children.map((t) => ({ ...row(t), filterValues: people(t) }))
                }),
                // Se filtra por sus responsables y por los de sus sub-issues.
                filterValues: [...new Set([...people(it), ...children.flatMap(people)])],
                action: { id: 'item', args: { ref: it.ref } },
                actions: [...moveActions(it), ...developActions(it)]
              }
            })
        }))
    }
  }

  function stats(items, mine, repos) {
    if (repos) {
      const count = (name) => items.filter((it) => it.status === name).length
      return {
        type: 'stats',
        items: [
          { label: 'Por hacer', value: count('Por hacer') },
          { label: 'En curso', value: count('En curso'), tone: 'info' },
          { label: 'Cerradas recientemente', value: count('Cerradas'), tone: 'success' },
          {
            label: 'Mis issues abiertas',
            value: mine.length,
            detail: {
              title: 'Mis issues abiertas',
              blocks: [itemList(mine, 'No tienes issues abiertas.')]
            }
          }
        ]
      }
    }
    const done = items.filter((it) => it.done).length
    const prs = items.filter((it) => it.kind === 'pr' && !it.done)
    return {
      type: 'stats',
      items: [
        {
          label: 'Cerradas',
          value: `${done}/${items.length}`,
          progress: items.length ? done / items.length : 0,
          tone: 'success'
        },
        { label: 'Abiertas', value: items.length - done, tone: 'info' },
        {
          label: 'PR abiertas',
          value: prs.length,
          detail: {
            title: 'Pull requests abiertas',
            blocks: [itemList(prs, 'No hay PR abiertas.')]
          }
        },
        {
          label: 'Mis elementos abiertos',
          value: mine.length,
          detail: {
            title: 'Mis elementos abiertos',
            blocks: [itemList(mine, 'No tienes elementos abiertos.')]
          }
        }
      ]
    }
  }

  const ago = (at) => {
    const min = Math.floor((Date.now() - at) / 60_000)
    return min < 1 ? 'ahora mismo' : `hace ${min} min (${timeFmt.format(at)})`
  }

  const refresh = { id: 'refresh', icon: 'refresh', title: 'Sincronizar con GitHub' }
  const linkAction = { id: 'link', label: 'Vincular con GitHub', icon: 'link' }

  const unlinked = {
    actions: [linkAction],
    blocks: [
      {
        type: 'text',
        tone: 'muted',
        text: 'Este proyecto no está vinculado con GitHub.\nVincúlalo a un GitHub Project o a las issues de sus repositorios.'
      }
    ]
  }

  async function renderBoard(project) {
    const data = await load(project)
    if (!data) return unlinked
    const { link, title, url, items, me, syncedAt, repos } = data
    const mine = items.filter((it) => !it.done && it.assignees.includes(me))
    const owner = link.owner ? ` (${link.owner})` : ''
    return {
      description: `${title}${owner} · ${me} · sincronizado ${ago(syncedAt)}`,
      actions: [
        ...(url
          ? [{ id: 'open', label: 'Abrir en GitHub', icon: 'external-link', args: { url } }]
          : []),
        { id: 'goto', icon: 'list-todo', title: 'Abrir una issue o PR por número' },
        { id: 'link', icon: 'link', title: 'Cambiar el tablero de GitHub' },
        refresh
      ],
      blocks: [
        stats(items, mine, repos),
        {
          type: 'tabs',
          tabs: [
            { id: 'board', label: `Tablero (${items.length})`, blocks: [kanban(data)] },
            {
              id: 'mine',
              label: `Mis elementos (${mine.length})`,
              blocks: [itemList(mine, 'No tienes elementos abiertos en este proyecto.')]
            }
          ]
        }
      ]
    }
  }

  async function renderItem(project, ref) {
    const { it, at } = await detail(project, ref)
    // La columna sale del tablero: la consulta de detalle no pasa por el proyecto.
    const board = await load(project).catch(() => null)
    const card = board?.items.find((x) => x.ref === ref)
    const status = card?.status
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
        ...(card ? moveActions(card).map((a) => ({ ...a, label: 'Mover a…' })) : []),
        ...openAction(it).map((a) => ({ ...a, label: 'Abrir en GitHub' })),
        refresh
      ],
      blocks: [
        { type: 'heading', text: label(it) },
        {
          type: 'list',
          items: [
            {
              id: 'estado',
              title: 'Estado',
              badges: [ghState(it), ...(status ? [status] : []), ...it.labels],
              meta: [meta(it), it.milestone && `hito ${it.milestone}`, it.branch]
                .filter(Boolean)
                .join(' · '),
              actions: it.parent
                ? [
                    {
                      id: 'item',
                      label: `Padre: ${it.parent}`,
                      icon: 'arrow-left',
                      args: { ref: it.parent }
                    }
                  ]
                : []
            }
          ]
        },
        section('Descripción', [
          /\S/.test(it.body ?? '')
            ? { type: 'html', html: it.bodyHTML }
            : { type: 'text', tone: 'muted', text: 'Sin descripción.' }
        ]),
        ...(it.children.length
          ? [
              section(
                `Sub-issues (${it.children.length})`,
                [itemList(it.children)],
                true,
                'children'
              )
            ]
          : []),
        ...(it.kind === 'draft'
          ? []
          : [
              section(
                `Comentarios (${it.notes.length})`,
                [
                  {
                    type: 'list',
                    empty: 'Sin comentarios.',
                    items: it.notes.map((c) => ({
                      id: c.id,
                      title: c.author,
                      meta: c.date,
                      html: c.html
                    }))
                  }
                ],
                false,
                'comments'
              )
            ])
      ]
    }
  }

  // --- Iniciar desarrollo -----------------------------------------------------------------

  // bugfix/… para bugs y feature/… para lo demás. Con el número delante, como `gh issue develop`.
  function branchFor(it) {
    const bug = /bug|error|fallo/i.test([it.type, ...it.labels].join(' '))
    const name = [it.number, slug(it.title)].filter(Boolean).join('-') || 'borrador'
    return `${bug ? 'bugfix' : 'feature'}/${name}`
  }

  function describe(it) {
    const parts = [
      `## ${it.type} ${it.ref && it.kind !== 'draft' ? `${it.ref}: ` : ''}${it.title}`,
      [
        `- Estado: ${ghState(it).label}`,
        `- Asignado a: ${ownerOf(it)}`,
        it.labels.length && `- Etiquetas: ${it.labels.join(', ')}`,
        it.milestone && `- Hito: ${it.milestone}`,
        it.url && `- GitHub: ${it.url}`
      ]
        .filter(Boolean)
        .join('\n')
    ]
    const add = (title, text) => text && parts.push(`### ${title}\n\n${text}`)
    add('Descripción', it.body?.trim())
    add(
      'Sub-issues',
      it.children
        .map((c) => `- ${c.ref} ${c.title} (${ghState(c).label}, ${ownerOf(c)})`)
        .join('\n')
    )
    add(
      'Comentarios recientes',
      it.notes
        .slice(0, 10)
        .map((c) => `**${c.author}** (${c.date}):\n${c.body}`)
        .join('\n\n')
    )
    return parts.join('\n\n')
  }

  async function develop(project, ref) {
    const { it } = await detail(project, ref)
    const parent = it.parent && (await detail(project, it.parent)).it
    const branch = branchFor(it)
    const intro = parent
      ? `# ${it.type} a desarrollar\n\nForma parte de: ${parent.type} ${parent.ref}. Céntrate en esta issue; lo demás es contexto.`
      : `# ${it.type} a desarrollar`
    const sections = [intro, describe(it)]
    if (parent) sections.push(describe(parent))
    const closes =
      it.kind === 'issue'
        ? ` Al abrir la PR, incluye \`Closes ${it.ref}\` en la descripción para cerrar la issue al fusionarla.`
        : ''
    sections.push(
      `# Cómo trabajar\n\nRama: \`${branch}\`. Analiza el código, aclara dudas y propón un plan antes de modificar nada.${closes}`
    )
    // Preselecciona el repo del proyecto que se llama como el de la issue.
    const repoId = project.repos.find(
      (r) => it.repo && r.name.toLowerCase() === it.repo.name.toLowerCase()
    )?.id
    await ctx.dev.start({
      projectId: project.id,
      repoId,
      branch,
      title: label(it),
      context: sections.join('\n\n')
    })
  }

  // Abre cualquier issue o PR escribiendo `owner/repo#123` (o solo `123` si el proyecto tiene
  // elementos de un único repo).
  async function goto(project) {
    const data = await load(project)
    const repos = [
      ...new Set((data?.items ?? []).map((it) => it.repo?.nameWithOwner).filter(Boolean))
    ]
    const prefix = repos.length === 1 ? `${repos[0]}#` : ''
    let ref = (
      (await ctx.ui.input({
        title: 'Abrir issue o pull request',
        placeholder: `${repos[0] ?? 'owner/repo'}#123`,
        value: prefix
      })) ?? ''
    ).trim()
    if (!ref || ref === prefix) return
    if (/^\d+$/.test(ref) && prefix) ref = prefix + ref
    if (!REF.test(ref))
      throw new Error(`«${ref}» no es una referencia de GitHub (p. ej. owner/repo#123).`)
    openItem.set(project.id, ref)
  }

  // --- Mover tarjetas ----------------------------------------------------------------------

  // Sin GitHub Project las columnas se deducen: mover cierra o reabre la issue, o te la asigna
  // («En curso») o te quita de ella («Por hacer»).
  async function moveIssue(it, column, me) {
    const [, owner, name, number] = REF.exec(it.ref)
    const issue = ['issue', '-R', `${owner}/${name}`]
    if (column.id === 'done') {
      await gh(...issue, 'close', number)
      Object.assign(it, { state: 'CLOSED', stateReason: 'COMPLETED', done: true })
    } else {
      if (it.done) {
        await gh(...issue, 'reopen', number)
        Object.assign(it, { state: 'OPEN', stateReason: null, done: false })
      }
      const mine = it.assignees.includes(me)
      if (column.id === 'doing' && !mine) {
        await gh(...issue, 'edit', number, '--add-assignee', '@me')
        it.assignees = [...it.assignees, me]
      }
      if (column.id === 'todo' && mine) {
        await gh(...issue, 'edit', number, '--remove-assignee', '@me')
        it.assignees = it.assignees.filter((a) => a !== me)
      }
    }
    it.status = repoStatus(it)
    return it.status === column.name
      ? `${label(it)} movida a «${column.name}».`
      : `${label(it)} sigue en «${it.status}»: tiene otras personas asignadas.`
  }

  // Cambia la columna (`Status`) de un elemento. «Sin estado» borra el valor, como en GitHub.
  async function move(project, ref) {
    const data = await load(project)
    const it = data?.items.find((x) => x.ref === ref)
    if (!it) throw new Error('El elemento ya no está en el tablero.')
    const picked = await ctx.ui.quickPick(
      data.columns
        .filter((c) => c.name !== it.status)
        .map((c) => ({
          id: c.id ?? 'none',
          label: c.name,
          ...(!c.id && { description: 'Quita el estado' }),
          ...(data.repos && { description: REPO_MOVES[c.id] })
        })),
      { placeholder: `Mover ${label(it)} a…` }
    )
    if (!picked) return
    const column = data.columns.find((c) => (c.id ?? 'none') === picked)
    if (data.repos) return { toast: await moveIssue(it, column, data.me) }
    const vars = { project: data.id, item: it.itemId, field: data.fieldId }
    if (column.id) await graphql(MOVE, { ...vars, option: column.id })
    else await graphql(CLEAR, vars)
    // Se cambia en la caché en vez de volver a descargar todo el proyecto.
    it.status = column.name
    return { toast: `${label(it)} movido a «${column.name}».` }
  }

  async function action(id, args, { project }) {
    if (id === 'open') return ctx.ui.openExternal(args.url)
    if (id === 'develop') return develop(project, args.ref)
    if (id === 'item') return void openItem.set(project.id, args.ref)
    if (id === 'back') return void openItem.delete(project.id)
    if (id === 'goto') return goto(project)
    if (id === 'link') return chooseLink(project)
    if (id === 'move') return move(project, args.ref)
    if (id === 'refresh') forget()
  }

  async function render({ project }) {
    const ref = openItem.get(project.id)
    if (!ref) return renderBoard(project)
    try {
      return await renderItem(project, ref)
    } catch (err) {
      if (err instanceof AuthError) throw err
      // Elemento borrado o sin permiso: vuelve al tablero en vez de quedarse atascado.
      console.error(err.message)
      openItem.delete(project.id)
      ctx.ui.toast(`No se pudo abrir ${ref}: ${err.message}`, 'error')
      return renderBoard(project)
    }
  }

  // Los errores se muestran en la propia pestaña; los de gh, con lo que hay que hacer.
  async function safeRender(context) {
    try {
      return await render(context)
    } catch (err) {
      console.error(err.message)
      const auth = err instanceof AuthError
      return {
        actions: auth ? [refresh] : [linkAction, refresh],
        blocks: [{ type: 'text', tone: 'error', text: err.message }]
      }
    }
  }

  ctx.views.register('board', { render: safeRender, action })
}

exports.deactivate = () => {}
