// Genera tokens.css y theme.css a partir de tokens.js. Sin dependencias: solo Node.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tokens } from '../tokens.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const header = '/* Generado por scripts/build.js a partir de tokens.js: no editar a mano. */\n'

// shadcn referencia este color aunque el tema no lo define; se mantiene el mapeo heredado.
const extraColors = ['destructive-foreground']

const tokensCss = `${header}
:root {
  --radius: ${tokens.radius};
${Object.entries(tokens.colors)
  .map(([name, value]) => `  --${name}: ${value};`)
  .join('\n')}
  --font-family-sans: ${tokens.fonts.sans};
  --font-family-mono: ${tokens.fonts.mono};
}
`

const colorNames = [...Object.keys(tokens.colors), ...extraColors]

const themeCss = `${header}
@import './tokens.css';

@custom-variant dark (&:is(.dark *));

@theme inline {
${colorNames.map((name) => `  --color-${name}: var(--${name});`).join('\n')}
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --font-sans: var(--font-family-sans);
  --font-mono: var(--font-family-mono);
}
`

writeFileSync(`${root}tokens.css`, tokensCss)
writeFileSync(`${root}theme.css`, themeCss)
console.log('design-tokens: tokens.css y theme.css generados')
