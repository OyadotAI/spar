/** Every node type Glue Studio offers, by family, with its UI name. Codegen supports a subset (schema.ts); the rest edit as JSON and deploy as-is. */
export type Family = { title: string; category: 'source' | 'transform' | 'target'; types: [string, string][] }
export const CATALOG: Family[] = [
  { title: 'Sources · Amazon S3', category: 'source', types: [['S3CsvSource', 'S3 · CSV'], ['S3JsonSource', 'S3 · JSON'], ['S3ParquetSource', 'S3 · Parquet'], ['S3ExcelSource', 'S3 · Excel'], ['S3CatalogSource', 'S3 · Data Catalog table'], ['S3DeltaSource', 'S3 · Delta Lake'], ['S3CatalogDeltaSource', 'Catalog · Delta Lake'], ['S3HudiSource', 'S3 · Hudi'], ['S3CatalogHudiSource', 'Catalog · Hudi'], ['S3CatalogIcebergSource', 'Catalog · Iceberg']] },
  { title: 'Sources · Catalog & databases', category: 'source', types: [['CatalogSource', 'Data Catalog'], ['CatalogDeltaSource', 'Data Catalog · Delta'], ['CatalogHudiSource', 'Data Catalog · Hudi'], ['CatalogIcebergSource', 'Data Catalog · Iceberg'], ['RelationalCatalogSource', 'Relational DB (Catalog)'], ['MySQLCatalogSource', 'MySQL'], ['PostgreSQLCatalogSource', 'PostgreSQL'], ['OracleSQLCatalogSource', 'Oracle'], ['MicrosoftSQLServerCatalogSource', 'SQL Server'], ['DynamoDBCatalogSource', 'DynamoDB'], ['DynamoDBELTConnectorSource', 'DynamoDB (ELT)'], ['RedshiftSource', 'Redshift (legacy)'], ['AmazonRedshiftSource', 'Amazon Redshift'], ['SnowflakeSource', 'Snowflake'], ['DirectJDBCSource', 'JDBC']] },
  { title: 'Sources · Streaming & connectors', category: 'source', types: [['DirectKinesisSource', 'Kinesis'], ['CatalogKinesisSource', 'Kinesis (Catalog)'], ['DirectKafkaSource', 'Kafka'], ['CatalogKafkaSource', 'Kafka (Catalog)'], ['AthenaConnectorSource', 'Athena connector'], ['JDBCConnectorSource', 'JDBC connector'], ['SparkConnectorSource', 'Spark connector'], ['ConnectorDataSource', 'Connector data source']] },
  { title: 'Transforms', category: 'transform', types: [['ApplyMapping', 'Change Schema'], ['SelectFields', 'Select Fields'], ['DropFields', 'Drop Fields'], ['RenameField', 'Rename Field'], ['Filter', 'Filter'], ['Join', 'Join'], ['Union', 'Union'], ['Aggregate', 'Aggregate'], ['DropDuplicates', 'Drop Duplicates'], ['DropNullFields', 'Drop Null Fields'], ['FillMissingValues', 'Fill Missing Values'], ['SplitFields', 'Split Fields'], ['SelectFromCollection', 'Select From Collection'], ['Merge', 'Merge'], ['Spigot', 'Spigot'], ['SparkSQL', 'SQL Query'], ['CustomCode', 'Custom Transform'], ['DynamicTransform', 'Dynamic Transform'], ['Recipe', 'Data Preparation Recipe'], ['PIIDetection', 'Detect Sensitive Data'], ['EvaluateDataQuality', 'Evaluate Data Quality'], ['EvaluateDataQualityMultiFrame', 'Evaluate Data Quality (multi)'], ['Route', 'Conditional Router']] },
  { title: 'Targets · Amazon S3', category: 'target', types: [['S3DirectTarget', 'S3 (CSV/JSON/Parquet/…)'], ['S3GlueParquetTarget', 'S3 · Glue Parquet'], ['S3CatalogTarget', 'S3 · Data Catalog table'], ['S3DeltaDirectTarget', 'S3 · Delta Lake'], ['S3DeltaCatalogTarget', 'Catalog · Delta Lake'], ['S3HudiDirectTarget', 'S3 · Hudi'], ['S3HudiCatalogTarget', 'Catalog · Hudi'], ['S3IcebergDirectTarget', 'S3 · Iceberg'], ['S3IcebergCatalogTarget', 'Catalog · Iceberg'], ['S3HyperDirectTarget', 'S3 · Tableau Hyper'], ['GovernedCatalogTarget', 'Governed table']] },
  { title: 'Targets · Databases & connectors', category: 'target', types: [['CatalogTarget', 'Data Catalog'], ['MySQLCatalogTarget', 'MySQL'], ['PostgreSQLCatalogTarget', 'PostgreSQL'], ['OracleSQLCatalogTarget', 'Oracle'], ['MicrosoftSQLServerCatalogTarget', 'SQL Server'], ['RedshiftTarget', 'Redshift (legacy)'], ['AmazonRedshiftTarget', 'Amazon Redshift'], ['SnowflakeTarget', 'Snowflake'], ['JDBCConnectorTarget', 'JDBC connector'], ['SparkConnectorTarget', 'Spark connector'], ['ConnectorDataTarget', 'Connector data target']] },
]
/**
 * The words people actually reach for. Glue's own names are not what anyone types: you think
 * "dedupe", "where", "group by", "lookup", "mask" — Glue says Drop Duplicates, Filter, Aggregate,
 * Join, Detect Sensitive Data. Searching only the label made half the catalogue unfindable.
 */
export const KEYWORDS: Record<string, string[]> = {
  ApplyMapping: ['change schema', 'rename columns', 'cast', 'types', 'map', 'mapping', 'projection'],
  SelectFields: ['keep', 'project', 'pick', 'columns', 'subset'],
  DropFields: ['remove', 'delete', 'exclude', 'columns', 'prune'],
  RenameField: ['rename', 'alias', 'column name'],
  Filter: ['where', 'condition', 'predicate', 'restrict', 'rows'],
  Join: ['lookup', 'merge', 'inner', 'left', 'right', 'outer', 'combine'],
  Union: ['append', 'concat', 'stack', 'combine rows'],
  Aggregate: ['group by', 'sum', 'count', 'avg', 'average', 'min', 'max', 'rollup', 'summarise', 'summarize'],
  DropDuplicates: ['dedupe', 'deduplicate', 'distinct', 'unique'],
  DropNullFields: ['null', 'empty', 'blank', 'clean'],
  FillMissingValues: ['impute', 'null', 'default', 'fillna', 'coalesce'],
  SplitFields: ['split', 'divide', 'partition columns'],
  SelectFromCollection: ['pick frame', 'collection', 'index'],
  Merge: ['upsert', 'apply changes', 'primary key'],
  Spigot: ['sample', 'debug', 'peek', 'dump'],
  SparkSQL: ['sql', 'query', 'select', 'spark sql'],
  CustomCode: ['python', 'code', 'script', 'udf', 'custom'],
  DynamicTransform: ['custom visual', 'shared transform'],
  Recipe: ['databrew', 'recipe', 'prepare'],
  PIIDetection: ['pii', 'mask', 'redact', 'sensitive', 'gdpr', 'anonymise', 'anonymize'],
  EvaluateDataQuality: ['dq', 'quality', 'rules', 'dqdl', 'assert', 'validate'],
  EvaluateDataQualityMultiFrame: ['dq', 'quality', 'rules', 'dqdl'],
  Route: ['branch', 'switch', 'conditional', 'split rows'],
  S3CsvSource: ['csv', 'comma', 'text', 'flat file'], S3JsonSource: ['json', 'ndjson'],
  S3ParquetSource: ['parquet', 'columnar'], S3ExcelSource: ['excel', 'xlsx', 'spreadsheet'],
  S3CatalogSource: ['catalog', 'table', 'glue table'], CatalogSource: ['catalog', 'table'],
  DirectKinesisSource: ['stream', 'streaming', 'kinesis'], DirectKafkaSource: ['stream', 'streaming', 'kafka', 'msk'],
  S3DirectTarget: ['write', 'output', 'sink', 'save', 's3'],
  S3GlueParquetTarget: ['write', 'parquet', 'output', 'sink'],
  S3CatalogTarget: ['write', 'catalog', 'table', 'sink'],
  AmazonRedshiftSource: ['redshift', 'warehouse'], AmazonRedshiftTarget: ['redshift', 'warehouse', 'write'],
  SnowflakeSource: ['snowflake'], SnowflakeTarget: ['snowflake', 'write'],
  DirectJDBCSource: ['jdbc', 'database', 'sql server', 'postgres', 'mysql', 'oracle'],
}

export const UI_NAME: Record<string, string> = Object.fromEntries(CATALOG.flatMap((f) => f.types))
export function uiName(type: string): string { return UI_NAME[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2') }
