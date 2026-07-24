# Read-only release preflight — restore-point availability

**Scope:** Evidence gathering only at source SHA `1ba90d3416718c175a6ce98b406606e23d8b3cc0`. No code edits, no SQL, no migration, no deploy, no backup creation.

## Finding

**No restore point, snapshot, or PITR timestamp is confirmed through Lovable's connected tools.**

## Evidence gathered (read-only)

- `supabase--project_info` — returns project ref (`ehotrggjfkxejktsgdor`), instance size (Tiny), region pooler host, paused=false. **No backup/snapshot/PITR fields exposed.**
- `supabase--cloud_status` — `ACTIVE_HEALTHY`. **No backup metadata surfaced.**
- `supabase--db_health` — DB up, PgBouncer up, 202.6 MB, WAL 128.0 MB, 0 restarts since boot. **No backup catalog, snapshot ID, WAL-archive horizon, or PITR earliest/latest recovery timestamp.**

No other connected tool (`supabase--read_query`, `analytics_query`, `slow_queries`, `linter`, `migration`, `restart`, `pause/resume`) exposes a backup listing, snapshot identifier, or PITR window. There is no `supabase--list_backups` / `restore_point` / `pitr_status` capability in the Lovable-Supabase connector surface available to this agent.

## Exact limitation

The Lovable agent's Supabase connector does **not** expose the Supabase Platform Backups API (`GET /v1/projects/{ref}/database/backups`) or any PITR status endpoint. Restore points, daily physical backups, and PITR earliest-recovery timestamps live in the Supabase Platform control plane and are only visible to a caller holding a Supabase Management API token for this project — which the Lovable agent does not hold and cannot mint. Lovable Cloud additionally hides the Supabase dashboard from end users, so I cannot direct you to a UI path either.

Instance size is **Tiny**. On Supabase's stock plan matrix, Tiny/Free-tier projects historically do not have PITR enabled by default (PITR is a paid add-on that requires a larger compute add-on). I cannot confirm the current add-on state from any tool I have; treat this only as a reason to verify, not as a conclusion.

## What would count as confirmation (not performed)

Any of the following, obtained out-of-band by an operator with platform access, would satisfy the preflight:

1. Supabase Management API: `GET https://api.supabase.com/v1/projects/ehotrggjfkxejktsgdor/database/backups` — returns `physical_backup_data.earliest_physical_backup_date_unix` / `latest_physical_backup_date_unix` plus the `backups[]` array with `inserted_at` timestamps and `status`.
2. Supabase Studio → Project Settings → Database → Backups: the most recent daily backup timestamp and, if PITR is enabled, the earliest recoverable timestamp.
3. A manually created logical dump (`pg_dump`) captured immediately before the batch, with its file path/checksum recorded.

## Recommendation for the maintenance window

Do not open the Auth P0 window until one of (1)–(3) is captured and its identifier + UTC timestamp is recorded in the release log alongside SHA `1ba90d34…`. Per `docs/RELEASE_GATE.md` §6 step 2 ("Snapshot and inventory through Lovable"), a platform-approved snapshot is a precondition to step 5 (applying the six migrations), and this agent cannot produce or verify that snapshot from inside Lovable.

## Nothing changed

No files were read for edit, no SQL executed, no migration queued, no restart or backup issued.
