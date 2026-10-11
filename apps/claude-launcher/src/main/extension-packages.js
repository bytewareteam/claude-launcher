// Paquetes de extensiones: catálogo remoto, descarga verificada y extracción segura de .zip.
// Los .zip los genera `scripts/extensions.mjs` y se publican en GitHub Releases; el catálogo
// (extensions.json) lo publica el workflow Pages.
import { createHash, createPublicKey, verify } from 'crypto'
import { app, net } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, resolve, sep } from 'path'
import { unzipSync } from 'fflate'

// Se puede apuntar a otro catálogo (p. ej. un archivo local) para probar sin publicar.
const CATALOG_URL =
  process.env.CLAUDE_LAUNCHER_CATALOG ||
  'https://bytewareteam.github.io/claude-launcher/extensions.json'
// Clave pública ed25519 (SPKI en base64) con la que el workflow Pages firma el catálogo
// (`node scripts/extensions.mjs keygen`). El sha256 de cada paquete viene en el catálogo, así
// que sin esta firma quien controle el servidor controlaría también lo que se instala.
const CATALOG_PUBLIC_KEY = 'MCowBQYDK2VwAyEAvRReRhX8IWz/yJhp+9s/J423bQi/RimMMpYHVeEXEcE='
const CATALOG_TTL = 5 * 60_000
const MAX_ZIP = 20 * 1024 * 1024
const MAX_UNZIPPED = 100 * 1024 * 1024

let cache // { at, catalog }

async function fetchBytes(url) {
  if (!/^https:\/\//i.test(url)) return new Uint8Array(readFileSync(url))
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

// Solo en desarrollo y con un catálogo propio se admite uno sin firma (para probar sin la clave).
const unsignedAllowed = () => !!process.env.CLAUDE_LAUNCHER_CATALOG && !app.isPackaged

// Devuelve la firma del catálogo o null si no hay y se admite sin firma.
async function fetchSignature() {
  try {
    return Buffer.from(new TextDecoder().decode(await fetchBytes(`${CATALOG_URL}.sig`)), 'base64')
  } catch (err) {
    if (unsignedAllowed()) return null
    throw err
  }
}

// { generatedAt, signed, entries }. `generatedAt` va firmado: extensions.js lo compara con el
// último aceptado para no volver a un catálogo anterior.
export async function fetchCatalog(force = false) {
  if (!force && cache && Date.now() - cache.at < CATALOG_TTL) return cache.catalog
  let bytes, sig
  try {
    ;[bytes, sig] = await Promise.all([fetchBytes(CATALOG_URL), fetchSignature()])
  } catch (err) {
    throw new Error(`No se pudo leer el catálogo de extensiones: ${err.message}`)
  }
  const key = createPublicKey({
    key: Buffer.from(CATALOG_PUBLIC_KEY, 'base64'),
    format: 'der',
    type: 'spki'
  })
  if (sig && !verify(null, bytes, key, sig))
    throw new Error('La firma del catálogo de extensiones no es válida.')
  let data
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch (err) {
    throw new Error(`No se pudo leer el catálogo de extensiones: ${err.message}`)
  }
  if (data.schemaVersion !== 1 || !Array.isArray(data.extensions))
    throw new Error('Formato de catálogo no soportado.')
  if (sig && !Number.isFinite(data.generatedAt))
    throw new Error('El catálogo de extensiones no indica su fecha.')
  const catalog = { generatedAt: data.generatedAt, signed: !!sig, entries: data.extensions }
  cache = { at: Date.now(), catalog }
  return catalog
}

// Descarga el .zip de una entrada del catálogo y comprueba que es exactamente el publicado.
export async function download(entry) {
  if (!/^https:\/\//i.test(entry.url) && !process.env.CLAUDE_LAUNCHER_CATALOG)
    throw new Error('El catálogo solo puede apuntar a https.')
  const zip = await fetchBytes(entry.url)
  if (zip.length > MAX_ZIP) throw new Error('El paquete es demasiado grande.')
  const sha = createHash('sha256').update(zip).digest('hex')
  if (sha !== entry.sha256)
    throw new Error(`El paquete de «${entry.name}» no coincide con el catálogo (sha256).`)
  return zip
}

export function readZip(path) {
  const zip = new Uint8Array(readFileSync(path))
  if (zip.length > MAX_ZIP) throw new Error('El paquete es demasiado grande.')
  return zip
}

// Extrae en `dest` sin dejar que una entrada escriba fuera (zip-slip) ni que un .zip
// pequeño se infle sin límite. Si todo va dentro de una carpeta, la quita.
export function extract(zip, dest) {
  let total = 0
  let files
  try {
    files = unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize
        if (total > MAX_UNZIPPED) throw new Error('El paquete descomprimido es demasiado grande.')
        return !f.name.endsWith('/')
      }
    })
  } catch (err) {
    throw new Error(`No es un .zip válido: ${err.message}`)
  }
  const names = Object.keys(files)
  const tops = new Set(names.map((n) => n.split('/')[0]))
  const strip =
    !files['package.json'] && tops.size === 1 && files[`${[...tops][0]}/package.json`]
      ? [...tops][0].length + 1
      : 0
  if (!strip && !files['package.json']) throw new Error('El paquete no tiene package.json.')
  const root = resolve(dest)
  for (const name of names) {
    const rel = name.slice(strip)
    const target = resolve(root, rel)
    if (!rel || isAbsolute(rel) || !target.startsWith(root + sep))
      throw new Error(`Ruta no permitida en el paquete: ${name}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, files[name])
  }
}

// Compara versiones x.y.z (sin prerelease): >0 si a es mayor.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}
