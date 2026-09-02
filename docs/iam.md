# IAM, simplified

Keel asks for three small policies instead of one large one, and enforces them locally.

| Tier | What it allows | Default |
|---|---|---|
| **Read** | `glue:Get*`/`List*`/`BatchGet*`, CloudWatch logs and metrics, `s3:GetObject`/`ListBucket`, `sts:GetCallerIdentity` | always on |
| **Author** | create/update/delete jobs, triggers, connections, entities, profiles, rulesets; `s3:PutObject` | off |
| **Operate** | start and stop runs, reset bookmarks, interactive sessions, `iam:PassRole` | off |
| **Live events** | the SQS queue and EventBridge rules behind push updates | off |
| **Grant the job role its logs** | `iam:PutRolePolicy` for the observability grant | off |

Two things make this more than a settings page.

**The daemon enforces it.** One interceptor (`aws/Access.java`) maps a request's method and path to
the tier it needs and refuses it with a 403 that says which switch to turn on — before any AWS
client is built. A read-only install cannot mutate an account even with credentials that would
allow it. Everything local (the DAG, code generation, tests, previews, local runs, samples, the
engine) is never gated, because none of it touches an account.

**Preflight.** `GET /api/aws/preflight` asks `iam:SimulatePrincipalPolicy` about every action in
every tier and reports, per tier, what is denied and **which features that takes away** — "Logs for
a run", "Deploy", "Interactive sessions". When simulation is itself denied, the answer is
`unknown`, never a guess. This turns "it failed after four minutes" into "these three actions are
missing".

`GET /api/aws/policy?tier=…` generates the policy for the account, region and buckets actually in
use, as JSON, Terraform or CloudFormation. A policy full of wildcards is a policy nobody reads
before pasting.
