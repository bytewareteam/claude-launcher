# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Cursor…) que trabajen en este repositorio.

## Qué es

Claude Launcher es una app de escritorio **Electron** (solo Windows por ahora) que:

- Registra **proyectos** y sus **repositorios git**.
- Lista los **worktrees** de cada repo y su estado frente a una rama base.
- Guarda **variables de entorno secretas** por proyecto/repo en una bóveda **KeePass (.kdbx)**.
- Abre **Claude Code** en una pestaña de Windows Terminal con solo esas variables inyectadas.

## Monorepo

Monorepo con **Nx** + **npm workspaces**. Instala siempre desde la raíz.

```
apps/claude-launcher/   La app Electron (proyecto Nx `claude-launcher`).
packages/               Librerías compartidas (vacío por ahora).
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
npx nx release --skip-publish --dry-run  # simula la próxima release
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

En cada push a `main`, `.github/workflows/release.yml` ejecuta `nx release`: sube la versión de `apps/claude-launcher/package.json`, actualiza `CHANGELOG.md`, crea el tag `vX.Y.Z` y la release de GitHub con el `.exe` portable adjunto. No edites la versión ni el changelog a mano.

## Arquitectura de la app

Rutas relativas a `apps/claude-launcher/`:

```
src/
  main/        Proceso principal (Node). Toda la E/S: disco, git, bóveda, terminal.
    index.js     Ventana, persistencia (electron-store) y handlers IPC.
    git.js       Wrappers de `git` (worktrees, ramas remotas, estado).
    vault.js     Bóveda KeePass (kdbxweb + Argon2 vía hash-wasm). Autobloqueo a los 15 min.
    terminal.js  Lanza `wt.exe … claude` con un entorno filtrado.
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

## Convenciones

- **Idioma**: UI, comentarios y mensajes de error en **español**.
- JavaScript (sin TypeScript). Alias `@/` → `src/renderer/src`.
- Prettier: ver `.prettierrc.yaml` (sin `;`, comillas simples, 100 columnas). `vault.js` usa `;`: respeta el estilo del archivo que edites.
- Comentarios breves que expliquen el *porqué*, no el *qué*.
- Componentes nuevos de shadcn: `npx shadcn@latest add <componente>`.

## Seguridad (no romper)

- Los secretos **nunca** salen del proceso principal salvo por `vault:get`/`vault:copy` a petición del usuario.
- `terminal.js` solo hereda una lista blanca de variables del sistema (`SYSTEM_VARS`). No la amplíes sin motivo.
- Los secretos se pasan por **entorno**, nunca por argumentos de línea de comandos.
- El portapapeles se limpia a los 30 s tras copiar un secreto.
- No añadas `nodeIntegration` ni desactives `contextIsolation`.

## Datos del usuario

Se guardan en `%APPDATA%/claude-launcher/`:
- `data.json` — proyectos, repos e historial de sesiones (electron-store).
- `secrets.kdbx` — bóveda por defecto (la ruta se puede cambiar a un .kdbx existente).

No escribas fixtures ni datos reales en el repositorio.
