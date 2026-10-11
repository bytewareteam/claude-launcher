# Extensiones de Claude Launcher

Una extensión es una carpeta con un `package.json` y un archivo JS (CommonJS). La app no trae
ninguna: el usuario las instala desde la pantalla *Extensiones*.

- **Disponibles**: catálogo publicado en
  `https://bytewareteam.github.io/claude-launcher/extensions.json`. Instalar descarga el `.zip`,
  comprueba su sha256 y que pide los mismos permisos que muestra el catálogo. El catálogo va firmado
  (ed25519, `extensions.json.sig`) y la app lo rechaza si la firma no coincide con la clave pública
  que lleva dentro o si es anterior al último que aceptó.
- **Instalar desde .zip**: cualquier paquete con `package.json` en la raíz (o en una única carpeta).
- Las credenciales y datos de una extensión solo se conservan al actualizarla desde el catálogo.
  Instalar un `.zip` encima de una extensión (o pasar de un `.zip` al catálogo) los borra; la app
  lo avisa antes de confirmar.
- Todas se instalan en `%APPDATA%/claude-launcher/extensions/<name>/` y solo se activan tras aceptar
  sus permisos. Si una actualización cambia los permisos, vuelve a pedirlos.
- En desarrollo (`npm run dev`) la app también carga las de esta carpeta, marcadas como
  *desarrollo*. Tras editarlas, pulsa **Recargar**.

## Publicar una extensión

Cada carpeta de `extensions/` es un proyecto Nx (`ext-<name>`) con versión propia:

1. Commits con Conventional Commits que toquen solo esa carpeta (`feat(azure-devops): …`).
2. En el push a `main`, `nx release` sube su versión, escribe su `CHANGELOG.md` y crea el tag
   `ext-<name>-vX.Y.Z` con su release en GitHub; el workflow adjunta el `.zip`.
3. El workflow *Pages* regenera `extensions.json` a partir de los `.zip` publicados y lo firma con
   el secret `CATALOG_SIGNING_KEY`. Para cambiar la clave: `node scripts/extensions.mjs keygen`,
   la privada al secret y la pública a `CATALOG_PUBLIC_KEY` de
   `apps/claude-launcher/src/main/extension-packages.js`.

Para generar el `.zip` en local: `npx nx run ext-<name>:package` (queda en `dist/`). Para probar un
catálogo sin publicarlo, arranca la app con `CLAUDE_LAUNCHER_CATALOG=<ruta a extensions.json>`; en
desarrollo (`npm run dev`) se admite sin `.sig`, pero si lo tiene debe ser válido.

## Modelo de seguridad

- Cada extensión corre en su propio `utilityProcess`, con el mismo entorno mínimo que la terminal
  (`SYSTEM_VARS` de `src/main/terminal.js`).
- No comparte memoria con el proceso principal: **no ve la bóveda** ni puede hablar con la ventana.
- Con el permiso `secrets` puede guardar sus propias credenciales (las que el usuario le da, p. ej. un
  token de API), cifradas con `safeStorage` aparte de la bóveda. Solo ve las suyas y se borran al
  desinstalarla.
- Su UI es **declarativa**: devuelve JSON y la app lo pinta. Ningún código de la extensión llega
  al renderer.
- Los permisos del manifest controlan la API de `ctx`. Ojo: el proceso es Node completo, así que
  una extensión maliciosa podría leer archivos por su cuenta. Electron no admite el modelo de
  permisos de Node en `utilityProcess`; por eso las extensiones de usuario piden consentimiento.

## Manifest (`package.json`)

```json
{
  "name": "mi-extension",
  "displayName": "Mi extensión",
  "version": "0.1.0",
  "description": "Qué hace.",
  "main": "index.js",
  "claudeLauncher": {
    "apiVersion": 1,
    "permissions": {
      "exec": ["gh", "git"],
      "projects": true,
      "dialogs": true,
      "develop": true,
      "secrets": true
    },
    "views": [{ "id": "principal", "title": "Mi vista", "icon": "puzzle" }],
    "projectTabs": [{ "id": "board", "title": "Board", "icon": "kanban" }],
    "board": { "title": "Mi tablero", "icon": "kanban" },
    "repoSources": [{ "id": "principal", "title": "Mi servicio", "icon": "cloud" }]
  }
}
```

| Permiso | Desbloquea |
| --- | --- |
| `exec: [...]` | `ctx.exec(cmd, ...)` solo con esos programas |
| `projects` | `ctx.projects.list()` y `ctx.projects.addRepo()` |
| `dialogs` | `ctx.ui.pickFolder()` |
| `develop` | `ctx.dev.start()` |
| `secrets` | `ctx.secrets.get()` y `ctx.secrets.set()` |

Cada vista de `views` aparece en la barra lateral; cada una de `projectTabs`, como pestaña en la
pantalla de cada proyecto. Ambas se registran igual con `ctx.views.register`. Una pestaña de
proyecto recibe en `render(context)` y `action(id, args, context)` el proyecto que se está viendo:
`context.project = { id, name, repos: [{ id, name, path }] }` (no hace falta el permiso `projects`).

Con `board`, la extensión es un **tablero** (Jira, Azure Boards, GitHub Projects…): sus
`projectTabs` no salen en todos los proyectos, sino solo en los que lo eligen con el botón
*Conectar tablero* de la pantalla del proyecto. Cada proyecto conecta como mucho un tablero, así que no se mezclan. `title` e `icon`
(opcionales) son los que se muestran en ese menú; por defecto, `displayName`.

Cada entrada de `repoSources` apunta a una vista registrada (puede ser la misma de `views`) y
añade «Clonar desde *title*…» al botón *Añadir repositorio* de cada proyecto. La vista se abre en
un diálogo y, como las pestañas de proyecto, recibe `context.project`: clona y añade el repo a ese
proyecto con `ctx.projects.addRepo`. Si la acción devuelve `{ close: true }`, el diálogo se cierra.

Iconos disponibles (p. ej. `layout-dashboard`, `kanban`, `bitbucket`): ver `apps/claude-launcher/src/renderer/src/lib/extIcons.js`.

## Código (`index.js`)

```js
exports.activate = (ctx) => {
  ctx.views.register('principal', {
    async render() {
      return {
        title: 'Opcional, sustituye al del manifest',
        description: 'Texto bajo el título',
        actions: [{ id: 'refresh', label: 'Recargar', icon: 'refresh' }],
        blocks: [
          { type: 'text', text: 'Hola', tone: 'muted' }, // tone: muted | error
          {
            type: 'list',
            searchable: true,
            empty: 'No hay nada',
            items: [
              {
                id: 'a',
                title: 'Elemento',
                description: 'Detalle',
                badges: ['etiqueta'],
                meta: 'texto pequeño',
                actions: [{ id: 'go', label: 'Ir', icon: 'download', args: { x: 1 } }]
              }
            ]
          }
        ]
      }
    },
    // Tras cada acción la vista se vuelve a pintar. Devuelve { toast } para avisar.
    async action(actionId, args) {
      return { toast: 'Hecho' }
    }
  })
}

exports.deactivate = () => {}
```

Una acción sin `label` se muestra como botón de icono (usa `title` como tooltip).

### Bloques

| Bloque | Campos |
| --- | --- |
| `text` | `text`, `tone?` |
| `heading` | `text` |
| `html` | `html`: HTML que la app sanea con DOMPurify (texto, listas, tablas y enlaces `https`; sin estilos, imágenes ni scripts) |
| `list` | `items`, `searchable?`, `empty?`. Cada `badge` es texto o `{ label, tone }`; `children` (mismos campos), `childrenLabel` y `childrenOpen` (por defecto `false`) añaden una sublista plegable; `body` es texto largo con saltos de línea y `html`, HTML saneado como el del bloque `html`; `breakdown: [{ label, value, tone?, detail? }]` pinta una barra apilada pequeña con leyenda |
| `stats` | `items: [{ label, value, hint?, tone?, progress?, detail? }]` (`progress` de 0 a 1) |
| `breakdown` | `title`, `items: [{ label, value, tone?, detail? }]`, `empty?`: barra apilada con leyenda |
| `columns` | `blocks`: otros bloques en columnas |
| `section` | `title`, `blocks`, `open?` (por defecto `false`), `id?`: sección plegable; la app recuerda si se plegó |
| `tabs` | `tabs: [{ id, label, blocks }]`: pestañas, cada una con sus bloques |
| `kanban` | `columns: [{ id, title, tone?, items }]`, `filter?: { label, all? }`, `empty?`. Los `items` son como los de `list` (con `children`); con `filter`, cada tarjeta indica en `filterValues: [...]` los valores por los que se puede filtrar y los `children` que no coinciden se atenúan. Con `action: { id, args }` toda la tarjeta se puede pulsar y llama a `action(id, args)` (p. ej. para abrir otra pantalla) |

Tonos: `muted`, `info`, `success`, `warning`, `error`.

Con `detail: { title, description?, blocks }`, una cifra de `stats` o un segmento de `breakdown` se puede pulsar y abre un modal con esos bloques.

## API de `ctx`

| Método | Devuelve |
| --- | --- |
| `ctx.exec(cmd, args, { cwd, timeout, env })` | stdout; error con `.code` (`ENOENT` si no existe). `env` se suma al entorno mínimo |
| `ctx.projects.list()` | `[{ id, name, repos: [{ id, name, path }] }]` |
| `ctx.projects.addRepo(projectId, path)` | Añade el repo git en `path` al proyecto |
| `ctx.ui.quickPick(items, { placeholder })` | `id` elegido o `null`. `items: [{ id, label, description? }]` |
| `ctx.ui.input({ title, description, placeholder, value, password })` | Texto escrito o `null` si se cancela. Con `password` se oculta |
| `ctx.ui.pickFolder({ title, defaultPath })` | Ruta o `null` |
| `ctx.ui.toast(mensaje, 'info' \| 'error')` | — |
| `ctx.ui.openExternal(url)` | Abre un enlace `https://` en el navegador |
| `ctx.dev.start({ projectId, branch, title, context, repoId? })` | Abre el diálogo *Iniciar desarrollo* (ver abajo) y vuelve en cuanto se muestra |
| `ctx.storage.get(clave)` / `set(clave, valor)` | Datos JSON propios de la extensión |
| `ctx.secrets.get(clave)` / `set(clave, texto)` | Credenciales propias (p. ej. un token de API), cifradas por la app con `safeStorage`. `set(clave, null)` la borra |
| `ctx.views.refresh(viewId?)` | Vuelve a pintar la vista |

`ctx.dev.start` propone al usuario una rama (`branch`, editable) en uno de los repos del proyecto.
Al aceptar, la app crea un worktree desde la *rama principal* del repo (configurable en su
tarjeta) en `../<repo>-worktrees/<rama>`, instala las dependencias (npm, pnpm, yarn, bun, uv,
poetry o dotnet) y abre Claude Code en modo plan. `context` (Markdown) se guarda en
`.claude-launcher/contexto.md` dentro del worktree, excluido de git, y el prompt inicial le pide a
Claude leerlo y planificar antes de tocar nada. Si la rama ya tiene worktree, se reutiliza.

En Windows `ctx.exec` también lanza scripts `.cmd`/`.bat` (como `az`), pero rechaza argumentos
con `" % ! ^ & | < >` o saltos de línea, que cmd.exe interpretaría.

`console.log` y los errores van al **Registro** de la extensión (pantalla *Extensiones*).

Ejemplos completos: [`github/`](github/index.js), [`azure-devops/`](azure-devops/index.js),
[`bitbucket/`](bitbucket/index.js), [`azure-boards/`](azure-boards/index.js), [`jira/`](jira/index.js) y
[`github-projects/`](github-projects/index.js) (tableros con pestañas de proyecto).
