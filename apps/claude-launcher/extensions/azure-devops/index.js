// Extensión de Azure DevOps: usa la sesión de Azure CLI (`az login`), así que no guarda tokens.
// Solo pide a `az` un token de acceso; el resto son llamadas a la API REST de Azure DevOps.
const { existsSync } = require('fs')
const { join } = require('path')

// Id de recurso de Azure DevOps en Microsoft Entra ID (fijo para todos los tenants).
const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'
const API = 'api-version=7.1'

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

exports.activate = (ctx) => {
  let cached // { token, expires } en memoria: `az` tarda ~1 s por llamada.

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

  async function api(url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' }
    })
    // Sin permisos Azure DevOps redirige a la página de login (HTML) en vez de dar 401.
    if (!res.ok || !res.headers.get('content-type')?.includes('json'))
      throw new Error(`Azure DevOps respondió ${res.status} en ${new URL(url).pathname}`)
    return res.json()
  }

  // Organizaciones del usuario con sesión en az, o una vista explicando qué falta.
  async function login() {
    try {
      const me = await api(`https://app.vssps.visualstudio.com/_apis/profile/profiles/me?${API}`)
      const { value } = await api(
        `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${me.id}&${API}`
      )
      return { orgs: value.map((a) => a.accountName).sort((a, b) => a.localeCompare(b)) }
    } catch (err) {
      console.error(err.message)
      const text =
        err.code === 'ENOENT'
          ? 'No se encuentra Azure CLI. Instálalo con `winget install Microsoft.AzureCLI` y reinicia la app.'
          : 'Azure CLI no tiene sesión iniciada. Ejecuta `az login` en una terminal y recarga.'
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
      const { orgs, view } = await login()
      if (view) return view
      if (!orgs.length)
        return {
          actions: [{ id: 'refresh', label: 'Recargar', icon: 'refresh' }],
          blocks: [
            {
              type: 'text',
              text: 'Tu cuenta no pertenece a ninguna organización de Azure DevOps.',
              tone: 'muted'
            }
          ]
        }
      const saved = await ctx.storage.get('org')
      const org = orgs.includes(saved) ? saved : orgs[0]
      const { value } = await api(
        `https://dev.azure.com/${encodeURIComponent(org)}/_apis/git/repositories?${API}`
      )
      const repos = value.sort(
        (a, b) => a.project.name.localeCompare(b.project.name) || a.name.localeCompare(b.name)
      )
      return {
        description: `Repositorios de la organización ${org} en Azure DevOps. Clona uno y añádelo a un proyecto.`,
        actions: [
          orgs.length > 1 && {
            id: 'org',
            label: org,
            icon: 'user',
            title: 'Cambiar de organización'
          },
          { id: 'refresh', label: 'Recargar', icon: 'refresh' }
        ].filter(Boolean),
        blocks: [
          {
            type: 'list',
            searchable: true,
            empty: `${org} no tiene repositorios.`,
            items: repos.map((r) => ({
              id: r.id,
              title: r.name,
              description: r.project.name,
              badges: [
                r.project.visibility === 'public' ? 'público' : 'privado',
                r.isDisabled && 'deshabilitado',
                r.isFork && 'fork',
                r.defaultBranch?.replace('refs/heads/', '')
              ].filter(Boolean),
              meta: r.size ? formatSize(r.size) : 'vacío',
              actions: [
                {
                  id: 'open',
                  icon: 'external-link',
                  title: 'Abrir en Azure DevOps',
                  args: { url: r.webUrl }
                },
                !r.isDisabled && {
                  id: 'clone',
                  label: 'Clonar',
                  icon: 'download',
                  args: { name: r.name, project: r.project.name, url: r.remoteUrl }
                }
              ].filter(Boolean)
            }))
          }
        ]
      }
    },

    async action(id, args) {
      if (id === 'refresh') return
      if (id === 'open') return ctx.ui.openExternal(args.url)
      if (id === 'org') return chooseOrg()
      if (id === 'clone') return clone(args)
    }
  })

  async function chooseOrg() {
    const { orgs } = await login()
    if (!orgs) return
    const org = await ctx.ui.quickPick(
      orgs.map((o) => ({ id: o, label: o, description: `dev.azure.com/${o}` })),
      { placeholder: 'Ver los repositorios de…' }
    )
    if (org) await ctx.storage.set('org', org)
  }

  async function clone({ name, project, url }) {
    const parent = await ctx.ui.pickFolder({
      title: `¿Dónde clonar ${project}/${name}?`,
      defaultPath: await ctx.storage.get('cloneDir')
    })
    if (!parent) return
    await ctx.storage.set('cloneDir', parent)
    const dest = join(parent, name)
    if (existsSync(dest)) throw new Error(`Ya existe ${dest}`)
    // El token va por entorno (no en la línea de comandos ni en .git/config): solo vale para
    // este clone. Los fetch/push posteriores usan el gestor de credenciales de git.
    await ctx.exec('git', ['clone', url, dest], {
      timeout: 15 * 60_000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${await token()}`
      }
    })

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
