@AGENTS.md

## Notas para Claude Code

- Responde al usuario en español.
- Tras cambiar código, ejecuta `npm run build` desde la raíz para comprobar que compila.
- Mensajes de commit en formato Conventional Commits (ver AGENTS.md): deciden la versión de la release.
- Usa la API de `window.api` desde el renderer; nunca importes módulos de Node allí.
