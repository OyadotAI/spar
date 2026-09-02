export type Tool = { installed: boolean; version?: string }
export type Profile = { name: string; region?: string; sso: boolean }
export type StateReply = {
  project: string; profile?: string; region?: string; scriptBucket?: string; installId: string; os: string
  tools: Record<'claude' | 'aws' | 'docker' | 'git', Tool>
  profiles?: Profile[]
  live?: LiveStatus
}
export type LiveStatus = {
  mode: 'push' | 'polling' | 'off'; sweepSeconds: number; throttled: boolean
  push: { enabled: boolean; queueUrl?: string; trail: 'present' | 'absent' | 'unknown'; lastEventAt?: string; error?: string }
}
export type GlueRun = {
  id: string; attempt?: number; state: string; stateDetail?: string; errorMessage?: string
  startedOn?: string; completedOn?: string; executionTime?: number; dpuSeconds?: number
  arguments?: Record<string, string>; logGroupName?: string; glueVersion?: string; workerType?: string; numberOfWorkers?: number
  previousRunId?: string; triggerName?: string; maxCapacity?: number; dpuHours?: number
}
export type Schedule = { name: string; schedule: string; state: string; description?: string; jobs: string[]; arguments: Record<string, string> }
export type MonitorReply = { hours: number; total: number; succeeded: number; failed: number; running: number; stopped: number; dpuHours: number; executionHours: number; recent: { job: string; id: string; state: string; startedOn: string; executionTime?: number; dpuHours: number; errorMessage?: string }[] }
export type GlueJob = {
  name: string; jobMode?: string; glueVersion?: string; workerType?: string; numberOfWorkers?: number
  commandName?: string; scriptLocation?: string; role?: string; lastModifiedOn?: string
  latestRun?: GlueRun | null
  local?: { imported: boolean; lane?: string; remoteChanged?: boolean }
}
export type LogLine = { ts: string; group: string; stream: string; message: string }
export type TestCase = { name: string; node?: string; status: 'pass' | 'fail' | 'error' | 'skip'; message?: string }
export type TestResult = { status: string; message?: string; ms?: number; passed: number; failed: number; errors: number; skipped: number; cases: TestCase[] }
export type Pending = { id: string; lane: string; tool: string; command: string; rules: string[]; input: unknown; sessionId: string }
export type EventFrame = { seq: number; kind: string; data: unknown }
