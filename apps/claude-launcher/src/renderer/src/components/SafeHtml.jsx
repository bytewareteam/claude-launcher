import DOMPurify from 'dompurify'
import { toast } from 'sonner'
import { api, errMsg } from '@/lib/api'
import { cn } from '@/lib/utils'

// Lista cerrada: formato de texto, listas, tablas y enlaces. Sin estilos, imágenes, iframes ni
// formularios; DOMPurify además quita los `on*` y las URLs `javascript:`.
const CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'div',
    'span',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'strike',
    'del',
    'sub',
    'sup',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a'
  ],
  ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
  ALLOWED_URI_REGEXP: /^https:\/\//i
}

// Pinta HTML de una extensión (p. ej. la descripción de un work item) tras sanearlo aquí, en el
// renderer: la extensión no puede saltarse el saneado. Los enlaces se abren en el navegador.
export function SafeHtml({ html, className }) {
  const clean = DOMPurify.sanitize(String(html ?? ''), CONFIG)
  const onClick = (e) => {
    const a = e.target.closest('a')
    if (!a) return
    // Nunca navegar dentro de la ventana de la app.
    e.preventDefault()
    e.stopPropagation()
    const href = a.getAttribute('href')
    if (href) api.openUrl(href).catch((err) => toast.error(errMsg(err)))
  }
  return (
    <div
      className={cn('ext-html', className)}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
