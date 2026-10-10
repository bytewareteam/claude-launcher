import { contextBridge, ipcRenderer } from 'electron'

const on = (channel) => (fn) => {
  const listener = (_e, ...args) => fn(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  projects: invoke('projects:list'),
  addProject: invoke('project:add'),
  renameProject: invoke('project:rename'),
  removeProject: invoke('project:remove'),
  pickRepo: invoke('repo:pick'),
  addRepo: invoke('repo:add'),
  removeRepo: invoke('repo:remove'),
  worktrees: invoke('repo:worktrees'),
  remoteBranches: invoke('repo:remoteBranches'),
  setBaseBranch: invoke('repo:setBase'),
  worktreeStatus: invoke('worktree:status'),
  removeWorktree: invoke('worktree:remove'),
  openClaude: invoke('open:claude'),
  openFolder: invoke('open:folder'),
  openWeb: invoke('open:web'),
  dashboard: invoke('dashboard'),
  vault: {
    status: invoke('vault:status'),
    create: invoke('vault:create'),
    unlock: invoke('vault:unlock'),
    lock: invoke('vault:lock'),
    useExisting: invoke('vault:useExisting'),
    list: invoke('vault:list'),
    get: invoke('vault:get'),
    set: invoke('vault:set'),
    remove: invoke('vault:delete'),
    copy: invoke('vault:copy'),
    importEnv: invoke('vault:importEnv'),
    onLocked: on('vault:locked')
  },
  extensions: {
    list: invoke('ext:list'),
    setEnabled: invoke('ext:setEnabled'),
    reload: invoke('ext:reload'),
    log: invoke('ext:log'),
    openFolder: invoke('ext:openFolder'),
    catalog: invoke('ext:catalog'),
    install: invoke('ext:install'),
    uninstall: invoke('ext:uninstall'),
    pickZip: invoke('ext:pickZip'),
    installStaged: invoke('ext:installStaged'),
    discardStaged: invoke('ext:discardStaged'),
    render: invoke('ext:render'),
    action: invoke('ext:action'),
    reply: invoke('ext:reply'),
    onChanged: on('ext:changed'),
    onToast: on('ext:toast'),
    onQuickPick: on('ext:quickPick')
  }
})
