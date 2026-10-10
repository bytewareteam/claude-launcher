# Extensiones de Claude Launcher

Una extensión es una carpeta con un `package.json` y un archivo JS (CommonJS). Se cargan de:

- `apps/claude-launcher/extensions/` — las que trae la app (activas por defecto).
- `%APPDATA%/claude-launcher/extensions/` — las del usuario (hay que activarlas y aceptar sus permisos).

Tras copiar o editar una extensión, pulsa **Recargar** en la pantalla *Extensiones*.

## Modelo de seguridad

- Cada extensión corre en su propio `utilityProcess`, con el mismo entorno mínimo que la terminal
  (`SYSTEM_VARS` de `src/main/terminal.js`).
- No comparte memoria con el proceso principal: **no ve la bóveda** ni puede hablar con la ventana.
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
      "dialogs": true
    },
    "views": [{ "id": "principal", "title": "Mi vista", "icon": "puzzle" }]
  }
}
```

| Permiso | Desbloquea |
| --- | --- |
| `exec: [...]` | `ctx.exec(cmd, ...)` solo con esos programas |
| `projects` | `ctx.projects.list()` y `ctx.projects.addRepo()` |
| `dialogs` | `ctx.ui.pickFolder()` |

Cada vista aparece en la barra lateral. Iconos disponibles: ver `src/renderer/src/lib/extIcons.js`.

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

## API de `ctx`

| Método | Devuelve |
| --- | --- |
| `ctx.exec(cmd, args, { cwd, timeout, env })` | stdout; error con `.code` (`ENOENT` si no existe). `env` se suma al entorno mínimo |
| `ctx.projects.list()` | `[{ id, name, repos: [{ id, name, path }] }]` |
| `ctx.projects.addRepo(projectId, path)` | Añade el repo git en `path` al proyecto |
| `ctx.ui.quickPick(items, { placeholder })` | `id` elegido o `null`. `items: [{ id, label, description? }]` |
| `ctx.ui.pickFolder({ title, defaultPath })` | Ruta o `null` |
| `ctx.ui.toast(mensaje, 'info' \| 'error')` | — |
| `ctx.ui.openExternal(url)` | Abre un enlace `https://` en el navegador |
| `ctx.storage.get(clave)` / `set(clave, valor)` | Datos JSON propios de la extensión |
| `ctx.views.refresh(viewId?)` | Vuelve a pintar la vista |

En Windows `ctx.exec` también lanza scripts `.cmd`/`.bat` (como `az`), pero rechaza argumentos
con `" % ! ^ & | < >` o saltos de línea, que cmd.exe interpretaría.

`console.log` y los errores van al **Registro** de la extensión (pantalla *Extensiones*).

Ejemplos completos: [`github/`](github/index.js) y [`azure-devops/`](azure-devops/index.js).
