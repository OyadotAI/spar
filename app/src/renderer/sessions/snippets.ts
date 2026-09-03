/**
 * Starters for an empty session.
 *
 * A REPL with a blank prompt is intimidating, and the first thing anyone wants from a Glue session
 * is the one thing the local container cannot do: read the real Data Catalog. Each snippet carries
 * its own imports, because `RunStatement` runs in a bare namespace — only `spark` and `sc` are
 * bound for you, not `glueContext`.
 */
export type Snippet = { label: string; hint: string; code: string }

export const SNIPPETS: Snippet[] = [
  {
    label: 'Catalog databases',
    hint: 'What this account can see, through the Glue Data Catalog',
    code: `spark.sql("SHOW DATABASES").show(50, truncate=False)`,
  },
  {
    label: 'Tables in a database',
    hint: 'Replace the database name',
    code: `spark.sql("SHOW TABLES IN default").show(50, truncate=False)`,
  },
  {
    label: 'Read a catalog table',
    hint: 'A DynamicFrame from the catalog — the same call a Glue job makes',
    code: `from awsglue.context import GlueContext

glueContext = GlueContext(spark.sparkContext)
df = glueContext.create_dynamic_frame.from_catalog(
    database="default", table_name="my_table",
).toDF()
df.printSchema()
df.show(20, truncate=False)`,
  },
  {
    label: 'Read S3 directly',
    hint: 'Parquet, CSV or JSON straight off a prefix',
    code: `df = spark.read.parquet("s3://my-bucket/my-prefix/")
df.printSchema()
print(df.count(), "rows")
df.show(20, truncate=False)`,
  },
  {
    label: 'Session facts',
    hint: 'Spark version, parallelism and where this is running',
    code: `print("Spark", spark.version)
print("executors", sc.getConf().get("spark.executor.instances", "?"))
print("parallelism", sc.defaultParallelism)`,
  },
  {
    label: 'Explain a query',
    hint: 'The physical plan, before you pay to run it',
    code: `spark.sql("SELECT 1 AS one").explain(True)`,
  },
]
