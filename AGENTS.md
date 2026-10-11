# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Cursor…) que trabajen en este repositorio.

## Qué es

Claude Launcher es una app de escritorio **Electron** (solo Windows por ahora) que:

- Registra **proyectos** y sus **repositorios git**.
- Lista los **worktrees** de cada repo y su estado frente a una rama base.
- Guarda **variables de entorno secretas** por proyecto/repo en una bóveda **KeePass (.kdbx)**.
- Abre **Claude Code** en una pestaña de Windows Terminal con solo esas variables inyectadas.
- Ofrece un **servidor MCP** local para que las sesiones de Claude Code consulten proyectos y worktrees y pidan acciones a la app.

## Monorepo

Monorepo con **Nx** + **npm workspaces**. Instala siempre desde la raíz.

```
apps/claude-launcher/   La app Electron (proyecto Nx `claude-launcher`).
apps/web/               Página web en Astro + Tailwind v4 (proyecto Nx `web`), publicada en GitHub Pages.
extensions/             Extensiones de la app, una por carpeta (proyectos Nx `ext-<nombre>`, versión propia).
packages/               Librerías compartidas.
  design-tokens/        `@claude-launcher/design-tokens`: colores, radios, fuentes y logo comunes a app y web (fuente: `tokens.js`; `build` genera los .css).
nx.json                 Targets por defecto y configuración de Nx Release.
```

Nx infiere los targets de los scripts de cada `package.json`. Para añadir una librería: crea `packages/<nombre>/package.json` y dependela desde la app con `"<nombre>": "*"`.

## Comandos (desde la raíz)

```bash
npm install                              # instala todo el workspace
npm run dev                              # app en modo desarrollo (HMR en el renderer)
npm run build                            # compila todos los proyectos
npx nx run claude-launcher:package       # .exe portable en apps/claude-launcher/dist/
npx nx run claude-launcher:package:all   # instalador NSIS + portable
npx nx run ext-<nombre>:package          # .zip de una extensión en extensions/<nombre>/dist/
npx nx release --skip-publish --dry-run  # simula la próxima release
npx nx run web:dev                       # web en local (http://localhost:4321/claude-launcher/)
```

No hay tests ni linter configurados. Para verificar un cambio: `npm run build` debe terminar sin errores y la app debe arrancar con `npm run dev`.

`electron` está fijado a una versión exacta en `apps/claude-launcher/package.json`: electron-builder lo exige porque npm lo instala en el `node_modules` de la raíz.

## Commits y releases

Los commits siguen **[Conventional Commits](https://www.conventionalcommits.org/es/)**; de ellos depende la versión:

| Commit | Release |
| --- | --- |
| `fix: …` | patch (0.2.0 → 0.2.1) |
| `feat: …` | minor (0.2.0 → 0.3.0) |
| `feat!: …` o `BREAKING CHANGE:` en el cuerpo | major (0.2.0 → 1.0.0) |
| `chore:`, `docs:`, `refactor:`, `build:`, `ci:`… | sin release |

### Flujo de ramas

`main` solo contiene versiones publicadas: cada merge a `main` es una release. No hagas push ni PRs de features directos a `main`.

1. Planifica la versión: crea `release/<major>.<minor>` desde `main` (`git switch -c release/1.5 main && git push -u origin release/1.5`).
2. Cada característica en su rama (`feat/…`, `fix/…`) desde `release/1.5` → PR a `release/1.5`. Aquí sí vale squash, con un título en Conventional Commits.
3. Cuando sea estable, PR `release/1.5` → `main` con **merge commit**, nunca squash: Nx calcula la versión y el changelog a partir de cada commit; un squash los reduce a uno.
4. La siguiente rama de release se crea desde `main` actualizado, que ya lleva el commit `chore(release)` y los tags.

Antes del PR a `main`, comprueba qué saldría desde la rama de release: `npx nx release --skip-publish --dry-run`.

**Un worktree por tarea.** No cambies de rama ni edites en la copia principal del repo: cada tarea se trabaja en su propio `git worktree`, así varias tareas (o agentes) no se pisan los cambios.

```bash
git fetch origin
git worktree add ../claude-launcher-worktrees/<rama> -b <rama> origin/release/1.5
cd ../claude-launcher-worktrees/<rama> && npm install
# … trabajo, commits, push y PR a release/1.5 …
git worktree remove ../claude-launcher-worktrees/<rama>   # cuando se fusione la PR
```

En cada push a `main`, `.github/workflows/release.yml` ejecuta `nx release` con dos grupos (`nx.json`):

- **app**: sube la versión de `apps/claude-launcher/package.json`, actualiza `CHANGELOG.md`, crea el tag `vX.Y.Z` y la release de GitHub con el `.exe` portable adjunto.
- **extensions** (independiente): cada `extensions/<nombre>` con commits nuevos sube su versión y su `CHANGELOG.md`, y crea el tag `ext-<nombre>-vX.Y.Z` con el `.zip` adjunto. La app sigue siendo la release *Latest*.

Después, `.github/workflows/pages.yml` regenera el catálogo `extensions.json` que lee la app. Usa un scope en los commits de extensiones (`feat(github): …`). No edites versiones ni changelogs a mano.

## Web (`apps/web`)

- Astro estático con `base: '/claude-launcher'`: los enlaces internos usan `import.meta.env.BASE_URL`.
- Estilos desde `@claude-launcher/design-tokens/theme.css`: no definas colores ni radios propios; si hace falta uno nuevo, añádelo a `packages/design-tokens/tokens.js` para que lo compartan app y web.
- `.github/workflows/pages.yml` la publica en https://bytewareteam.github.io/claude-launcher/ en cada push a `main` que toque `apps/web/` o `packages/design-tokens/`.
- `cookie@^2` es dependencia directa de la web a propósito: sin ella npm iza la `cookie@0.7` de express (vía shadcn) y el build de Astro falla.

## Arquitectura de la app

Rutas relativas a `apps/claude-launcher/`:

```
src/
  main/        Proceso principal (Node). Toda la E/S: disco, git, bóveda, terminal.
    index.js     Ventana, persistencia (electron-store) y handlers IPC.
    git.js       Wrappers de `git` (worktrees, ramas remotas, estado).
    vault.js     Bóveda KeePass (kdbxweb + Argon2 vía hash-wasm). Autobloqueo configurable (15 min por defecto).
    terminal.js  Lanza `wt.exe … claude` con un entorno filtrado.
    dev.js       «Iniciar desarrollo»: ruta del worktree, instalación de dependencias y contexto para Claude.
    mcp.js       Servidor MCP (Streamable HTTP, sin sesiones) en 127.0.0.1 con token; sus herramientas usan `mcpApp` de index.js.
    extensions.js       Instala/desinstala extensiones, guarda su consentimiento y las arranca.
    extension-packages.js  Catálogo remoto, descarga verificada (sha256) y extracción segura de .zip.
    extension-host.js   Corre dentro del utilityProcess de cada extensión (entrada aparte de Vite).
  preload/     Expone `window.api` (contextBridge) → un `ipcRenderer.invoke` por canal.
  renderer/    React 19 + Tailwind v4 + shadcn/ui (estilo new-york, JSX).
    src/lib/queries.js   Hooks de TanStack Query sobre `window.api`.
    src/components/ui/   Componentes shadcn generados: no editarlos a mano salvo necesidad.
```

Flujo de datos: componente → hook de `queries.js` → `window.api.*` → `ipcMain.handle(...)` en `main/index.js`.

Para añadir una operación nueva:
1. Handler `ipcMain.handle('canal', …)` en `src/main/index.js`.
2. Entrada en `src/preload/index.js`.
3. Hook o `useAction(api.x)` en el renderer.

Las mutaciones invalidan **todas** las queries al terminar y muestran los errores como toast (`src/renderer/src/main.jsx`); no hace falta gestionarlo en cada componente.

## Extensiones

Cada extensión corre en su propio `utilityProcess` y su UI es JSON que pinta `ExtensionView.jsx`.
Lo que pueden pedir a la app está en `hostApi` (`src/main/index.js`) y sus permisos en
`METHOD_PERMISSION` (`src/main/extensions.js`). Para ampliar la API: añade el método a `hostApi`,
su permiso si toca, la función en `ctx` (`extension-host.js`) y documéntalo en `extensions/README.md`.
Nunca expongas la bóveda a las extensiones.

La app no trae extensiones: se instalan del catálogo o de un `.zip` (ver `extensions/README.md`) y
solo se activan tras aceptar sus permisos. En desarrollo carga también las de `extensions/`.

## Convenciones

- **Idioma**: UI, comentarios y mensajes de error en **español**.
- JavaScript (sin TypeScript). Alias `@/` → `src/renderer/src`.
- Prettier: ver `.prettierrc.yaml` (sin `;`, comillas simples, 100 columnas). `vault.js` usa `;`: respeta el estilo del archivo que edites.
- Comentarios breves que expliquen el *porqué*, no el *qué*.
- Componentes nuevos de shadcn: `npx shadcn@latest add <componente>`.

## Seguridad (no romper)

- Los secretos **nunca** salen del proceso principal salvo por `vault:get`/`vault:copy` a petición del usuario.
- `terminal.js` solo hereda una lista blanca de variables del sistema (`SYSTEM_VARS`). No la amplíes sin motivo.
- Nunca resuelvas un ejecutable desde la carpeta de un repo: usa `resolveBin` (ruta absoluta, la de Configuración o la del PATH del sistema) y `NO_CWD_EXE` cuando haya `cmd.exe` de por medio (`which.js`). Un programa nuevo se añade a `BINARIES`.
- Los secretos se pasan por **entorno**, nunca por argumentos de línea de comandos.
- El portapapeles se limpia tras copiar un secreto (30 s por defecto, 5–300 s en Configuración).
- No añadas `nodeIntegration` ni desactives `contextIsolation`.
- Las extensiones no reciben secretos de la bóveda ni código propio en el renderer (UI declarativa). Con el permiso `secrets` solo guardan y leen sus propias credenciales, cifradas con `safeStorage` (`extensionSecrets` en `data.json`). Esos datos solo se conservan al actualizar desde el catálogo; instalar un `.zip` encima los borra.
- El catálogo de extensiones va firmado (ed25519) y la app solo lo acepta con su clave pública (`CATALOG_PUBLIC_KEY`) y si no es anterior al último recibido. No quites esa comprobación.
- El servidor MCP solo escucha en `127.0.0.1`, exige el token (`Authorization: Bearer`), rechaza peticiones con `Origin` y nunca expone la bóveda: no añadas herramientas que devuelvan secretos ni nombres de variables.

## Datos del usuario

Se guardan en `%APPDATA%/claude-launcher/`:
- `data.json` — proyectos, repos e historial de sesiones (electron-store).
- `secrets.kdbx` — bóveda por defecto (la ruta se puede cambiar a un .kdbx existente).
- `mcp.json` — configuración MCP (URL y token) que reciben las sesiones abiertas desde la app con `--mcp-config`.

No escribas fixtures ni datos reales en el repositorio.
