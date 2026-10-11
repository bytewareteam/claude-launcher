// Empaqueta las extensiones y genera el catálogo que consume la app.
//
//   node scripts/extensions.mjs pack <dir>         → <dir>/dist/<name>-<version>.zip
//   node scripts/extensions.mjs catalog <out.json> → índice con la última release de cada una
//   node scripts/extensions.mjs keygen             → par de claves para firmar el catálogo
//
// El catálogo se construye a partir de los .zip ya publicados en GitHub Releases (no del
// código de main), así su sha256 y sus permisos son los de lo que se descarga de verdad.
// Se firma (ed25519) con CATALOG_SIGNING_KEY en <out.json>.sig: la app solo acepta catálogos
// firmados con la clave pública que lleva dentro, no basta con controlar el servidor.
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { strFromU8, unzipSync, zipSync } from 'fflate'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSIONS = join(ROOT, 'extensions')
const REPO = process.env.GITHUB_REPOSITORY || 'bytewareteam/claude-launcher'
// Fecha fija: el mismo código da el mismo .zip (y el mismo sha256).
const MTIME = new Date('2020-01-01T00:00:00Z')
const SKIP = new Set(['dist', 'node_modules', 'CHANGELOG.md'])

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

// Nombre del proyecto Nx: de él sale el tag (`ext-github-v0.2.0`, ver nx.json).
export const tagOf = (pkg) => `${pkg.nx?.name || pkg.name}-v${pkg.version}`
export const assetOf = (pkg) => `${pkg.name}-${pkg.version}.zip`

function files(dir, base = dir, out = {}) {
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (SKIP.has(d.name) || d.name.startsWith('.')) continue
    const path = join(dir, d.name)
    if (d.isDirectory()) files(path, base, out)
    // Saltos de línea LF: el .zip no depende de cómo haya hecho checkout git en Windows.
    else
      out[relative(base, path).replaceAll('\\', '/')] = [
        /\.(js|cjs|mjs|json|md|txt)$/.test(d.name)
          ? new TextEncoder().encode(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'))
          : readFileSync(path),
        { mtime: MTIME }
      ]
  }
  return out
}

function pack(dir) {
  dir = resolve(dir)
  const pkg = readJson(join(dir, 'package.json'))
  if (!pkg.claudeLauncher) throw new Error(`${dir} no es una extensión (falta «claudeLauncher»).`)
  const zip = zipSync(files(dir), { level: 9 })
  const out = join(dir, 'dist', assetOf(pkg))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, zip)
  console.log(`${relative(ROOT, out)} (${zip.length} bytes)`)
}

async function catalog(outFile) {
  const key = process.env.CATALOG_SIGNING_KEY
  if (!key) throw new Error('Falta CATALOG_SIGNING_KEY: el catálogo debe ir firmado.')
  const extensions = []
  for (const name of readdirSync(EXTENSIONS).sort()) {
    const manifestFile = join(EXTENSIONS, name, 'package.json')
    if (!existsSync(manifestFile)) continue
    const pkg = readJson(manifestFile)
    const tag = tagOf(pkg)
    const url = `https://github.com/${REPO}/releases/download/${tag}/${assetOf(pkg)}`
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`${pkg.name}: sin release ${tag} (${res.status}), no entra en el catálogo.`)
      continue
    }
    const zip = new Uint8Array(await res.arrayBuffer())
    const manifest = JSON.parse(
      strFromU8(unzipSync(zip, { filter: (f) => f.name === 'package.json' })['package.json'])
    )
    const cl = manifest.claudeLauncher
    extensions.push({
      name: manifest.name,
      displayName: manifest.displayName || manifest.name,
      description: manifest.description || '',
      version: manifest.version,
      apiVersion: cl.apiVersion,
      permissions: cl.permissions || {},
      url,
      sha256: createHash('sha256').update(zip).digest('hex'),
      size: zip.length,
      releaseUrl: `https://github.com/${REPO}/releases/tag/${tag}`
    })
    console.log(`${manifest.name} ${manifest.version}`)
  }
  mkdirSync(dirname(resolve(outFile)), { recursive: true })
  // generatedAt va dentro de lo firmado: la app rechaza catálogos más antiguos que el último
  // que aceptó, así no se puede volver a servir uno viejo con su firma válida.
  const body = Buffer.from(
    JSON.stringify({ schemaVersion: 1, generatedAt: Date.now(), extensions }, null, 2) + '\n'
  )
  writeFileSync(outFile, body)
  writeFileSync(`${outFile}.sig`, sign(null, body, createPrivateKey(key)).toString('base64'))
}

// La privada va al secret CATALOG_SIGNING_KEY; la pública, a CATALOG_PUBLIC_KEY en
// apps/claude-launcher/src/main/extension-packages.js.
function keygen() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }))
  console.log(
    `Clave pública: ${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`
  )
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'pack' && arg) pack(arg)
else if (cmd === 'catalog' && arg) await catalog(arg)
else if (cmd === 'keygen') keygen()
else {
  console.error('Uso: node scripts/extensions.mjs pack <dir> | catalog <out.json> | keygen')
  process.exit(1)
}
