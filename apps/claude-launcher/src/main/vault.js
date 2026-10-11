// Bóveda de secretos en un archivo KeePass (.kdbx), compatible con KeePassXC.
// Estructura: grupo raíz "Claude Launcher" > grupo por proyecto > grupo por repo.
// Cada variable de entorno es una entrada: Title = nombre, Password = valor.
// Los secretos generales van en "Claude Launcher" > "General" > un grupo por categoría.
import fs from 'fs';
import path from 'path';
import { Kdbx, Credentials, ProtectedValue, CryptoEngine, Consts, VarDictionary, Int64 } from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';
import { isProtectedVar } from './terminal';

CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
  const fn = type === 2 ? argon2id : argon2d; // 0 = Argon2d, 2 = Argon2id
  const out = await fn({
    password: new Uint8Array(password),
    salt: new Uint8Array(salt),
    memorySize: memory,
    iterations,
    hashLength: length,
    parallelism,
    outputType: 'binary',
  });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
});

const ROOT_NAME = 'Claude Launcher';
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Las entradas pueden crearse o editarse fuera de la app (KeePassXC): se valida al guardar y al
// inyectar.
const usableKey = (key) => ENV_KEY.test(key) && !isProtectedVar(key);

let db = null;
let dbPath = null;
let lockTimer = null;
let onLock = () => {};
let autoLockMs = 15 * 60 * 1000;

function touch() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lock({ auto: true }), autoLockMs);
}

function requireUnlocked() {
  if (!db) throw new Error('La bóveda está bloqueada.');
  touch();
  return db;
}

async function save() {
  const buf = Buffer.from(await db.save());
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dbPath);
}

export function status(filePath) {
  return { path: filePath, exists: fs.existsSync(filePath), unlocked: !!db && dbPath === filePath };
}

export async function create(filePath, password) {
  if (fs.existsSync(filePath)) throw new Error('Ya existe un archivo en esa ruta.');
  const creds = new Credentials(ProtectedValue.fromString(password));
  const newDb = Kdbx.create(creds, ROOT_NAME);
  newDb.setKdf(Consts.KdfId.Argon2id);
  const p = newDb.header.kdfParameters;
  p.set('M', VarDictionary.ValueType.UInt64, Int64.from(64 * 1024 * 1024));
  p.set('I', VarDictionary.ValueType.UInt64, Int64.from(3));
  p.set('P', VarDictionary.ValueType.UInt32, 2);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = newDb;
  dbPath = filePath;
  await save();
  touch();
}

export async function unlock(filePath, password) {
  const data = fs.readFileSync(filePath);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  try {
    db = await Kdbx.load(ab, new Credentials(ProtectedValue.fromString(password)));
  } catch (err) {
    if (err.code === 'InvalidKey') throw new Error('Contraseña incorrecta.');
    throw err;
  }
  dbPath = filePath;
  touch();
}

export function lock({ auto = false } = {}) {
  clearTimeout(lockTimer);
  const wasUnlocked = !!db;
  db = null;
  dbPath = null;
  if (wasUnlocked && auto) onLock();
}

// --- Grupos -----------------------------------------------------------------

function findChild(parent, name) {
  return parent.groups.find((g) => g.name === name);
}

function rootGroup() {
  const top = db.getDefaultGroup();
  return findChild(top, ROOT_NAME) || db.createGroup(top, ROOT_NAME);
}

// Devuelve (creándolo si hace falta) el grupo de un scope.
// scope = { projectId, projectName, repoId?, repoName? }
function scopeGroup(scope, createIfMissing) {
  const root = rootGroup();
  const tag = (g, id) => g.customData?.get('claudeLauncherId')?.value === id;
  const byId = (parent, id) => parent.groups.find((g) => tag(g, id));
  const make = (parent, name, id) => {
    const g = db.createGroup(parent, name);
    g.customData = g.customData || new Map();
    g.customData.set('claudeLauncherId', { value: id });
    return g;
  };

  let group = byId(root, scope.projectId);
  if (!group) {
    if (!createIfMissing) return null;
    group = make(root, scope.projectName, scope.projectId);
  }
  group.name = scope.projectName; // Sigue los renombrados del proyecto.
  if (!scope.repoId) return group;
  let repoGroup = byId(group, scope.repoId);
  if (!repoGroup) {
    if (!createIfMissing) return null;
    repoGroup = make(group, scope.repoName, scope.repoId);
  }
  return repoGroup;
}

const fieldText = (entry, name) => {
  const v = entry.fields.get(name);
  return v instanceof ProtectedValue ? v.getText() : v || '';
};

// --- Variables ----------------------------------------------------------------

export function listVars(scope) {
  if (!db) return [];
  touch();
  const group = scopeGroup(scope, false);
  if (!group) return [];
  return group.entries
    .map((e) => {
      const key = fieldText(e, 'Title');
      return { id: e.uuid.id, key, ignored: !usableKey(key) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function findEntry(scope, id) {
  const group = scopeGroup(scope, false);
  return group?.entries.find((e) => e.uuid.id === id);
}

export function getValue(scope, id) {
  requireUnlocked();
  const entry = findEntry(scope, id);
  if (!entry) throw new Error('Variable no encontrada.');
  return fieldText(entry, 'Password');
}

export async function setVars(scope, vars) {
  requireUnlocked();
  for (const { key } of vars) {
    if (!ENV_KEY.test(key)) throw new Error(`Nombre de variable no válido: ${key}`);
    if (isProtectedVar(key)) {
      throw new Error(`${key} es una variable reservada del sistema: no se puede guardar en la bóveda.`);
    }
  }
  const group = scopeGroup(scope, true);
  for (const { key, value } of vars) {
    let entry = group.entries.find((e) => fieldText(e, 'Title') === key);
    if (entry) entry.pushHistory();
    else entry = db.createEntry(group);
    entry.fields.set('Title', key);
    entry.fields.set('Password', ProtectedValue.fromString(value));
    entry.fields.set('Notes', 'Variable de entorno gestionada por Claude Launcher');
    entry.times.update();
  }
  await save();
}

export async function deleteVar(scope, id) {
  requireUnlocked();
  const entry = findEntry(scope, id);
  if (!entry) return;
  db.remove(entry); // Va a la papelera de KeePass.
  await save();
}

// Variables del proyecto + del repo (las del repo tienen prioridad).
export function envFor(projectScope, repoScope) {
  requireUnlocked();
  const env = {};
  for (const scope of [projectScope, repoScope].filter(Boolean)) {
    const group = scopeGroup(scope, false);
    for (const e of group?.entries || []) {
      const key = fieldText(e, 'Title');
      if (usableKey(key)) env[key] = fieldText(e, 'Password');
      else console.warn(`Variable de la bóveda ignorada: ${JSON.stringify(key)}`);
    }
  }
  return env;
}

// --- Secretos generales -------------------------------------------------------
// Contraseñas, credenciales, llaves SSH… que no son variables de entorno: nunca se inyectan en
// Claude. Viven en "Claude Launcher" > "General" > un grupo por categoría.

const FIELDS = {
  title: { name: 'Title' },
  username: { name: 'UserName' },
  url: { name: 'URL' },
  notes: { name: 'Notes' },
  password: { name: 'Password', secret: true },
  publicKey: { name: 'Clave pública' },
  privateKey: { name: 'Clave privada', secret: true },
};

const CATEGORIES = {
  passwords: { name: 'Contraseñas', fields: ['title', 'username', 'password', 'url', 'notes'] },
  system: { name: 'Credenciales de sistema', fields: ['title', 'username', 'password', 'url', 'notes'] },
  ssh: { name: 'Llaves SSH', fields: ['title', 'username', 'privateKey', 'password', 'publicKey', 'notes'] },
  personal: { name: 'Secretos personales', fields: ['title', 'password', 'notes'] },
};

function categoryFields(category) {
  const def = CATEGORIES[category];
  if (!def) throw new Error('Categoría no válida.');
  return def.fields;
}

// Reutiliza la estructura proyecto > repo con ids que no chocan con los de los proyectos (UUID).
function categoryGroup(category, createIfMissing) {
  categoryFields(category);
  const scope = { projectId: 'general', projectName: 'General' };
  return scopeGroup(
    { ...scope, repoId: `general:${category}`, repoName: CATEGORIES[category].name },
    createIfMissing
  );
}

function generalEntry(category, id) {
  const entry = categoryGroup(category, false)?.entries.find((e) => e.uuid.id === id);
  if (!entry) throw new Error('Secreto no encontrado.');
  return entry;
}

// Devuelve los campos visibles; de los secretos, solo cuáles tienen valor.
export function listGeneral(category) {
  const fields = categoryFields(category);
  if (!db) return [];
  touch();
  const group = categoryGroup(category, false);
  return (group?.entries || [])
    .map((e) => {
      const item = { id: e.uuid.id, updated: e.times.lastModTime?.toISOString(), secrets: [] };
      for (const f of fields) {
        const text = fieldText(e, FIELDS[f].name);
        if (!FIELDS[f].secret) item[f] = text;
        else if (text) item.secrets.push(f);
      }
      return item;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getGeneral(category, id, field) {
  requireUnlocked();
  if (!categoryFields(category).includes(field)) throw new Error('Campo no válido.');
  return fieldText(generalEntry(category, id), FIELDS[field].name);
}

// Crea (sin id) o edita una entrada. Un secreto vacío conserva el valor anterior: así el
// formulario de edición no necesita recibir los secretos.
export async function setGeneral(category, id, values) {
  const fields = categoryFields(category);
  requireUnlocked();
  if (!String(values?.title ?? '').trim()) throw new Error('El nombre es obligatorio.');
  let entry;
  if (id) {
    entry = generalEntry(category, id);
    entry.pushHistory();
  } else {
    entry = db.createEntry(categoryGroup(category, true));
  }
  for (const f of fields) {
    const value = values[f];
    if (typeof value !== 'string') continue;
    const { name, secret } = FIELDS[f];
    if (!secret) entry.fields.set(name, f === 'title' ? value.trim() : value);
    else if (value) entry.fields.set(name, ProtectedValue.fromString(value));
  }
  entry.times.update();
  await save();
  return entry.uuid.id;
}

export async function deleteGeneral(category, id) {
  requireUnlocked();
  db.remove(generalEntry(category, id)); // Va a la papelera de KeePass.
  await save();
}

export const isUnlocked = () => !!db;
export const setOnLock = (fn) => (onLock = fn);

// Cambia el autobloqueo; si está abierta, el nuevo plazo cuenta desde ahora.
export function setAutoLockMinutes(minutes) {
  autoLockMs = minutes * 60 * 1000;
  if (db) touch();
}
