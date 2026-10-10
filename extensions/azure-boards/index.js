// Extensión Azure Boards: pestañas «Sprint» (dashboard) y «Kanban» en cada proyecto con el
// sprint del equipo en Azure DevOps. Usa la sesión de Azure CLI (`az login`), así que no guarda
// tokens.
// El proyecto de Azure DevOps se deduce del remoto git de sus repos o se elige a mano.

// Id de recurso de Azure DevOps en Microsoft Entra ID (fijo para todos los tenants).
const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'
const API = 'api-version=7.1'
const BATCH = 200

const STORY = 'Microsoft.RequirementCategory'
const TASK = 'Microsoft.TaskCategory'
const BUG = 'Microsoft.BugCategory'

// Categorías de estado de Azure DevOps → tono de la app.
const TONES = {
  Proposed: 'muted',
  InProgress: 'info',
  Resolved: 'warning',
  Completed: 'success'
}

const REMOTES = [
  /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//i,
  /^https:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\//i,
  /^(?:ssh:\/\/)?[^@\s]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com):v3\/([^/]+)\/([^/]+)\//i
]

const enc = encodeURIComponent
const wiql = (s) => `'${String(s).replaceAll("'", "''")}'`
const dateFmt = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})
const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
const formatDate = (iso) => dateFmt.format(new Date(iso))
const DAY = 24 * 60 * 60_000
// Los datos del sprint y de cada historia se guardan en memoria una hora: moverse entre
// pestañas e historias no llama a Azure DevOps. «Sincronizar» los descarta.
const TTL = 60 * 60_000
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' })
const sprintDates = ({ attributes: a = {} }) =>
  a.startDate && a.finishDate
    ? `${formatDate(a.startDate)} – ${formatDate(a.finishDate)}`
    : 'Sin fechas'

// Los campos de texto de Azure DevOps son HTML: la app lo sanea y lo pinta (bloque `html`).
// Vacío si solo lleva etiquetas o espacios (p. ej. `<div><br></div>`).
const hasText = (html) => /\S/.test(String(html ?? '').replace(/<[^>]*>|&nbsp;/gi, ''))

const refresh = { id: 'refresh', icon: 'refresh', title: 'Sincronizar con Azure DevOps' }
const linkAction = { id: 'link', label: 'Vincular proyecto', icon: 'link' }

exports.activate = (ctx) => {
  let cached // { token, expires } en memoria: `az` tarda ~1 s por llamada.
  const meta = new Map() // org/proyecto → { categories, states }: casi nunca cambian.
  const openStory = new Map() // id de proyecto → id de la historia abierta en el kanban.
  const store = new Map() // clave → { at, value }: ver `TTL`.

  // Guarda la promesa (no el resultado) para que dos pestañas a la vez compartan la petición.
  // Si falla no se guarda, para reintentar en el siguiente render.
  function remember(key, fn) {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < TTL) return hit
    const entry = { at: Date.now(), value: fn() }
    entry.value.catch(() => store.get(key) === entry && store.delete(key))
    store.set(key, entry)
    return entry
  }
  const forget = (prefix) => {
    for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
  }

  async function token() {
    if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.token
    const out = await ctx.exec('az', [
      'account',
      'get-access-token',
      '--resource',
      RESOURCE,
      '--output',
      'json'
    ])
    const { accessToken, expires_on } = JSON.parse(out)
    cached = { token: accessToken, expires: expires_on * 1000 }
    return accessToken
  }

  async function api(url, body) {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${await token()}`,
        Accept: 'application/json',
        ...(body && { 'Content-Type': 'application/json' })
      },
      body: body && JSON.stringify(body)
    })
    // Sin permisos Azure DevOps redirige a la página de login (HTML) en vez de dar 401.
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
      const detail = await res.json().catch(() => null)
      throw new Error(
        detail?.message || `Azure DevOps respondió ${res.status} en ${new URL(url).pathname}`
      )
    }
    return res.json()
  }

  const base = ({ org, project }) => `https://dev.azure.com/${enc(org)}/${enc(project)}`

  // --- Vínculo proyecto de la app → org/proyecto/equipo de Azure DevOps -------------

  const linkKey = (projectId) => `link:${projectId}`
  const sprintKey = (projectId) => `sprint:${projectId}`

  async function teamOf(link) {
    if (link.team) return link.team
    const { defaultTeam } = await api(
      `https://dev.azure.com/${enc(link.org)}/_apis/projects/${enc(link.project)}?${API}`
    )
    return defaultTeam?.name || `${link.project} Team`
  }

  async function chooseSprint(project) {
    const link = await linkOf(project)
    if (!link) return
    const all = (await sprints(link, await teamOf(link))).reverse()
    const when = { current: ' (en curso)', future: ' (futuro)' }
    const id = await ctx.ui.quickPick(
      [
        { id: 'current', label: 'Sprint en curso', description: 'Sigue al sprint actual' },
        ...all.map((it) => ({
          id: it.id,
          label: it.name + (when[it.attributes?.timeFrame] ?? ''),
          description: sprintDates(it)
        }))
      ],
      { placeholder: 'Sprint que quieres ver…' }
    )
    if (!id) return
    await ctx.storage.set(sprintKey(project.id), id === 'current' ? null : id)
    forget(`${project.id}:`)
  }

  // Busca un remoto de Azure DevOps en los repos del proyecto.
  async function detect(project) {
    for (const repo of project.repos) {
      let out
      try {
        out = await ctx.exec('git', ['remote', '-v'], { cwd: repo.path, timeout: 10_000 })
      } catch {
        continue
      }
      for (const url of out
        .split('\n')
        .map((l) => l.split(/\s+/)[1])
        .filter(Boolean)) {
        const m = REMOTES.map((re) => url.match(re)).find(Boolean)
        if (m) return { org: decodeURIComponent(m[1]), project: decodeURIComponent(m[2]) }
      }
    }
    return null
  }

  async function linkOf(project) {
    const saved = await ctx.storage.get(linkKey(project.id))
    if (saved) return saved
    const found = await detect(project)
    if (found) await ctx.storage.set(linkKey(project.id), found)
    return found
  }

  async function organizations() {
    const me = await api(`https://app.vssps.visualstudio.com/_apis/profile/profiles/me?${API}`)
    const { value } = await api(
      `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${me.id}&${API}`
    )
    return value.map((a) => a.accountName).sort((a, b) => a.localeCompare(b))
  }

  async function chooseLink(project) {
    const orgs = await organizations()
    if (!orgs.length)
      throw new Error('Tu cuenta no pertenece a ninguna organización de Azure DevOps.')
    const org =
      orgs.length === 1
        ? orgs[0]
        : await ctx.ui.quickPick(
            orgs.map((o) => ({ id: o, label: o, description: `dev.azure.com/${o}` })),
            { placeholder: 'Organización de Azure DevOps…' }
          )
    if (!org) return
    const { value } = await api(`https://dev.azure.com/${enc(org)}/_apis/projects?$top=500&${API}`)
    const name = await ctx.ui.quickPick(
      value
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ id: p.name, label: p.name, description: p.description?.slice(0, 60) })),
      { placeholder: `Proyecto de ${org} para «${project.name}»…` }
    )
    if (!name) return
    await ctx.storage.set(linkKey(project.id), { org, project: name })
    await ctx.storage.set(sprintKey(project.id), null)
    forget(`${project.id}:`)
    return { toast: `«${project.name}» vinculado a ${org}/${name}.` }
  }

  async function chooseTeam(project) {
    const link = await linkOf(project)
    if (!link) return
    const { value } = await api(
      `https://dev.azure.com/${enc(link.org)}/_apis/projects/${enc(link.project)}/teams?$top=500&${API}`
    )
    const team = await ctx.ui.quickPick(
      value
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.name, label: t.name, description: t.description?.slice(0, 60) })),
      { placeholder: 'Equipo cuyo sprint quieres ver…' }
    )
    if (!team) return
    await ctx.storage.set(linkKey(project.id), { ...link, team })
    await ctx.storage.set(sprintKey(project.id), null)
    forget(`${project.id}:`)
  }

  // --- Datos de Azure DevOps ----------------------------------------------------------

  // Tipos de cada categoría (historia, tarea, bug) y estados de cada tipo, en orden de flujo.
  async function metadata(link) {
    const key = `${link.org}/${link.project}`
    if (meta.has(key)) return meta.get(key)
    const { value } = await api(`${base(link)}/_apis/wit/workitemtypecategories?${API}`)
    const categories = Object.fromEntries(
      value.map((c) => [c.referenceName, c.workItemTypes.map((t) => t.name)])
    )
    const types = [...new Set([STORY, TASK, BUG].flatMap((c) => categories[c] ?? []))]
    const states = Object.fromEntries(
      await Promise.all(
        types.map(async (t) => {
          const { value } = await api(
            `${base(link)}/_apis/wit/workitemtypes/${enc(t)}/states?${API}`
          )
          return [t, value.map((s) => ({ name: s.name, category: s.category }))]
        })
      )
    )
    const result = { categories, states }
    meta.set(key, result)
    return result
  }

  async function workItems(link, ids) {
    const items = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const { value } = await api(`${base(link)}/_apis/wit/workitemsbatch?${API}`, {
        ids: ids.slice(i, i + BATCH),
        errorPolicy: 'omit',
        fields: [
          'System.Id',
          'System.Title',
          'System.WorkItemType',
          'System.State',
          'System.IterationPath',
          'System.ChangedDate',
          'System.AssignedTo',
          'Microsoft.VSTS.Scheduling.RemainingWork'
        ]
      })
      items.push(...value.filter(Boolean))
    }
    return items.map((w) => ({
      id: w.id,
      title: w.fields['System.Title'],
      type: w.fields['System.WorkItemType'],
      state: w.fields['System.State'],
      iteration: w.fields['System.IterationPath'],
      changed: w.fields['System.ChangedDate'],
      assignedTo: w.fields['System.AssignedTo']?.displayName,
      assignedId: w.fields['System.AssignedTo']?.id,
      remaining: w.fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0
    }))
  }

  // Descripción y criterios de aceptación de una historia (HTML).
  async function storyText(link, id) {
    const fields = ['System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria']
    const { fields: f = {} } = await api(
      `${base(link)}/_apis/wit/workitems/${id}?fields=${fields.join(',')}&${API}`
    )
    return { description: f[fields[0]], criteria: f[fields[1]] }
  }

  // Comentarios de un elemento, del más reciente al más antiguo. La API sigue en preview.
  async function comments(link, id) {
    const { comments = [] } = await api(
      `${base(link)}/_apis/wit/workItems/${id}/comments?$top=200&api-version=7.1-preview.4`
    )
    return comments
      .filter((c) => !c.isDeleted)
      .sort((a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate))
      .map((c) => ({
        id: c.id,
        author: c.createdBy?.displayName ?? 'Desconocido',
        date: dateTimeFmt.format(new Date(c.createdDate)),
        html: c.text
      }))
  }

  // Sprints del equipo, del más antiguo al más reciente.
  async function sprints(link, team) {
    const res = await api(`${base(link)}/${enc(team)}/_apis/work/teamsettings/iterations?${API}`)
    return res.value ?? res.values ?? []
  }

  // El sprint elegido para este proyecto o, si no hay ninguno (o ya no existe), el actual.
  async function selectedSprint(link, team, projectId) {
    const all = await sprints(link, team)
    const chosen = await ctx.storage.get(sprintKey(projectId))
    const sprint =
      all.find((it) => it.id === chosen) ?? all.find((it) => it.attributes?.timeFrame === 'current')
    if (!sprint) return null
    const { workItemRelations = [] } = await api(
      `${base(link)}/${enc(team)}/_apis/work/teamsettings/iterations/${sprint.id}/workitems?${API}`
    )
    const ids = [...new Set(workItemRelations.map((r) => r.target?.id).filter(Boolean))]
    return { ...sprint, items: await workItems(link, ids) }
  }

  // Añade a cada historia sus tareas (sin las eliminadas).
  async function withTasks(link, md, stories) {
    const tasks = await childTasks(link, stories)
    const live = (t) => stateInfo(md, t).category !== 'Removed'
    return stories.map((st) => ({ ...st, tasks: (tasks.get(st.id) ?? []).filter(live) }))
  }

  // Id de identidad del usuario de `az` en la organización (para comparar con AssignedTo).
  const identities = new Map()
  async function myId(link) {
    if (!identities.has(link.org)) {
      const data = await api(`https://dev.azure.com/${enc(link.org)}/_apis/connectionData`)
      identities.set(link.org, data.authenticatedUser.id)
    }
    return identities.get(link.org)
  }

  // Tareas hijas de cada historia (consulta de enlaces padre → hijo): id historia → tareas.
  async function childTasks(link, stories) {
    const byStory = new Map()
    if (!stories.length) return byStory
    const query = [
      'SELECT [System.Id] FROM WorkItemLinks',
      `WHERE [Source].[System.Id] IN (${stories.map((st) => st.id).join(', ')})`,
      "AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'",
      `AND [Target].[System.WorkItemType] IN GROUP ${wiql(TASK)}`,
      'MODE (MustContain)'
    ].join(' ')
    const { workItemRelations = [] } = await api(`${base(link)}/_apis/wit/wiql?${API}`, { query })
    // Sin `source` son las propias historias (raíces de la consulta).
    const links = workItemRelations.filter((r) => r.source && r.target)
    const tasks = new Map(
      (await workItems(link, [...new Set(links.map((r) => r.target.id))])).map((t) => [t.id, t])
    )
    for (const r of links) {
      const t = tasks.get(r.target.id)
      if (!t) continue
      if (!byStory.has(r.source.id)) byStory.set(r.source.id, [])
      byStory.get(r.source.id).push(t)
    }
    return byStory
  }

  // --- Vista ----------------------------------------------------------------------------

  function stateInfo(md, item) {
    const s = md.states[item.type]?.find((x) => x.name === item.state)
    return { category: s?.category, tone: TONES[s?.category] ?? 'muted' }
  }

  const isDone = (md, item) => stateInfo(md, item).category === 'Completed'

  // Recuento por estado en el orden del flujo de trabajo; sin los eliminados.
  // `detail(estado, elementos)` da el modal que se abre al pulsar cada estado.
  function byState(md, list, detail) {
    const order = list.flatMap((it) => (md.states[it.type] ?? []).map((s) => s.name))
    const counts = new Map()
    for (const it of list) {
      if (stateInfo(md, it).category === 'Removed') continue
      const c = counts.get(it.state) ?? {
        label: it.state,
        value: 0,
        tone: stateInfo(md, it).tone,
        items: []
      }
      c.value++
      c.items.push(it)
      counts.set(it.state, c)
    }
    return [...counts.values()]
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
      .map(({ items, ...c }) => ({ ...c, detail: detail?.(c.label, items) }))
  }

  const breakdown = (md, title, list, empty, detail) => ({
    type: 'breakdown',
    title,
    items: byState(md, list, detail),
    empty
  })

  // Modal con las historias (con sus tareas) o los elementos sueltos de un estado.
  const storiesIn = (md, link) => (state, list) => ({
    title: `Historias en «${state}» (${list.length})`,
    blocks: [storyList(md, link, list)]
  })
  const itemsIn = (md, link, noun) => (state, list) => ({
    title: `${noun} en «${state}» (${list.length})`,
    blocks: [workItemList(md, link, list)]
  })

  // `stories` ya vienen con sus tareas y sin las eliminadas. Con `owner`, las cifras son de esa
  // persona y su nombre va en el título de cada modal.
  function sprintStats(md, link, sprint, stories, tasks, bugs, owner) {
    const live = (list) => list.filter((it) => stateInfo(md, it).category !== 'Removed')
    const [s, t, b] = [stories, live(tasks), live(bugs)]
    const sDone = s.filter((it) => isDone(md, it)).length
    const tDone = t.filter((it) => isDone(md, it)).length
    const bOpen = b.filter((it) => !isDone(md, it)).length
    const hours = t.reduce((n, it) => n + (isDone(md, it) ? 0 : it.remaining), 0)

    const pending = s.filter((it) => !isDone(md, it))
    const of = owner ? ` · ${owner}` : ''
    const { startDate, finishDate } = sprint.attributes ?? {}
    let days = { label: 'Días restantes', value: '—', hint: 'El sprint no tiene fechas' }
    if (startDate && finishDate) {
      // finishDate es el último día del sprint (00:00 UTC): cuenta entero.
      const start = Date.parse(startDate)
      const end = Date.parse(finishDate) + DAY
      const left = Math.max(0, Math.ceil((end - Date.now()) / DAY))
      days = {
        label: 'Días restantes',
        value: left,
        hint: sprintDates(sprint),
        progress: (Date.now() - start) / (end - start),
        tone: left <= 2 && sDone < s.length ? 'warning' : undefined
      }
    }
    days.detail = {
      title: sprint.name + of,
      description: `${sprintDates(sprint)} · ${sprint.path}`,
      blocks: [
        { type: 'heading', text: `Historias pendientes (${pending.length})` },
        storyList(md, link, pending, 'Todas las historias del sprint están completadas.')
      ]
    }

    return {
      type: 'stats',
      items: [
        days,
        {
          label: 'Historias completadas',
          value: `${sDone}/${s.length}`,
          progress: s.length ? sDone / s.length : 0,
          tone: 'success',
          detail: {
            title: `Historias de ${sprint.name}${of}`,
            description: `${sDone} de ${s.length} completadas`,
            blocks: [
              breakdown(md, 'Por estado', s, 'Sin historias en el sprint.', storiesIn(md, link)),
              storyList(md, link, s, 'No hay historias de usuario en el sprint.')
            ]
          }
        },
        {
          label: 'Tareas completadas',
          value: `${tDone}/${t.length}`,
          progress: t.length ? tDone / t.length : 0,
          hint: hours ? `${hours} h de trabajo restante` : undefined,
          tone: 'info',
          detail: {
            title: `Tareas de ${sprint.name}${of}`,
            description: `${tDone} de ${t.length} completadas${hours ? ` · ${hours} h restantes` : ''}`,
            blocks: [
              breakdown(
                md,
                'Por estado',
                t,
                'Sin tareas en el sprint.',
                itemsIn(md, link, 'Tareas')
              ),
              workItemList(md, link, t, 'No hay tareas en el sprint.')
            ]
          }
        },
        {
          label: 'Bugs abiertos',
          value: bOpen,
          hint: `${b.length} en el sprint`,
          tone: bOpen ? 'error' : 'success',
          detail: {
            title: `Bugs de ${sprint.name}${of}`,
            description: `${bOpen} abiertos de ${b.length}`,
            blocks: [
              breakdown(md, 'Por estado', b, 'Sin bugs en el sprint.', itemsIn(md, link, 'Bugs')),
              workItemList(md, link, b, 'No hay bugs en el sprint.')
            ]
          }
        }
      ]
    }
  }

  // Una fila por persona con su avance; tú primero y «Sin asignar» al final.
  function members(md, link, me, stories, tasks, bugs) {
    const people = new Map()
    const add = (kind) => (it) => {
      const key = it.assignedId ?? ''
      if (!people.has(key))
        people.set(key, { key, name: ownerOf(it), stories: [], tasks: [], bugs: [] })
      people.get(key)[kind].push(it)
    }
    const live = (it) => stateInfo(md, it).category !== 'Removed'
    stories.forEach(add('stories'))
    tasks.filter(live).forEach(add('tasks'))
    bugs.filter(live).forEach(add('bugs'))

    const left = (p) => p.tasks.reduce((n, t) => n + (isDone(md, t) ? 0 : t.remaining), 0)
    const rank = (p) => (p.key === me ? 0 : p.key ? 1 : 2)
    const rows = [...people.values()].sort(
      (a, b) => rank(a) - rank(b) || left(b) - left(a) || a.name.localeCompare(b.name)
    )

    return {
      type: 'list',
      searchable: rows.length > 5,
      empty: 'No hay trabajo asignado en el sprint.',
      items: rows.map((p) => {
        const tDone = p.tasks.filter((t) => isDone(md, t)).length
        const sDone = p.stories.filter((it) => isDone(md, it)).length
        const bOpen = p.bugs.filter((it) => !isDone(md, it)).length
        const hours = left(p)
        return {
          id: p.key || 'none',
          title: p.key === me ? `${p.name} (tú)` : p.name,
          badges: bOpen
            ? [{ label: bOpen === 1 ? '1 bug abierto' : `${bOpen} bugs abiertos`, tone: 'error' }]
            : [],
          meta: [
            p.stories.length && `${sDone}/${p.stories.length} historias`,
            p.tasks.length && `${tDone}/${p.tasks.length} tareas`,
            hours && `${hours} h restantes`
          ]
            .filter(Boolean)
            .join(' · '),
          breakdown: byState(md, p.tasks, (state, list) => ({
            title: p.name,
            description: `Tareas en «${state}» (${list.length})`,
            blocks: [workItemList(md, link, list)]
          }))
        }
      })
    }
  }

  const ownerOf = (it) => it.assignedTo || 'Sin asignar'
  const hoursLeft = (md, story) => {
    const h = story.tasks.reduce((n, t) => n + (isDone(md, t) ? 0 : t.remaining), 0)
    return h ? `${h} h restantes` : null
  }
  const byFlow = (md) => (a, b) => order(md, a) - order(md, b) || a.id - b.id

  // Tarea o bug como fila de una lista.
  const workItem = (md, link, it) => ({
    id: String(it.id),
    title: `#${it.id} ${it.title}`,
    badges: [{ label: it.state, tone: stateInfo(md, it).tone }],
    meta: [ownerOf(it), it.remaining && `${it.remaining} h restantes`].filter(Boolean).join(' · '),
    actions: [openAction(link, it)]
  })

  const workItemList = (md, link, list, empty) => ({
    type: 'list',
    searchable: list.length > 5,
    empty,
    items: [...list].sort(byFlow(md)).map((it) => workItem(md, link, it))
  })

  // Tareas de una historia como subelementos (lista y kanban).
  const taskItems = (md, link, story) =>
    story.tasks
      .sort(byFlow(md))
      .map((t) => ({ ...workItem(md, link, t), filterValues: [ownerOf(t)] }))

  // Avance de las tareas de una historia por estado; cada estado abre sus tareas.
  const taskProgress = (md, link, story) =>
    byState(md, story.tasks, (state, list) => ({
      title: `#${story.id} ${story.title}`,
      description: `Tareas en «${state}» (${list.length})`,
      blocks: [workItemList(md, link, list)]
    }))

  function storyList(md, link, stories, empty) {
    return {
      type: 'list',
      searchable: stories.length > 5,
      empty,
      items: [...stories].sort(byFlow(md)).map((it) => ({
        id: String(it.id),
        title: `#${it.id} ${it.title}`,
        badges: [{ label: it.state, tone: stateInfo(md, it).tone }],
        meta: [`Actualizada el ${formatDate(it.changed)}`, hoursLeft(md, it)]
          .filter(Boolean)
          .join(' · '),
        breakdown: taskProgress(md, link, it),
        childrenLabel: `Tareas (${it.tasks.length})`,
        children: taskItems(md, link, it),
        actions: [openAction(link, it)]
      }))
    }
  }

  // Columnas por estado de los tipos de una categoría, en el orden del flujo (sin «Removed»).
  function stateColumns(md, category, list, card) {
    const states = new Map()
    for (const type of md.categories[category] ?? [])
      for (const s of md.states[type] ?? [])
        if (s.category !== 'Removed' && !states.has(s.name))
          states.set(s.name, TONES[s.category] ?? 'muted')
    // Por si algún elemento está en un estado que no devuelve la API.
    for (const it of list) if (!states.has(it.state)) states.set(it.state, 'muted')
    return [...states].map(([state, tone]) => ({
      id: state,
      title: state,
      tone,
      items: list
        .filter((it) => it.state === state)
        .sort((a, b) => a.id - b.id)
        .map(card)
    }))
  }

  // Tablero de historias: solo la historia y el avance de sus tareas; al pulsarla se abre su
  // pantalla con el tablero de tareas.
  function kanban(md, link, stories) {
    return {
      type: 'kanban',
      filter: { label: 'Asignado a', all: 'Todas las personas' },
      empty: 'No hay historias de usuario en el sprint.',
      columns: stateColumns(md, STORY, stories, (it) => ({
        id: String(it.id),
        title: `#${it.id} ${it.title}`,
        description: ownerOf(it),
        meta: [
          `${it.tasks.length} ${it.tasks.length === 1 ? 'tarea' : 'tareas'}`,
          hoursLeft(md, it)
        ]
          .filter(Boolean)
          .join(' · '),
        breakdown: taskProgress(md, link, it),
        // Se filtra por el responsable de la historia y por los de sus tareas.
        filterValues: [...new Set([ownerOf(it), ...it.tasks.map(ownerOf)])],
        action: { id: 'story', args: { id: it.id } }
      }))
    }
  }

  function taskBoard(md, link, story) {
    return {
      type: 'kanban',
      filter: { label: 'Asignado a', all: 'Todas las personas' },
      empty: 'La historia no tiene tareas.',
      columns: stateColumns(md, TASK, story.tasks, (t) => ({
        id: String(t.id),
        title: `#${t.id} ${t.title}`,
        description: ownerOf(t),
        meta: t.remaining ? `${t.remaining} h restantes` : undefined,
        filterValues: [ownerOf(t)],
        actions: [openAction(link, t)]
      }))
    }
  }

  const openAction = (link, it) => ({
    id: 'open',
    icon: 'external-link',
    title: 'Abrir en Azure DevOps',
    args: { url: `${base(link)}/_workitems/edit/${it.id}` }
  })

  // Posición del estado en el flujo de su tipo: pendientes primero, completadas al final.
  const order = (md, it) => (md.states[it.type] ?? []).findIndex((s) => s.name === it.state)

  // Error de az legible, o null si es otro tipo de fallo.
  function azError(err) {
    if (err.code === 'ENOENT')
      return 'No se encuentra Azure CLI. Instálalo con `winget install Microsoft.AzureCLI` y reinicia la app.'
    if (/az login|get-access-token|AADSTS/i.test(err.message))
      return 'Azure CLI no tiene sesión iniciada. Ejecuta `az login` en una terminal y recarga.'
    return null
  }

  // Datos comunes a las dos pestañas, desde la memoria si tienen menos de `TTL`.
  async function load(project) {
    const link = await linkOf(project)
    if (!link) return null
    const { at, value } = remember(`${project.id}:sprint`, () => fetchSprint(project, link))
    return { ...(await value), syncedAt: at }
  }

  // Vínculo, equipo, sprint elegido, sus elementos y las tareas de cada historia.
  async function fetchSprint(project, link) {
    const team = await teamOf(link)
    const [md, sprint, me] = await Promise.all([
      metadata(link),
      selectedSprint(link, team, project.id),
      myId(link)
    ])
    const of = (cat) => (it) => (md.categories[cat] ?? []).includes(it.type)
    const items = sprint?.items ?? []
    const boardUrl = sprint
      ? `${base(link)}/_sprints/taskboard/${enc(team)}/${sprint.path.split('\\').map(enc).join('/')}`
      : `${base(link)}/_boards/board/t/${enc(team)}`
    const live = (it) => stateInfo(md, it).category !== 'Removed'
    const stories = items.filter(of(STORY))
    return {
      link,
      team,
      md,
      sprint,
      me,
      boardUrl,
      stories,
      tasks: items.filter(of(TASK)),
      bugs: items.filter(of(BUG)),
      // Historias sin las eliminadas y con sus tareas.
      all: sprint ? await withTasks(link, md, stories.filter(live)) : [],
      live
    }
  }

  // Descripción, criterios y comentarios de una historia, desde la memoria si son recientes.
  const storyDetail = (project, link, id) =>
    remember(`${project.id}:story:${id}`, () =>
      Promise.all([storyText(link, id), comments(link, id)])
    ).value

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
        text: 'Ningún repositorio de este proyecto tiene un remoto de Azure DevOps.\nVincúlalo a mano a un proyecto de Azure DevOps para ver su board.'
      }
    ]
  }

  const noSprint = (team) => ({
    type: 'text',
    tone: 'muted',
    text: `El equipo ${team} no tiene un sprint en curso. Elige uno con el botón de sprint.`
  })

  const header = ({ link, team, sprint, boardUrl, syncedAt }) => ({
    description: `${link.org} / ${link.project} · equipo ${team} · sincronizado ${ago(syncedAt)}`,
    actions: [
      {
        id: 'sprint',
        label: sprint ? sprint.name : 'Elegir sprint',
        icon: 'calendar',
        title: 'Elegir sprint'
      },
      { id: 'open', label: 'Abrir board', icon: 'external-link', args: { url: boardUrl } },
      { id: 'team', icon: 'users', title: 'Cambiar de equipo' },
      { id: 'link', icon: 'link', title: 'Vincular a otro proyecto de Azure DevOps' },
      refresh
    ]
  })

  async function renderDashboard({ project }) {
    const data = await load(project)
    if (!data) return unlinked
    const { link, team, md, sprint, me, all, stories, tasks, bugs } = data
    if (!sprint) return { ...header(data), blocks: [noSprint(team)] }
    const isMine = (it) => it.assignedId === me
    const mine = all.filter(isMine)
    // Historias de otras personas en las que tengo tareas.
    const helping = all.filter((it) => !isMine(it) && it.tasks.some(isMine))
    const myName = [...stories, ...tasks, ...bugs].find(isMine)?.assignedTo ?? 'tú'

    const byStateColumns = (s, t, b) => ({
      type: 'columns',
      blocks: [
        breakdown(md, 'Historias por estado', s, 'Sin historias.', storiesIn(md, link)),
        breakdown(md, 'Tareas por estado', t, 'Sin tareas.', itemsIn(md, link, 'Tareas')),
        breakdown(md, 'Bugs por estado', b, 'Sin bugs.', itemsIn(md, link, 'Bugs'))
      ]
    })

    const [myTasks, myBugs] = [tasks.filter(isMine), bugs.filter(isMine)]
    const personal = [
      sprintStats(md, link, sprint, mine, myTasks, myBugs, myName),
      byStateColumns(mine, myTasks, myBugs),
      { type: 'heading', text: `Mis historias (${mine.length})` },
      storyList(md, link, mine, `No tienes historias de usuario asignadas en ${sprint.name}.`),
      ...(helping.length
        ? [
            {
              type: 'heading',
              text: `Historias de otras personas con tareas mías (${helping.length})`
            },
            storyList(md, link, helping)
          ]
        : [])
    ]
    const teamWide = [
      sprintStats(md, link, sprint, all, tasks, bugs),
      byStateColumns(all, tasks, bugs),
      { type: 'heading', text: 'Por persona' },
      members(md, link, me, all, tasks, bugs)
    ]

    return {
      ...header(data),
      blocks: [
        {
          type: 'tabs',
          tabs: [
            { id: 'me', label: 'Mis métricas', blocks: personal },
            { id: 'team', label: `Equipo ${team}`, blocks: teamWide }
          ]
        }
      ]
    }
  }

  async function renderKanban({ project }) {
    const data = await load(project)
    if (!data) return unlinked
    const { link, team, md, sprint, all } = data
    if (!sprint) return { ...header(data), blocks: [noSprint(team)] }
    // Si la historia abierta ya no está en el sprint (otro sprint, eliminada…), vuelve al tablero.
    const story = all.find((it) => it.id === openStory.get(project.id))
    if (story) return renderStory(project, data, story)
    openStory.delete(project.id)
    return { ...header(data), blocks: [kanban(md, link, all)] }
  }

  async function renderStory(project, { link, md, sprint, syncedAt }, story) {
    const [{ description, criteria }, notes] = await storyDetail(project, link, story.id)
    const section = (title, html, empty, open = true) => ({
      type: 'section',
      title,
      open,
      blocks: [
        hasText(html) ? { type: 'html', html } : { type: 'text', tone: 'muted', text: empty }
      ]
    })
    return {
      description: `${sprint.name} · ${story.type} · ${ownerOf(story)} · sincronizado ${ago(syncedAt)}`,
      actions: [
        { id: 'back', label: 'Volver al tablero', icon: 'arrow-left' },
        { ...openAction(link, story), label: 'Abrir en Azure DevOps' },
        refresh
      ],
      blocks: [
        { type: 'heading', text: `#${story.id} ${story.title}` },
        {
          type: 'list',
          items: [
            {
              id: String(story.id),
              title: 'Estado',
              badges: [{ label: story.state, tone: stateInfo(md, story).tone }],
              meta: [`Actualizada el ${formatDate(story.changed)}`, hoursLeft(md, story)]
                .filter(Boolean)
                .join(' · '),
              breakdown: taskProgress(md, link, story)
            }
          ]
        },
        section('Descripción', description, 'Sin descripción.'),
        section('Criterios de aceptación', criteria, 'Sin criterios de aceptación.'),
        {
          type: 'section',
          id: 'tasks',
          title: `Tareas (${story.tasks.length})`,
          blocks: [taskBoard(md, link, story)]
        },
        {
          type: 'section',
          id: 'comments',
          title: `Comentarios (${notes.length})`,
          blocks: [
            {
              type: 'list',
              empty: 'Sin comentarios.',
              items: notes.map((c) => ({
                id: String(c.id),
                title: c.author,
                meta: c.date,
                html: c.html
              }))
            }
          ]
        }
      ]
    }
  }

  async function action(id, args, { project }) {
    if (id === 'open') return ctx.ui.openExternal(args.url)
    if (id === 'story') return void openStory.set(project.id, args.id)
    if (id === 'back') return void openStory.delete(project.id)
    if (id === 'link') return chooseLink(project)
    if (id === 'team') return chooseTeam(project)
    if (id === 'sprint') return chooseSprint(project)
    if (id === 'refresh') {
      meta.clear()
      forget(`${project.id}:`)
    }
  }

  // Los errores de az se muestran en la propia pestaña, con la opción de vincular otro proyecto.
  const safe = (render) => async (context) => {
    try {
      return await render(context)
    } catch (err) {
      console.error(err.message)
      return {
        actions: [linkAction, refresh],
        blocks: [{ type: 'text', tone: 'error', text: azError(err) || err.message }]
      }
    }
  }

  ctx.views.register('dashboard', { render: safe(renderDashboard), action })
  ctx.views.register('kanban', { render: safe(renderKanban), action })
}
