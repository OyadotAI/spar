import { describe, expect, it } from 'vitest'
import { parseDiff, totals } from '@/shell/diff'

// captured from `git diff --cached HEAD` in a real lane, not written from memory
const SAMPLE = `diff --git a/jobs/orders/job.py b/jobs/orders/job.py
index 83db48f..bf26953 100644
--- a/jobs/orders/job.py
+++ b/jobs/orders/job.py
@@ -12,7 +12,8 @@ def only_paid(glueContext, map_orders):
     """Filter: Only paid"""
-    return Filter.apply(frame=map_orders, f=lambda row: row["status"] == "paid")
+    return Filter.apply(frame=map_orders,
+                        f=lambda row: (row["status"] == "paid") and (row["amount"] > 0))
 
 def join_customers(glueContext, only_paid, customers_csv):
diff --git a/jobs/orders/tests/test_only_paid.py b/jobs/orders/tests/test_only_paid.py
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/jobs/orders/tests/test_only_paid.py
@@ -0,0 +1,2 @@
+def test_only_paid_drops_unpaid():
+    assert True
`

describe('unified diff', () => {
  const files = parseDiff(SAMPLE)
  it('splits into files and keeps the new path', () => {
    expect(files).toHaveLength(2)
    expect(files[0]!.path).toBe('jobs/orders/job.py')
    expect(files[1]!.path).toBe('jobs/orders/tests/test_only_paid.py')
  })
  it('knows a file the agent created from one it edited', () => {
    expect(files[0]!.status).toBe('modified')
    expect(files[1]!.status).toBe('added')
  })
  it('counts what changed', () => {
    expect(files[0]!.adds).toBe(2)
    expect(files[0]!.dels).toBe(1)
    expect(totals(files)).toEqual({ adds: 4, dels: 1 })
  })
  it('numbers both sides so a line can be found in the editor', () => {
    const del = files[0]!.lines.find((l) => l.kind === 'del')!
    const add = files[0]!.lines.find((l) => l.kind === 'add')!
    expect(del.a).toBe(13)
    expect(add.b).toBe(13)
  })
  it('keeps the hunk heading, which names the function', () => {
    expect(files[0]!.lines[0]).toEqual({ kind: 'hunk', text: 'def only_paid(glueContext, map_orders):' })
  })
  it('survives an empty diff and a binary one', () => {
    expect(parseDiff('')).toEqual([])
    const bin = parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n')
    expect(bin[0]!.binary).toBe(true)
    expect(bin[0]!.lines).toEqual([])
  })
})
