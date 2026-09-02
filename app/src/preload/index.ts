import { contextBridge, ipcRenderer } from 'electron'

/** The whole bridge. The renderer talks to the daemon over loopback itself; this is only what the OS owns. */
const keel = {
  platform: process.platform,
  /** dev only: `KEEL_OPEN=job:tab` opens a lane on launch, so a screenshot can show it */
  openOnLaunch: process.env.KEEL_OPEN ?? '',
  port: (): Promise<{ port: number; project: string }> => ipcRenderer.invoke('keel:port'),
  onDaemon: (cb: (s: { port: number; project?: string; reason?: string }) => void): (() => void) => {
    const h = (_e: unknown, s: { port: number; project?: string; reason?: string }) => cb(s)
    ipcRenderer.on('keel:daemon', h)
    return () => ipcRenderer.removeListener('keel:daemon', h)
  },
  onMenu: (cb: (cmd: string) => void): (() => void) => {
    const h = (_e: unknown, cmd: string) => cb(cmd)
    ipcRenderer.on('keel:menu', h)
    return () => ipcRenderer.removeListener('keel:menu', h)
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('keel:openExternal', url),
  pickProject: (): Promise<string | null> => ipcRenderer.invoke('keel:pickProject'),
  saveText: (suggested: string, text: string): Promise<string | null> => ipcRenderer.invoke('keel:saveText', suggested, text),
  openText: (): Promise<{ name: string; text: string } | null> => ipcRenderer.invoke('keel:openText'),
}
contextBridge.exposeInMainWorld('keel', keel)
export type KeelBridge = typeof keel
