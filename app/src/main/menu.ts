import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

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
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Jobs',
      submenu: [
        { label: 'Run', accelerator: 'CmdOrCtrl+R', click: send('run') },
        { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: send('stop') },
        { label: 'Deploy', accelerator: 'Shift+CmdOrCtrl+D', click: send('deploy') },
        { type: 'separator' },
        { label: 'Jobs Page', accelerator: 'CmdOrCtrl+Shift+H', click: send('home') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: send('palette') },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+Alt+T', click: send('terminal') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Fit', accelerator: 'CmdOrCtrl+0', click: send('zoom-fit') },
        { label: 'Auto-layout', accelerator: 'CmdOrCtrl+Shift+L', click: send('auto-layout') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl))
  app.setName('Keel')
}
