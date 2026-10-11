// Fuente única de los design tokens. `pnpm build` genera tokens.css y theme.css a partir
// de este objeto: edita aquí y regenera, nunca los .css a mano.

// Solo tema oscuro; primario con el naranja de Claude.
export const tokens = {
  colors: {
    background: 'oklch(0.18 0.006 265)',
    foreground: 'oklch(0.94 0.003 265)',
    card: 'oklch(0.215 0.007 265)',
    'card-foreground': 'oklch(0.94 0.003 265)',
    popover: 'oklch(0.215 0.007 265)',
    'popover-foreground': 'oklch(0.94 0.003 265)',
    primary: 'oklch(0.68 0.13 40)',
    'primary-foreground': 'oklch(0.18 0.02 40)',
    secondary: 'oklch(0.26 0.008 265)',
    'secondary-foreground': 'oklch(0.94 0.003 265)',
    muted: 'oklch(0.26 0.008 265)',
    'muted-foreground': 'oklch(0.66 0.012 265)',
    accent: 'oklch(0.27 0.008 265)',
    'accent-foreground': 'oklch(0.94 0.003 265)',
    destructive: 'oklch(0.65 0.2 25)',
    // Estados (p. ej. paneles de extensiones): completado, en riesgo, en curso.
    success: 'oklch(0.72 0.15 150)',
    warning: 'oklch(0.8 0.14 85)',
    info: 'oklch(0.7 0.12 240)',
    border: 'oklch(1 0 0 / 10%)',
    input: 'oklch(1 0 0 / 14%)',
    ring: 'oklch(0.68 0.13 40)',
    sidebar: 'oklch(0.205 0.007 265)',
    'sidebar-foreground': 'oklch(0.94 0.003 265)',
    'sidebar-accent': 'oklch(0.26 0.008 265)',
    'sidebar-border': 'oklch(1 0 0 / 10%)'
  },
  // Radio base; el @theme deriva sm/md/lg/xl multiplicándolo.
  radius: '0.625rem',
  fonts: {
    sans: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    mono: '"Cascadia Code", Consolas, monospace'
  }
}

export default tokens
