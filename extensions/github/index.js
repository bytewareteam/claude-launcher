// Extensión de GitHub: usa la sesión de GitHub CLI (`gh auth login`), así que no guarda tokens.
const { existsSync } = require('fs')
const { join } = require('path')

const FIELDS = 'name,nameWithOwner,description,isPrivate,isFork,isArchived,updatedAt,url,primaryLanguage'
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

function timeAgo(iso) {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000)
  if (days > -1) return 'hoy'
  if (days > -30) return rtf.format(days, 'day')
  if (days > -365) return rtf.format(Math.round(days / 30), 'month')
  return rtf.format(Math.round(days / 365), 'year')
}

exports.activate = (ctx) => {
  const gh = (...args) => ctx.exec('gh', args)

  // Usuario con sesión en gh, o una vista explicando qué falta.
  async function login() {
    try {
      return { user: (await gh('api', 'user', '--jq', '.login')).trim() }
    } catch (err) {
      const text =
        err.code === 'ENOENT'
          ? 'No se encuentra GitHub CLI. Instálalo con `winget install GitHub.cli` y reinicia la app.'
          : 'GitHub CLI no tiene sesión iniciada. Ejecuta `gh auth login` en una terminal y recarga.'
      return {
        view: {
          actions: [{ id: 'refresh', label: 'Recargar', icon: 'refresh' }],
          blocks: [{ type: 'text', text, tone: 'error' }]
        }
      }
    }
  }

  ctx.views.register('repos', {
    async render() {
      const { user, view } = await login()
      if (view) return view
      const owner = (await ctx.storage.get('owner')) || user
      const repos = JSON.parse(await gh('repo', 'list', owner, '--limit', '500', '--json', FIELDS))
      repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return {
        description: `Repositorios de ${owner} en GitHub. Clona uno y añádelo a un proyecto.`,
        actions: [
          { id: 'owner', label: owner, icon: 'user', title: 'Cambiar de usuario u organización' },
          { id: 'refresh', label: 'Recargar', icon: 'refresh' }
        ],
        blocks: [
          {
            type: 'list',
            searchable: true,
            empty: `${owner} no tiene repositorios.`,
            items: repos.map((r) => ({
              id: r.nameWithOwner,
              title: r.name,
              description: r.description || '',
              badges: [
                r.isPrivate && 'privado',
                r.isFork && 'fork',
                r.isArchived && 'archivado',
                r.primaryLanguage?.name
              ].filter(Boolean),
              meta: `actualizado ${timeAgo(r.updatedAt)}`,
              actions: [
                { id: 'open', icon: 'external-link', title: 'Abrir en GitHub', args: { url: r.url } },
                { id: 'clone', label: 'Clonar', icon: 'download', args: { repo: r.nameWithOwner, name: r.name, url: r.url } }
              ]
            }))
          }
        ]
      }
    },

    async action(id, args) {
      if (id === 'refresh') return
      if (id === 'open') return ctx.ui.openExternal(args.url)
      if (id === 'owner') return chooseOwner()
      if (id === 'clone') return clone(args)
    }
  })

  async function chooseOwner() {
    const { user } = await login()
    if (!user) return
    const orgs = (await gh('api', 'user/orgs', '--jq', '.[].login')).split(/\r?\n/).filter(Boolean)
    const owner = await ctx.ui.quickPick(
      [
        { id: user, label: user, description: 'Tu cuenta' },
        ...orgs.map((o) => ({ id: o, label: o, description: 'Organización' }))
      ],
      { placeholder: 'Ver los repositorios de…' }
    )
    if (owner) await ctx.storage.set('owner', owner === user ? null : owner)
  }

  async function clone({ repo, name, url }) {
    const parent = await ctx.ui.pickFolder({
      title: `¿Dónde clonar ${repo}?`,
      defaultPath: await ctx.storage.get('cloneDir')
    })
    if (!parent) return
    await ctx.storage.set('cloneDir', parent)
    const dest = join(parent, name)
    if (existsSync(dest)) throw new Error(`Ya existe ${dest}`)
    // Con la URL HTTPS gh no usa su `git_protocol` (que puede ser ssh sin clave configurada)
    // y autentica a git con su propio token.
    await ctx.exec('gh', ['repo', 'clone', url, dest], { timeout: 15 * 60_000 })

    const projects = await ctx.projects.list()
    const projectId = await ctx.ui.quickPick(
      [
        ...projects.map((p) => ({ id: p.id, label: p.name, description: `${p.repos.length} repos` })),
        { id: 'none', label: 'No añadir a ningún proyecto' }
      ],
      { placeholder: `${name} clonado. ¿A qué proyecto lo añades?` }
    )
    if (projectId && projectId !== 'none') {
      await ctx.projects.addRepo(projectId, dest)
      return { toast: `${repo} clonado y añadido al proyecto.` }
    }
    return { toast: `${repo} clonado en ${dest}` }
  }
}
