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
const formatDate = (iso) => dateFmt.format(new Date(iso))
const DAY = 24 * 60 * 60_000
const sprintDates = ({ attributes: a = {} }) =>
  a.startDate && a.finishDate
    ? `${formatDate(a.startDate)} – ${formatDate(a.finishDate)}`
    : 'Sin fechas'
const TIMEFRAME = { past: 'Sprint pasado', current: 'Sprint en curso', future: 'Sprint futuro' }

const refresh = { id: 'refresh', icon: 'refresh', title: 'Recargar' }
const linkAction = { id: 'link', label: 'Vincular proyecto', icon: 'link' }

exports.activate = (ctx) => {
  let cached // { token, expires } en memoria: `az` tarda ~1 s por llamada.
  const meta = new Map() // org/proyecto → { categories, states }: casi nunca cambian.

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
    if (id) await ctx.storage.set(sprintKey(project.id), id === 'current' ? null : id)
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
  function breakdown(md, title, list, empty) {
    const order = list.flatMap((it) => (md.states[it.type] ?? []).map((s) => s.name))
    const counts = new Map()
    for (const it of list) {
      if (stateInfo(md, it).category === 'Removed') continue
      const c = counts.get(it.state) ?? { label: it.state, value: 0, tone: stateInfo(md, it).tone }
      c.value++
      counts.set(it.state, c)
    }
    const items = [...counts.values()].sort(
      (a, b) => order.indexOf(a.label) - order.indexOf(b.label)
    )
    return { type: 'breakdown', title, items, empty }
  }

  function sprintStats(md, sprint, stories, tasks, bugs) {
    const live = (list) => list.filter((it) => stateInfo(md, it).category !== 'Removed')
    const [s, t, b] = [live(stories), live(tasks), live(bugs)]
    const sDone = s.filter((it) => isDone(md, it)).length
    const tDone = t.filter((it) => isDone(md, it)).length
    const bOpen = b.filter((it) => !isDone(md, it)).length
    const hours = t.reduce((n, it) => n + (isDone(md, it) ? 0 : it.remaining), 0)

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

    return {
      type: 'stats',
      items: [
        {
          label: TIMEFRAME[sprint.attributes?.timeFrame] ?? 'Sprint',
          value: sprint.name,
          hint: sprint.path
        },
        days,
        {
          label: 'Historias completadas',
          value: `${sDone}/${s.length}`,
          progress: s.length ? sDone / s.length : 0,
          tone: 'success'
        },
        {
          label: 'Tareas completadas',
          value: `${tDone}/${t.length}`,
          progress: t.length ? tDone / t.length : 0,
          hint: hours ? `${hours} h de trabajo restante` : undefined,
          tone: 'info'
        },
        {
          label: 'Bugs abiertos',
          value: bOpen,
          hint: `${b.length} en el sprint`,
          tone: bOpen ? 'error' : 'success'
        }
      ]
    }
  }

  const ownerOf = (it) => it.assignedTo || 'Sin asignar'
  const tasksDone = (md, story) =>
    story.tasks.length &&
    `${story.tasks.filter((t) => isDone(md, t)).length}/${story.tasks.length} tareas completadas`
  const hoursLeft = (md, story) =>
    story.tasks.reduce((n, t) => n + (isDone(md, t) ? 0 : t.remaining), 0)
  const byFlow = (md) => (a, b) => order(md, a) - order(md, b) || a.id - b.id

  // Tareas de una historia como subelementos (lista y kanban).
  const taskItems = (md, link, story) =>
    story.tasks.sort(byFlow(md)).map((t) => ({
      id: String(t.id),
      title: `#${t.id} ${t.title}`,
      badges: [{ label: t.state, tone: stateInfo(md, t).tone }],
      meta: [ownerOf(t), t.remaining && `${t.remaining} h restantes`].filter(Boolean).join(' · '),
      filterValues: [ownerOf(t)],
      actions: [openAction(link, t)]
    }))

  function storyList(md, link, stories, empty) {
    return {
      type: 'list',
      searchable: stories.length > 5,
      empty,
      items: stories.sort(byFlow(md)).map((it) => ({
        id: String(it.id),
        title: `#${it.id} ${it.title}`,
        badges: [{ label: it.state, tone: stateInfo(md, it).tone }],
        meta: [`Actualizada el ${formatDate(it.changed)}`, tasksDone(md, it)]
          .filter(Boolean)
          .join(' · '),
        childrenLabel: `Tareas (${it.tasks.length})`,
        children: taskItems(md, link, it),
        actions: [openAction(link, it)]
      }))
    }
  }

  // Una columna por estado de las historias, en el orden del flujo (sin «Removed»).
  function kanban(md, link, stories) {
    const states = new Map()
    for (const type of md.categories[STORY] ?? [])
      for (const s of md.states[type] ?? [])
        if (s.category !== 'Removed' && !states.has(s.name))
          states.set(s.name, TONES[s.category] ?? 'muted')
    // Por si alguna historia está en un estado que no devuelve la API.
    for (const it of stories) if (!states.has(it.state)) states.set(it.state, 'muted')

    return {
      type: 'kanban',
      filter: { label: 'Asignado a', all: 'Todas las personas' },
      empty: 'No hay historias de usuario en el sprint.',
      columns: [...states].map(([state, tone]) => ({
        id: state,
        title: state,
        tone,
        items: stories
          .filter((it) => it.state === state)
          .sort((a, b) => a.id - b.id)
          .map((it) => ({
            id: String(it.id),
            title: `#${it.id} ${it.title}`,
            description: ownerOf(it),
            meta: [tasksDone(md, it), hoursLeft(md, it) && `${hoursLeft(md, it)} h restantes`]
              .filter(Boolean)
              .join(' · '),
            // Se filtra por el responsable de la historia y por los de sus tareas.
            filterValues: [...new Set([ownerOf(it), ...it.tasks.map(ownerOf)])],
            childrenLabel: `Tareas (${it.tasks.length})`,
            children: taskItems(md, link, it),
            actions: [openAction(link, it)]
          }))
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

  // Datos comunes a las dos pestañas: vínculo, equipo, sprint elegido y sus elementos.
  async function load(project) {
    const link = await linkOf(project)
    if (!link) return null
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
    return {
      link,
      team,
      md,
      sprint,
      me,
      boardUrl,
      stories: items.filter(of(STORY)),
      tasks: items.filter(of(TASK)),
      bugs: items.filter(of(BUG)),
      live: (it) => stateInfo(md, it).category !== 'Removed'
    }
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

  const header = ({ link, team, sprint, boardUrl }) => ({
    description: `${link.org} / ${link.project} · equipo ${team}`,
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
    const { link, team, md, sprint, me, stories, tasks, bugs, live } = data
    const mine = await withTasks(
      link,
      md,
      stories.filter((it) => live(it) && it.assignedId === me)
    )

    return {
      ...header(data),
      blocks: sprint
        ? [
            sprintStats(md, sprint, stories, tasks, bugs),
            {
              type: 'columns',
              blocks: [
                breakdown(md, 'Historias por estado', stories, 'Sin historias en el sprint.'),
                breakdown(md, 'Tareas por estado', tasks, 'Sin tareas en el sprint.'),
                breakdown(md, 'Bugs por estado', bugs, 'Sin bugs en el sprint.')
              ]
            },
            { type: 'heading', text: `Mis historias en ${sprint.name} (${mine.length})` },
            storyList(md, link, mine, `No tienes historias de usuario asignadas en ${sprint.name}.`)
          ]
        : [noSprint(team)]
    }
  }

  async function renderKanban({ project }) {
    const data = await load(project)
    if (!data) return unlinked
    const { link, team, md, sprint, stories, live } = data
    return {
      ...header(data),
      blocks: sprint
        ? [kanban(md, link, await withTasks(link, md, stories.filter(live)))]
        : [noSprint(team)]
    }
  }

  async function action(id, args, { project }) {
    if (id === 'open') return ctx.ui.openExternal(args.url)
    if (id === 'link') return chooseLink(project)
    if (id === 'team') return chooseTeam(project)
    if (id === 'sprint') return chooseSprint(project)
    if (id === 'refresh') meta.clear()
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
