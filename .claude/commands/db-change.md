Author a Supabase schema/policy change as an idempotent SQL doc following the house pattern (docs/ai-factory/single-line-groups.sql). Trigger: any new table, column, index, or RLS policy a feature needs. The SQL doc is the deliverable — it is applied by hand in the Supabase SQL editor, so it must be safe to run twice.

## Input

$ARGUMENTS — what the change is for (feature, table name, columns/shape, who may read/write). If ownership semantics differ from owner-only, say so explicitly.

## House pattern (mirror single-line-groups.sql)

| Element | Rule |
|---|---|
| Table | `create table if not exists public.<name>` with `id uuid primary key default gen_random_uuid()`, `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`, `created_at`/`updated_at timestamptz not null default now()` |
| Payload | Prefer one `jsonb` payload column over wide scalar columns for tool documents |
| Indexes | `create index if not exists <name>_user_idx on … (user_id, updated_at desc)`; unique indexes for app-level invariants (e.g. one name per user) |
| RLS | `alter table … enable row level security` always |
| Policies | Idempotent drop-then-create, all four verbs (`select`/`insert`/`update`/`delete`), owner-only via `auth.uid() = user_id`; `update` gets both `using` and `with check` |
| Verification | End the doc with the commented `pg_policies` query for the table |

## Process

1. **Read the pattern file** (docs/ai-factory/single-line-groups.sql) and the feature's client code (`lib/**/saved-models.ts` or equivalent) so column names match what the browser client reads/writes.
2. **Write the SQL doc** under `docs/<area>/<table>.sql` with a header comment: what it's for, which lib module uses it, and "Apply in the Supabase SQL editor".
3. **Prove idempotence by inspection**: every statement is `if not exists`, `drop … if exists` + `create`, or otherwise safe to re-run. A partial first run followed by a full re-run must converge. No `drop table`; destructive migrations require an explicit, separate conversation with Eric.
4. **Apply** only if Eric asks; otherwise hand him the doc. After applying, run the doc's pg_policies verification query and confirm exactly the expected policies exist (a missing SELECT policy is the classic "saved but can't load back" bug).
5. **Wire-up check**: the consuming lib module compiles against the shape (`npm run type-check`) and, if the table is live, a signed-in save→reload round-trip works in the running app.

## Acceptance

SQL doc exists under docs/, re-runnable end to end, RLS enabled with the four owner-only policies, verification query included; type-check green.

## Guardrails
- RLS is never optional — a table without policies is a data leak, not a shortcut.
- Never widen policies beyond owner-only without Eric's explicit sign-off in $ARGUMENTS.
- The doc is source-controlled truth; don't apply undocumented SQL in the dashboard.
