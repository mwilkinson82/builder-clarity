## Capability: apply one named migration file at a pinned commit

**Documentation only.** No repo reads, no DB reads, no edits, no deploy performed for this check.

### Can I do it?
Yes, via `supabase--migration`, which is the only Lovable path that writes `supabase_migrations.schema_migrations`. One tool call = one transaction = one ledger row (or none, on failure).

### Operator prompt I require (all five)
1. Exact repo path under `supabase/migrations/`.
2. Full 40-char Git commit SHA to read the file at.
3. Explicit "apply as-is, do not modify, do not stack" authorization.
4. Confirmation the file is self-contained (no companion files, no manual pre/post steps).
5. Acknowledgement of the failure policy: abort → no ledger row → stop, no retry, no partial reapply, no edits, until you say otherwise.

Missing any of the five → I will not run it.

### Execution
- Tool: `supabase--migration`, SQL passed as a single `query`.
- Atomicity: single transaction; all-or-nothing; ledger row written only on full commit.
- Approval gate: the tool surfaces the SQL to you before execution.

### Fields I can return on success
- `version` (assigned by the tool at invocation time — generally NOT equal to the file's own timestamp prefix).
- Generated migration name recorded alongside the version.
- `created_by` as recorded by Cloud (agent/Lovable actor; no per-human operator identity).
- Statements count (parsed from the file; ledger `statements` array can be echoed via a follow-up read of `supabase_migrations.schema_migrations`).
- Provenance I add explicitly: repo path, pinned commit SHA, SHA-256 of the exact SQL text submitted.

Cannot return: a `version` matching the file's own prefix, or a GitHub-identity `created_by`.

### Failure reporting
- Transaction rolls back; no ledger row.
- I report: Postgres error message/code, failing statement index if surfaced, submitted SHA-256, pinned commit + path, and "NOT APPLIED — no ledger row written; awaiting operator instruction."
- I will not retry, edit SQL, split the file, or apply a variant.

### Raw query connector ledger behavior
`supabase--read_query` and any direct/raw SQL path do NOT insert into `supabase_migrations.schema_migrations`. Only `supabase--migration` writes the ledger. Raw-query application would change the database while leaving the ledger silent — the exact drift the release gate exists to catch.

### Next step
When you open a real window, reply with the five operator-prompt items and I'll queue the migration for your approval.
