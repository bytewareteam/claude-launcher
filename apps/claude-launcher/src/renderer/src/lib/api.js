// Puente IPC expuesto por src/preload/index.js.
export const api = window.api

export const errMsg = (err) =>
  String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
