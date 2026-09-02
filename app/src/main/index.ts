import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { Daemon } from './daemon'
import { installMenu } from './menu'

// KEEL_USERDATA=<dir>: a separate profile (remembered tabs, project) for screenshots and tests.
if (process.env.KEEL_USERDATA) app.setPath('userData', process.env.KEEL_USERDATA)

let win: BrowserWindow | null = null
let daemon: Daemon | null = null

const settingsPath = () => join(app.getPath('userData'), 'keel.json')
async function readProject(): Promise<string> {
  if (process.env.KEEL_PROJECT) return process.env.KEEL_PROJECT
  try {
    const { readFile } = await import('node:fs/promises')
    const j = JSON.parse(await readFile(settingsPath(), 'utf8'))
    if (typeof j.project === 'string') return j.project
  } catch { /* first launch */ }
  return app.getPath('home')
}
async function writeProject(p: string): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify({ project: p }))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 960, minHeight: 600,
    title: 'Keel',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#111214',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  win.on('closed', () => { win = null })
  // Renderer console → our stdout, so a blank window explains itself in the dev log.
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 'warning' || process.env.KEEL_SHOT) console.error(`[renderer:${ev.level}] ${ev.message} (${ev.sourceId}:${ev.lineNumber})`) })
  win.webContents.on('preload-error', (_e, path, err) => console.error('[preload-error]', path, err))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  // KEEL_SHOT=<png path>[:<delay ms>]: photograph the window once it has settled. The screenshot
  // rig for docs and for the smoke test; a page that cannot be photographed is a page nobody saw.
  // KEEL_SHOT=<png path>[:<delay ms>[:<every ms>]] — with `every`, the file is re-taken on that period (…-1.png, -2.png…).
  const shot = process.env.KEEL_SHOT
  if (shot) {
    const [file, delay, every] = shot.split(':')
    let n = 0
    const take = async () => {
      try { const img = await win!.webContents.capturePage(); const { writeFile } = await import('node:fs/promises'); await writeFile(every ? file!.replace(/\.png$/, `-${++n}.png`) : file!, img.toPNG()) }
      catch (e) { console.error('shot failed', e) }
    }
    win.webContents.once('did-finish-load', () => setTimeout(() => { void take(); if (every) setInterval(() => void take(), Number(every)) }, Number(delay ?? 3000)))
  }
}

app.whenReady().then(async () => {
  installMenu(() => win)
  const project = await readProject()
  daemon = new Daemon(project)
  daemon.onPort((port) => win?.webContents.send('keel:daemon', { port, project: daemon?.projectDir }))
  daemon.onDeath((reason) => win?.webContents.send('keel:daemon', { port: 0, reason }))
  daemon.start()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

ipcMain.handle('keel:port', () => ({ port: daemon?.port ?? 0, project: daemon?.projectDir ?? '' }))
ipcMain.handle('keel:openExternal', (_e, url: string) => { if (/^https?:\/\//.test(url)) shell.openExternal(url) })
ipcMain.handle('keel:pickProject', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Open the folder your Glue jobs live in' })
  if (r.canceled || !r.filePaths[0]) return null
  const p = r.filePaths[0]
  await writeProject(p)
  daemon?.restart(p)
  return p
})

ipcMain.handle('keel:saveText', async (_e, suggested: string, text: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: suggested })
  if (r.canceled || !r.filePath) return null
  const { writeFile } = await import('node:fs/promises')
  await writeFile(r.filePath, text)
  return r.filePath
})
ipcMain.handle('keel:openText', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const { readFile } = await import('node:fs/promises')
  return { name: r.filePaths[0].split(/[\\/]/).pop() ?? 'job.json', text: await readFile(r.filePaths[0], 'utf8') }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => daemon?.stop())
