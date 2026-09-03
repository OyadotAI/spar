import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/** Menu items send one string to the renderer; the renderer decides what it means for the active tab. */
export function installMenu(win: () => BrowserWindow | null): void {
  const send = (cmd: string) => () => win()?.webContents.send('keel:menu', cmd)
  const mac = process.platform === 'darwin'
  const tpl: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('open-project') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        // ⌘W closes the *tab*, as in every other tabbed editor; the window keeps ⇧⌘W.
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        mac ? { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' } : { role: 'quit' },
      ],
    },
    {
      // Undo/Redo are the *editing* roles. They used to be bound to the DAG canvas, which meant
      // the accelerator was swallowed by the menu and ⌘Z did nothing in any text field in the app.
      // Canvas history lives under Canvas, below, where it is only enabled when a canvas is open.
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: send('find') },
      ],
    },
    {
      label: 'Job',
      submenu: [
        { label: 'Run…', accelerator: 'CmdOrCtrl+R', click: send('run') },
        { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: send('stop') },
        { label: 'Deploy…', accelerator: 'Shift+CmdOrCtrl+D', click: send('deploy') },
        { type: 'separator' },
        { label: 'All Jobs', accelerator: 'CmdOrCtrl+Shift+J', click: send('home') },
      ],
    },
    {
      // Every item here acts on the DAG canvas, so every item here is disabled unless one is open.
      // They used to sit under View, always enabled, silently doing nothing on six of seven tabs.
      label: 'Canvas',
      submenu: [
        { id: 'canvas-undo', label: 'Undo Canvas Change', accelerator: 'CmdOrCtrl+Alt+Z', enabled: false, click: send('undo') },
        { id: 'canvas-redo', label: 'Redo Canvas Change', accelerator: 'Shift+CmdOrCtrl+Alt+Z', enabled: false, click: send('redo') },
        { type: 'separator' },
        { id: 'canvas-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', enabled: false, click: send('zoom-in') },
        { id: 'canvas-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', enabled: false, click: send('zoom-out') },
        { id: 'canvas-fit', label: 'Fit to Window', accelerator: 'CmdOrCtrl+0', enabled: false, click: send('zoom-fit') },
        { id: 'canvas-layout', label: 'Auto-layout', accelerator: 'CmdOrCtrl+Shift+L', enabled: false, click: send('auto-layout') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: send('palette') },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+Alt+T', click: send('terminal') },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Keel on GitHub', click: () => void shell.openExternal('https://github.com/oya-ai/keel') },
        { label: 'AWS Glue Documentation', click: () => void shell.openExternal('https://docs.aws.amazon.com/glue/latest/dg/') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl))
  app.setName('Keel')
}

/** The renderer says when a DAG canvas is on screen; the Canvas menu follows it. */
export function setCanvasEnabled(on: boolean): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  for (const id of ['canvas-undo', 'canvas-redo', 'canvas-in', 'canvas-out', 'canvas-fit', 'canvas-layout']) {
    const item = menu.getMenuItemById(id)
    if (item) item.enabled = on
  }
}
