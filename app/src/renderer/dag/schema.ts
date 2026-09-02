/** The node types Keel generates code for, and how the inspector edits each. Keys match the daemon's codegen. */
export type Kind = 'string' | 'int' | 'number' | 'bool' | 'enum' | 'stringList' | 'pathList' | 'columnPick' | 'mappingTable' | 'filterExprs' | 'joinCols' | 'nullChecks' | 'sql' | 'code' | 'json' | 'dqRuleset'
export type Field = { key: string; label: string; kind: Kind; options?: string[]; help?: string }
export type Category = 'source' | 'transform' | 'target'

const S = (key: string, label: string): Field => ({ key, label, kind: 'string' })
const B = (key: string, label: string): Field => ({ key, label, kind: 'bool' })
const E = (key: string, label: string, options: string[]): Field => ({ key, label, kind: 'enum', options })
const L = (key: string, label: string): Field => ({ key, label, kind: 'stringList' })
const P = (key: string, label: string): Field => ({ key, label, kind: 'pathList', help: 'one column per line; dotted for nested' })
const J = (key: string, label: string): Field => ({ key, label, kind: 'json' })

export const SCHEMA: Record<string, Field[]> = {
  S3CsvSource: [L('Paths', 'S3 paths'), E('Separator', 'Separator', ['comma', 'tab', 'pipe', 'semicolon', 'ctrla']), E('QuoteChar', 'Quote', ['quote', 'quillemet', 'single_quote', 'disabled']), B('WithHeader', 'Has header'), B('Recurse', 'Recurse'), S('Escaper', 'Escaper')],
  S3ParquetSource: [L('Paths', 'S3 paths'), E('Compression', 'Compression', ['snappy', 'gzip', 'lzo', 'brotli', 'lz4', 'uncompressed']), B('Recurse', 'Recurse')],
  S3JsonSource: [L('Paths', 'S3 paths'), S('JsonPath', 'JSON path'), B('Multiline', 'Multiline'), B('Recurse', 'Recurse')],
  S3CatalogSource: [S('Database', 'Database'), S('Table', 'Table'), S('PartitionPredicate', 'Partition predicate')],
  CatalogSource: [S('Database', 'Database'), S('Table', 'Table')],
  ApplyMapping: [{ key: 'Mapping', label: 'Mappings', kind: 'mappingTable' }],
  SelectFields: [{ key: 'Paths', label: 'Fields to keep', kind: 'columnPick' }],
  DropFields: [{ key: 'Paths', label: 'Fields to drop', kind: 'columnPick' }],
  RenameField: [{ key: 'SourcePath', label: 'From column', kind: 'stringList' }, { key: 'TargetPath', label: 'To column', kind: 'stringList' }],
  Filter: [E('LogicalOperator', 'Combine with', ['AND', 'OR']), { key: 'Filters', label: 'Conditions', kind: 'filterExprs' }],
  Join: [E('JoinType', 'Join type', ['equijoin', 'left', 'right', 'outer', 'leftsemi', 'leftanti']), { key: 'Columns', label: 'Join keys', kind: 'joinCols' }],
  DropDuplicates: [P('Columns', 'Columns (empty = all)')],
  DropNullFields: [{ key: 'NullCheckBoxList', label: 'Treat as null', kind: 'nullChecks' }, J('NullTextList', 'Custom null values [{Value, Datatype:{Id,Label}}]')],
  Aggregate: [P('Groups', 'Group by'), J('Aggs', 'Aggregations [{Column:[..], AggFunc}]')],
  SparkSQL: [{ key: 'SqlQuery', label: 'SQL', kind: 'sql' }, J('SqlAliases', 'Aliases [{From, Alias}]')],
  CustomCode: [S('ClassName', 'Class name'), { key: 'Code', label: 'Python', kind: 'code' }],
  Union: [E('UnionType', 'Union type', ['ALL', 'DISTINCT'])],
  SplitFields: [{ key: 'Paths', label: 'Fields for the first frame', kind: 'columnPick' }],
  SelectFromCollection: [{ key: 'Index', label: 'Frame index', kind: 'int' }],
  FillMissingValues: [{ key: 'ImputedPath', label: 'Data field', kind: 'string' }, S('FilledPath', 'New field name')],
  Spigot: [S('Path', 'S3 path for the sample'), { key: 'Topk', label: 'Number of records (0–100)', kind: 'int' }, { key: 'Prob', label: 'Probability threshold (0–1)', kind: 'number' }],
  Merge: [S('Source', 'Source node id'), J('PrimaryKeys', 'Primary keys [[col]]')],
  EvaluateDataQuality: [{ key: 'Ruleset', label: 'DQDL ruleset', kind: 'dqRuleset' }, J('PublishingOptions', 'Publishing {EvaluationContext, ResultsS3Prefix, CloudWatchMetricsEnabled, ResultsPublishingEnabled}'), J('StopJobOnFailureOptions', 'On failure {StopJobOnFailureTiming: Immediate|AfterDataLoad}')],
  EvaluateDataQualityMultiFrame: [{ key: 'Ruleset', label: 'DQDL ruleset', kind: 'dqRuleset' }, J('AdditionalDataSources', 'Aliases {alias: nodeId}'), J('PublishingOptions', 'Publishing options'), J('StopJobOnFailureOptions', 'On failure')],
  Route: [J('GroupFiltersList', 'Groups [{GroupName, LogicalOperator, Filters:[…]}]')],
  PIIDetection: [E('PiiType', 'Action', ['RowAudit', 'RowMasking', 'RowPartialMasking', 'RowHashing', 'ColumnAudit', 'ColumnMasking', 'ColumnHashing']), L('EntityTypesToDetect', 'Entity types'), S('OutputColumnName', 'Output column'), { key: 'SampleFraction', label: 'Sample portion (0–1)', kind: 'number' }, { key: 'ThresholdFraction', label: 'Detection threshold (0–1)', kind: 'number' }, S('MaskValue', 'Mask value'), E('DetectionSensitivity', 'Sensitivity', ['', 'HIGH', 'LOW'])],
  S3DirectTarget: [S('Path', 'S3 path'), E('Format', 'Format', ['json', 'csv', 'avro', 'orc', 'parquet']), E('Compression', 'Compression', ['', 'gzip', 'snappy', 'bzip2']), P('PartitionKeys', 'Partition keys')],
  S3GlueParquetTarget: [S('Path', 'S3 path'), E('Compression', 'Compression', ['snappy', 'gzip', 'lzo', 'uncompressed']), P('PartitionKeys', 'Partition keys')],
  S3CatalogTarget: [S('Database', 'Database'), S('Table', 'Table'), P('PartitionKeys', 'Partition keys')],
}

export const PALETTE: { category: Category; types: string[] }[] = [
  { category: 'source', types: ['S3CsvSource', 'S3ParquetSource', 'S3JsonSource', 'S3CatalogSource'] },
  { category: 'transform', types: ['ApplyMapping', 'SelectFields', 'DropFields', 'RenameField', 'Filter', 'Join', 'DropDuplicates', 'DropNullFields', 'Aggregate', 'SparkSQL', 'CustomCode', 'Union'] },
  { category: 'target', types: ['S3DirectTarget', 'S3GlueParquetTarget', 'S3CatalogTarget'] },
]

export function category(type: string): Category {
  if (type.endsWith('Source')) return 'source'
  if (type.endsWith('Target')) return 'target'
  return 'transform'
}
export function fields(type: string): Field[] | undefined { return SCHEMA[type] }
export function supported(type: string): boolean { return type in SCHEMA }
export function maxInputs(type: string): number {
  if (category(type) === 'source') return 0
  if (type === 'Join') return 2
  if (type === 'Union' || type === 'SparkSQL' || type === 'CustomCode' || type === 'EvaluateDataQualityMultiFrame' || type === 'Merge' || type === 'DynamicTransform') return 8
  return 1
}
import { uiName } from './catalog'
export function label(type: string): string { return uiName(type) }

/** A fresh node body for the palette. */
export function template(type: string, name: string): Record<string, unknown> {
  const base: Record<string, unknown> = { Name: name }
  if (category(type) !== 'source') base.Inputs = []
  switch (type) {
    case 'S3CsvSource': return { ...base, Paths: [], Separator: 'comma', QuoteChar: 'quote', WithHeader: true, Recurse: true }
    case 'S3ParquetSource': case 'S3JsonSource': return { ...base, Paths: [], Recurse: true }
    case 'S3CatalogSource': case 'CatalogSource': return { ...base, Database: '', Table: '' }
    case 'ApplyMapping': return { ...base, Mapping: [] }
    case 'SelectFields': case 'DropFields': return { ...base, Paths: [] }
    case 'RenameField': return { ...base, SourcePath: [], TargetPath: [] }
    case 'Filter': return { ...base, LogicalOperator: 'AND', Filters: [] }
    case 'Join': return { ...base, JoinType: 'equijoin', Columns: [] }
    case 'DropDuplicates': return { ...base, Columns: [] }
    case 'Aggregate': return { ...base, Groups: [], Aggs: [] }
    case 'SparkSQL': return { ...base, SqlQuery: 'select * from myDataSource', SqlAliases: [] }
    case 'CustomCode': return { ...base, ClassName: 'MyTransform', Code: 'def MyTransform(glueContext, dfc) -> DynamicFrameCollection:\n    df = dfc.select(list(dfc.keys())[0]).toDF()\n    return DynamicFrameCollection({"out": DynamicFrame.fromDF(df, glueContext, "out")}, glueContext)\n' }
    case 'Union': return { ...base, UnionType: 'ALL' }
    case 'SplitFields': return { ...base, Paths: [] }
    case 'SelectFromCollection': return { ...base, Index: 0 }
    case 'FillMissingValues': return { ...base, ImputedPath: '' }
    case 'Spigot': return { ...base, Path: '', Topk: 20, Prob: 1 }
    case 'DropNullFields': return { ...base, NullCheckBoxList: { IsEmpty: true, IsNullString: true, IsNegOne: false } }
    case 'EvaluateDataQuality': return { ...base, Ruleset: 'Rules = [\n    RowCount > 0\n]', Output: 'PrimaryInput' }
    case 'EvaluateDataQualityMultiFrame': return { ...base, Ruleset: 'Rules = [\n    RowCount > 0\n]' }
    case 'Route': return { ...base, GroupFiltersList: [{ GroupName: 'output_group_1', LogicalOperator: 'AND', Filters: [] }] }
    case 'PIIDetection': return { ...base, PiiType: 'RowAudit', EntityTypesToDetect: ['EMAIL', 'PHONE_NUMBER'] }
    case 'S3DirectTarget': return { ...base, Path: '', Format: 'parquet', PartitionKeys: [] }
    case 'S3GlueParquetTarget': return { ...base, Path: '', Compression: 'snappy', PartitionKeys: [] }
    case 'S3CatalogTarget': return { ...base, Database: '', Table: '', PartitionKeys: [] }
    default: return base
  }
}
