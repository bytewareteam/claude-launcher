# @claude-launcher/design-tokens

Identidad visual compartida entre la app Electron (`apps/claude-launcher`) y la web: colores (oklch), radio, fuentes y logo.

## Uso

Con Tailwind v4 (después de `@import 'tailwindcss';`):

```css
@import 'tailwindcss';
@import '@claude-launcher/design-tokens/theme.css';
```

| Export | Contenido |
| --- | --- |
| `@claude-launcher/design-tokens/tokens.css` | Solo `:root { … }` con las variables (`--primary`, `--radius`, `--font-family-sans`…). |
| `@claude-launcher/design-tokens/theme.css` | Importa `tokens.css`, define `@custom-variant dark` y el `@theme inline` (`bg-primary`, `rounded-lg`, `font-sans`…). |
| `@claude-launcher/design-tokens/tokens.js` | Objeto `tokens` (export nombrado y por defecto) con `colors`, `radius` y `fonts`. |
| `@claude-launcher/design-tokens/logo.svg` | Logo de la aplicación. |

## Modificar tokens

La única fuente es `tokens.js`. Tras editarlo, regenera los CSS y versiónalos junto al cambio:

```bash
pnpm nx run design-tokens:build
```

`tokens.css` y `theme.css` se generan pero se guardan en git, para que `pnpm dev` funcione sin compilar antes el paquete. Nx también los regenera antes de compilar cualquier proyecto que dependa de él (`dependsOn: ["^build"]`).
