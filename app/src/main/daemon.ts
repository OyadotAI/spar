import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * The daemon is a child of this process and dies with it: `--exit-with-parent` on its side
 * (it polls its parent pid) and an explicit kill on ours. Its port is the one line it prints.
 *
 * Every handler closes over the child it belongs to, so a restart (Open Project…) cannot be
 * confused by the old child's exit arriving after the new one has already announced its port —
 * which is exactly what used to read as "daemon down" while a healthy daemon sat unannounced.
 */
export class Daemon {
  private child: ChildProcess | null = null
  port = 0
  private listeners = new Set<(port: number) => void>()
  private deaths = new Set<(reason: string) => void>()

  constructor(private project: string) {}

  onPort(cb: (port: number) => void): void { this.listeners.add(cb) }
  onDeath(cb: (reason: string) => void): void { this.deaths.add(cb) }
  get projectDir(): string { return this.project }

  start(): void {
    const { java, jar } = locate()
    if (!existsSync(jar)) { this.deaths.forEach((d) => d(`daemon jar not found at ${jar}`)); return }
    const args = ['-jar', jar, '--project', this.project, '--exit-with-parent']
    const child = spawn(java, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    this.port = 0
    let buf = ''
    let announced = 0
    child.stdout?.on('data', (d: Buffer) => {
      if (this.child !== child) return
      buf += d.toString()
      const m = /KEEL_PORT=(\d+)/.exec(buf)
      if (m && !announced) {
        announced = Number(m[1])
        this.port = announced
        console.error(`[daemon] pid ${child.pid} listening on 127.0.0.1:${this.port} for ${this.project}`)
        this.listeners.forEach((l) => l(this.port))
      }
      if (buf.length > 4096) buf = buf.slice(-1024)
    })
    let tail: string[] = []
    child.stderr?.on('data', (d: Buffer) => { tail = tail.concat(d.toString().split('\n')).slice(-20) })
    child.on('exit', (code) => {
      if (this.child !== child) return // superseded by a restart; its death is not news
      this.child = null
      this.port = 0
      this.deaths.forEach((d) => d(`daemon exited with code ${code}${announced ? '' : ' before announcing a port'}\n${tail.join('\n')}`))
    })
  }

  restart(project: string): void { this.project = project; this.stop(); this.start() }

  stop(): void {
    const c = this.child
    if (!c) return
    this.child = null
    this.port = 0
    c.kill()
    setTimeout(() => { try { c.kill('SIGKILL') } catch { /* already gone */ } }, 3000).unref()
  }
}

/** Dev: env vars from the Makefile. Packaged: the jar and a jlink'd JRE under resources/. */
function locate(): { java: string; jar: string } {
  if (process.env.KEEL_DAEMON_JAR) return { java: process.env.KEEL_JAVA ?? 'java', jar: process.env.KEEL_DAEMON_JAR }
  const res = process.resourcesPath ?? join(app.getAppPath(), '..')
  const bin = process.platform === 'win32' ? 'java.exe' : 'java'
  const bundled = join(res, 'jre', 'bin', bin)
  return { java: existsSync(bundled) ? bundled : 'java', jar: join(res, 'keel-daemon.jar') }
}
