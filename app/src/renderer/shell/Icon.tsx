import type { CSSProperties } from 'react'
import {
  Sailboat, Play, Square, RotateCw, Upload, ListOrdered, GitCompareArrows, GitBranch, Files, Settings, Terminal, ChevronRight, Check, X, Clock,
  ArrowUpDown, DollarSign, GitCommitHorizontal, Hand, Plus, Search, RefreshCw, Home, LayoutGrid, Maximize, Trash2, Database, Table2, Code2, Filter,
  GitMerge, Sigma, ArrowRightLeft, ListChecks, ListX, PenLine, CopyX, Combine, Braces, HardDriveUpload, HardDrive, FileJson, FileSpreadsheet, Eraser,
  CalendarClock, Eye, Columns3, AlertTriangle, Info, CircleCheck, CircleX, Loader2, Copy, Download, MoreHorizontal, FolderOpen, Radio, Shuffle,
  ShieldCheck, Split, Wand2, Waypoints, Bookmark, Tags, Link2, Scissors, Layers, FlaskConical, Bug, Wrench, Pencil, ExternalLink, ChevronDown, Activity, Cpu, type LucideIcon,
} from 'lucide-react'

const MAP: Record<string, LucideIcon> = {
  keel: Sailboat, play: Play, stop: Square, retry: RotateCw, deploy: Upload, runs: ListOrdered, changes: GitCompareArrows, git: GitBranch, files: Files,
  gear: Settings, terminal: Terminal, chevron: ChevronRight, chevronDown: ChevronDown, check: Check, x: X, clock: Clock, tokens: ArrowUpDown, dollar: DollarSign,
  commit: GitCommitHorizontal, hand: Hand, plus: Plus, search: Search, refresh: RefreshCw, home: Home, layout: LayoutGrid, fit: Maximize, trash: Trash2,
  database: Database, table: Table2, code: Code2, filter: Filter, join: GitMerge, aggregate: Sigma, mapping: ArrowRightLeft, select: ListChecks, drop: ListX,
  rename: PenLine, dedupe: CopyX, union: Combine, custom: Braces, s3out: HardDriveUpload, s3: HardDrive, json: FileJson, csv: FileSpreadsheet, clean: Eraser,
  schedule: CalendarClock, preview: Eye, schema: Columns3, warn: AlertTriangle, info: Info, ok: CircleCheck, bad: CircleX, spinner: Loader2, copy: Copy,
  download: Download, more: MoreHorizontal, folder: FolderOpen, stream: Radio, shuffle: Shuffle, quality: ShieldCheck, split: Split, magic: Wand2,
  route: Waypoints, bookmark: Bookmark, tags: Tags, link: Link2, pii: Scissors, layers: Layers, tests: FlaskConical, debug: Bug, wrench: Wrench, edit: Pencil,
  external: ExternalLink, activity: Activity, cpu: Cpu,
}

/** One icon set for the whole app (lucide). `name` is a role, not a glyph, so a swap is one line here. */
export function Icon({ name, size = 14, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  const C = MAP[name] ?? Info
  return <C size={size} strokeWidth={1.75} style={{ flex: 'none', ...style }} className={className} aria-hidden />
}

/** The glyph for a Glue node type, by family. */
export function nodeIcon(type: string): string {
  if (/Csv/.test(type)) return 'csv'
  if (/Json/.test(type)) return 'json'
  if (/Parquet|Delta|Hudi|Iceberg|Excel|Hyper/.test(type)) return type.endsWith('Target') ? 's3out' : 's3'
  if (/Catalog/.test(type)) return 'table'
  if (/Kinesis|Kafka/.test(type)) return 'stream'
  if (/JDBC|Redshift|MySQL|Postgre|Oracle|SQLServer|Snowflake|DynamoDB|Athena|Connector|Spark/.test(type)) return 'database'
  switch (type) {
    case 'ApplyMapping': return 'mapping'
    case 'SelectFields': case 'SelectFromCollection': return 'select'
    case 'DropFields': case 'DropNullFields': return 'drop'
    case 'RenameField': return 'rename'
    case 'Filter': return 'filter'
    case 'Join': case 'Merge': return 'join'
    case 'DropDuplicates': return 'dedupe'
    case 'Aggregate': return 'aggregate'
    case 'SparkSQL': return 'code'
    case 'CustomCode': case 'DynamicTransform': return 'custom'
    case 'Union': return 'union'
    case 'SplitFields': case 'Route': return 'split'
    case 'FillMissingValues': return 'clean'
    case 'PIIDetection': return 'pii'
    case 'EvaluateDataQuality': case 'EvaluateDataQualityMultiFrame': return 'quality'
    case 'Recipe': return 'magic'
    case 'Spigot': return 'preview'
    default: return type.endsWith('Target') ? 's3out' : type.endsWith('Source') ? 's3' : 'layers'
  }
}
