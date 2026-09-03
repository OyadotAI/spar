import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Daemon } from './daemon'
import { installMenu, setCanvasEnabled } from './menu'

// KEEL_USERDATA=<dir>: a separate profile (remembered tabs, project) for screenshots and tests.
if (process.env.KEEL_USERDATA) app.setPath('userData', process.env.KEEL_USERDATA)

let win: BrowserWindow | null = null
let daemon: Daemon | null = null

function wireDaemon(d: Daemon): void {
  d.onPort((port) => win?.webContents.send('keel:daemon', { port, project: d.projectDir }))
  d.onDeath((reason) => win?.webContents.send('keel:daemon', { port: 0, reason }))
}

const settingsPath = () => join(app.getPath('userData'), 'keel.json')
/**
 * The remembered project, or null on a first launch. It is never `$HOME`: the daemon writes
 * `.keel/`, creates `jobs/`, and `git init`s whatever it is pointed at, so a silent default would
 * put all of that in the user's home directory. Null means the window opens on Welcome.
 */
async function readProject(): Promise<string | null> {
  if (process.env.KEEL_PROJECT) return process.env.KEEL_PROJECT
  try {
    const { readFile } = await import('node:fs/promises')
    const j = JSON.parse(await readFile(settingsPath(), 'utf8'))
    if (typeof j.project === 'string' && j.project) return j.project
  } catch { /* first launch */ }
  return null
}
async function writeProject(p: string): Promise<void> {
  const { writeFile, mkdir, readFile } = await import('node:fs/promises')
  await mkdir(app.getPath('userData'), { recursive: true })
  let recent: string[] = []
  try { const j = JSON.parse(await readFile(settingsPath(), 'utf8')); if (Array.isArray(j.recent)) recent = j.recent } catch { /* first */ }
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, 8)
  await writeFile(settingsPath(), JSON.stringify({ project: p, recent }))
}

export type ProjectCheck = { ok: boolean; why?: string; hint?: string; empty?: boolean; git?: boolean; keel?: boolean }

/**
 * A project directory is somewhere Keel may create `jobs/`, `.keel/` and a git repository. Refusing
 * `$HOME` and filesystem roots is the whole point: pointed at `$HOME`, the first job Keel creates
 * runs `git init` and `git add -A` over everything the user owns.
 */
async function check(dir: string): Promise<ProjectCheck> {
  const { stat, readdir } = await import('node:fs/promises')
  const { resolve, parse } = await import('node:path')
  const p = resolve(dir)
  if (!p) return { ok: false, why: 'No folder chosen.' }
  if (p === app.getPath('home')) return { ok: false, why: 'That is your home folder.', hint: 'Keel creates jobs/ and .keel/ and a git repository inside the project. Pick or make a folder for your Glue jobs, such as ~/glue-jobs.' }
  if (p === parse(p).root) return { ok: false, why: 'That is the root of the filesystem.', hint: 'Pick a folder for your Glue jobs.' }
  for (const d of ['desktop', 'documents', 'downloads'] as const) {
    try { if (p === app.getPath(d)) return { ok: false, why: `That is your ${d} folder.`, hint: 'Make a folder inside it instead.' } } catch { /* not on this OS */ }
  }
  try {
    const st = await stat(p)
    if (!st.isDirectory()) return { ok: false, why: 'That is a file, not a folder.' }
  } catch { return { ok: true, empty: true } } // does not exist yet: we create it
  const entries = await readdir(p)
  const visible = entries.filter((e) => !e.startsWith('.'))
  const git = entries.includes('.git')
  const keel = entries.includes('.keel') || visible.includes('jobs')
  if (keel || git || visible.length === 0) return { ok: true, empty: visible.length === 0, git, keel }
  return { ok: true, why: `${visible.length} other item${visible.length > 1 ? 's are' : ' is'} already here.`,
    hint: 'Keel will add jobs/ and .keel/ and, if there is no repository yet, run git init here. Fine for an existing repo; pick an empty folder otherwise.', git, keel }
}

/**
 * The app icon. Packaged builds get it from electron-builder (build/icon.icns | .ico | .png), but
 * a dev run shows Electron's own logo unless we hand it over ourselves.
 */
function devIcon(): string | undefined {
  const png = join(__dirname, '../../build/icon.png')
  return app.isPackaged || !existsSync(png) ? undefined : png
}

function createWindow(): void {
  const icon = devIcon()
  if (icon && process.platform === 'darwin') app.dock?.setIcon(icon)
  win = new BrowserWindow({
    // KEEL_SIZE=<w>x<h> sizes the window for the screenshot rig, so a layout can be checked at
    // the narrow end without dragging the corner by hand.
    width: Number(process.env.KEEL_SIZE?.split('x')[0]) || 1400,
    height: Number(process.env.KEEL_SIZE?.split('x')[1]) || 900,
    minWidth: 960, minHeight: 600,
    title: 'SparData',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(icon ? { icon } : {}),
    // matches theme.css's --bg, so the window does not flash the wrong colour before the first paint
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F1013' : '#FCFCFD',
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
  daemon = new Daemon(project ?? '')
  wireDaemon(daemon)
  daemon.start() // starts even with no project: Welcome needs /api/state for the tool checks
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

ipcMain.on('keel:canvas', (_e, on: boolean) => setCanvasEnabled(on))
ipcMain.handle('keel:port', () => ({ port: daemon?.port ?? 0, project: daemon?.projectDir ?? '' }))
ipcMain.handle('keel:recentProjects', async () => {
  try {
    const { readFile } = await import('node:fs/promises')
    const j = JSON.parse(await readFile(settingsPath(), 'utf8'))
    return Array.isArray(j.recent) ? (j.recent as string[]) : []
  } catch { return [] }
})
/** Checks a candidate before anything is written into it. The renderer shows `why` verbatim. */
ipcMain.handle('keel:checkProject', async (_e, dir: string) => check(dir))
ipcMain.handle('keel:openExternal', (_e, url: string) => { if (/^https?:\/\//.test(url)) shell.openExternal(url) })
ipcMain.handle('keel:pickProject', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose the folder your Glue jobs live in' })
  if (r.canceled || !r.filePaths[0]) return null
  return r.filePaths[0]
})
/** Commits to a project: remembers it, creates it if needed, and starts or restarts the daemon there. */
ipcMain.handle('keel:openProject', async (_e, dir: string) => {
  const c = await check(dir)
  if (!c.ok) return { ...c, ok: false }
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  await writeProject(dir)
  if (daemon) daemon.restart(dir)
  else { daemon = new Daemon(dir); wireDaemon(daemon); daemon.start() }
  return { ok: true }
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
