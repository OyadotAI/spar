export type Tool = { installed: boolean; version?: string }
export type Profile = { name: string; region?: string; sso: boolean }
export type StateReply = {
  project: string | null; hasProject?: boolean; profile?: string; region?: string; scriptBucket?: string; installId: string; os: string
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
export type Breakdown = Record<string, Record<string, number>>
export type MonitorRun = { job: string; id: string; state: string; startedOn: string; completedOn?: string; executionTime?: number; dpuHours: number; errorMessage?: string; workerType?: string; numberOfWorkers?: number; jobType?: string; triggerName?: string }
export type MonitorReply = { hours: number; total: number; succeeded: number; failed: number; running: number; stopped: number; dpuHours: number; executionHours: number; recent: MonitorRun[]; byType?: Breakdown; byWorker?: Breakdown; byDay?: Breakdown }
export type MetricSeries = { id: string; label: string; unit?: string; group: string; points: [number, number][] }
export type MetricsReply = { run: string; period: number; start: string; end: string; series: MetricSeries[]; any: boolean; note?: string }
export type Insights = { rootCause?: LogLine[]; guidance?: LogLine[]; note?: string }
export type SessionInfo = { id: string; status: string; errorMessage?: string; createdOn?: string; role?: string; glueVersion?: string; workerType?: string; numberOfWorkers?: number; idleTimeout?: number; dpuSeconds?: number; executionTime?: number; description?: string }
export type StatementResult = { id: number; state: string; code?: string; progress?: number; output?: { status?: string; errorName?: string; errorValue?: string; traceback?: string[]; text?: string }; note?: string }
export type UpgradeFinding = { severity: 'error' | 'warn' | 'info' | 'ok'; title: string; file?: string; line?: number; detail: string }
export type UpgradeReply = { job: string; glueVersion: string; target: string; workerType?: string; command?: string; script?: string; hasScript: boolean; findings: UpgradeFinding[]; counts: Record<string, number>; prompt: string; note: string }
export type CustomTransform = { key: string; path: string; name: string; displayName: string; description?: string; functionName: string; version?: string; parameters: { name: string; displayName: string; type: string; isOptional?: boolean; description?: string; listOptions?: string[]; listType?: string; validationRule?: string; validationMessage?: string }[] }
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
