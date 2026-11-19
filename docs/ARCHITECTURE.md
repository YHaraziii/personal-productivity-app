# Architecture

## Overview

```
Browser                                              Supabase
┌───────────────────────────────────────────┐        ┌──────────────────────────────┐
│ React UI ──reads (live queries)──┐        │        │ Auth (e-mail + password,     │
│    │                             ▼        │        │       sign-up disabled)      │
│    └─writes─▶ Repo ──one txn──▶ IndexedDB │        │                              │
│                                 (Dexie)   │        │ PostgreSQL                   │
│                          rows + outbox    │        │  RLS on every table          │
│                                   │       │  HTTPS │  sync_push / sync_pull       │
│                     SyncEngine ◀──┘───────┼───────▶│  import_backup (1 txn)       │
│                                           │  RPC   │                              │
│ Service worker: offline app shell         │        └──────────────────────────────┘
└───────────────────────────────────────────┘
```

- **Local-first:** the UI never waits for the network. Every change is written to IndexedDB, in the **same transaction** as an entry in the durable *outbox*. The UI re-renders from IndexedDB through Dexie live queries.
- **The sync engine** pushes the outbox and pulls server changes. It runs after writes (debounced), on `online`, when the tab becomes visible, every 60 s, and with exponential back-off after failures.
- **The server is three PostgreSQL functions** called through Supabase's REST RPC endpoint. They run as the caller (`SECURITY INVOKER`), so RLS governs everything they do.

### Key dependencies

| Package | Role |
|---|---|
| `@supabase/supabase-js` | Auth session handling and RPC calls |
| `dexie`, `dexie-react-hooks` | IndexedDB access and live queries |
| `react-grid-layout` | Dashboard grid: card drag, resize, min/max sizes |
| `@dnd-kit/*` | Sortable lists for tasks and widgets, with keyboard support |
| `@tiptap/*` | Rich-text editor: StarterKit reduced to bold, italic, lists, links |
| `dompurify` | HTML allowlist sanitizer |
| `vite-plugin-pwa` | Service worker that precaches the app shell |
| `uuid` | Random v4 ids and deterministic v5 ids |

## Data model

All tables live in `public`. Every table has:

- `id uuid` primary key, generated on the client so it is stable across retries;
- `user_id`, set from `auth.uid()` by trigger and immutable;
- `version int`, incremented by trigger on every update;
- `created_at`, `updated_at` (set by trigger) and `deleted_at` (a tombstone).

| Table | Purpose | Notes |
|---|---|---|
| `groups` | Dashboard groups | Each concern is a separate column, so changing one never overwrites another:<br>• `name`, `description`, `color`, `icon`<br>• **group order** `sort_index`<br>• **position** `grid_x/grid_y`<br>• **size** `grid_w/grid_h` (CHECK 3–12 × 4–30)<br>• **expanded state** `collapsed`<br>• **task sort preference** `sort_field/sort_dir` |
| `tasks` | Tasks; one row per recurring occurrence | Fields:<br>• `due_date date` plus nullable `due_time time` (a date-only deadline has no time)<br>• `priority` (CHECK of 4 values)<br>• `completed_at`<br>• `manual_index` (manual order, never touched by automatic sorting)<br>• `series_id` and `occurrence_date`<br>`group_id` is immutable. |
| `subtasks` | Checklist items | `sort_index`, `completed` |
| `labels` | User labels | `name`, `color` |
| `task_labels` | Task ↔ label (many-to-many) | Deterministic id per pair; unique `(task_id, label_id)` |
| `recurrence_series` | A repeat rule plus the template for the next occurrence | `unit`, `interval_count`, `anchor_date`, template fields, and `ended_at` (set when the series is stopped) |
| `user_settings` | One row per preference key | Keys: `theme`, `priority_colors`, `widget_order`, `layout_mode`, `labels_seeded`. Each is versioned independently. |
| `applied_mutations` | Idempotency ledger | `(user_id, mutation_id)`; pruned after 90 days |
| `app_users` | Account allowlist | Not accessible to API roles |

**Integrity rules:**

- **Owner consistency:** child rows reference their parents through composite foreign keys on `(user_id, parent_id)`, so a child cannot point at another user's parent.
- **Cascading soft deletes:** triggers propagate a tombstone from a parent to its children with the *same* timestamp. Group → tasks and series; task → subtasks and label links; label → label links.
  - Restoring a parent restores exactly the children that were deleted with it.
  - A child created while its parent is deleted is born deleted.
  - Hard deletes only happen when the auth user is deleted, through the `ON DELETE CASCADE` foreign keys.
- **Indexes:**
  - `(user_id, updated_at)` on every table, for incremental pull;
  - parent-id indexes;
  - a partial index for open tasks by due date.

**Time semantics.** Deadlines are *floating local* values, a calendar date plus
an optional wall-clock time, interpreted in the viewer's current time zone.
Date arithmetic is done on calendar fields, never by adding milliseconds, so
daylight-saving changes cannot move a date. Overdue rules:

- a date-only task is overdue from the next day;
- a timed task is overdue from its local instant (the browser resolves DST gaps and overlaps).

Timestamps such as `created_at` and `completed_at` are real instants (`timestamptz`).

## Sync protocol

**Outbox entry:** `{mutation_id, table, op, row_id, payload, base}`.

- `insert`: the full row.
- `update`: only the changed columns, plus the value each had before the edit (`base`). Repeated edits to one unsent row are folded into a single entry, and an edit undone before sending disappears.
- `delete`: a soft delete.

**Push** (`sync_push`): mutations are sent in order, in batches of up to 200. Each runs in its own sub-transaction.

1. A `mutation_id` already in `applied_mutations` → `duplicate`. The previous result stands, which is what makes retries idempotent.
2. `insert` with an existing id → `exists`. This is not an overwrite.
3. `update` or `delete` → applied only if the row's current `version` equals the version the client last saw. Otherwise the server returns `conflict` along with the current row.

**Client handling of `conflict`:**

- The server changed *other* columns only → rebase onto the server row and resend. This is not shown to the user.
- The server already has the same value → nothing to do.
- **The same column was changed to different values**, or the row was deleted on one side and edited on the other → the entry is parked with status `conflict`. Both versions are kept: the local one in the row and outbox payload, the server's in `server_row`.
  - The row is held back, along with any later edits to it.
  - The conflict stays visible under **Needs review** until the user decides: keep mine, keep the server's, or choose per field.
  - The resolution is pushed like a normal edit, version-checked again. If the server changed yet again, a new conflict is raised instead of overwriting.
- Completion and deletion are compared as states (done or not done, deleted or not), not by their exact timestamps, so two devices completing the same task do not conflict.

**Pull** (`sync_pull(since)`): returns every row changed since the cursor, including tombstones. The cursor overlaps by 10 s, so rows from transactions still in flight are not missed; re-applying an unchanged row is a no-op.

- Rows with no queued local change are stored as received.
- Rows with queued edits are merged, keeping local edits on top. An overlap becomes a parked conflict.
- A full pull (first sync, or after an import) also removes local rows the server does not have, unless a queued change still refers to them.

**Failure handling. Nothing is ever dropped silently:**

- network failure → entries go back to `pending`, with exponential back-off;
- page closed mid-request → `inflight` entries are reset on the next start; resending is safe because of mutation ids;
- server rejection (constraint violation) → `error` status. The entry is retried up to 3 times, then held and shown under **Sync issues**, and only removed by an explicit, confirmed **Discard**.

**Save status:** "Saved" is shown only when the outbox is empty, meaning every change has been confirmed by the server.

**Why timestamps are not enough:** conflicts are detected with server-assigned row versions plus a per-column comparison against `base`, never by "latest timestamp wins". Device clocks never influence which data survives.

## Recurrence

A series stores `(unit ∈ day|week|month, interval_count, anchor_date)` and a
template (title, notes, priority, time, labels, checklist). Each occurrence is
an ordinary task row with `series_id` and `occurrence_date`.

**Schedule.** Occurrence *k* falls on:

- `day`: `anchor + k·n` days;
- `week`: `anchor + 7·k·n` days (same weekday);
- `month`: the anchor's day-of-month, `k·n` months later, **clamped to the last day of the month**.

Dates are always derived from the anchor, so Jan 31 → Feb 28 → Mar 31.

**Completing an occurrence** sets its `completed_at`. That row *is* the completion history. It then ensures the next occurrence exists:

- **Next date** = the first scheduled date after both the completed occurrence and today. Missed occurrences are skipped, and a long absence creates exactly one new occurrence, never a backlog.
- **Idempotency:** the next occurrence's id is `uuidv5("task:<previous id>:next")`.
  - Completing twice, reopening and completing again, retrying a request, or completing on two devices offline all derive the *same* id.
  - The server ignores the second insert; the second device adopts the server's row.
  - So the schedule can never advance twice, and duplicates are impossible.
- **Reopening** only clears `completed_at`. The next occurrence that was already created stays.

**Editing.**

- *This occurrence only* changes that task row. The series rule and template are untouched.
- *This and future occurrences* updates the template. If the repeat rule or this occurrence's date changed, the series is re-anchored on this occurrence; otherwise the original anchor is kept, which preserves "the 31st". Other open, later occurrences take the new template. **Completed occurrences are never rewritten.**
- Removing the repeat stops the series (`ended_at`). The task remains.

**Deleting.**

- *Only this occurrence* deletes it. If it was open, the next occurrence is created, so the series continues.
- *This and all open occurrences* stops the series and deletes all open occurrences. Completed ones are kept as history.

## Import

`import_backup(payload, mode)` runs as a single statement, so it is a single transaction:

1. It validates the format and version, record shapes, duplicate ids and relationships.
2. It checks that every id is either new or already owned by the caller.
3. It upserts parents before children. In replace mode it also tombstones whatever the backup lacks.

Any error rolls back everything. The client validates first, independently (types, bounds, rich-text sanitizing), and the database repeats the structural checks, because imported data is never trusted.

- **Replace mode:** the backup's rows overwrite existing ones, and live rows absent from the backup are soft-deleted.
- **Merge mode:** existing live rows win, missing rows are added, and deleted rows are restored. Labels are matched by name (client side), so merging never creates two labels with the same name.

The import requires a connection and an empty outbox, so queued offline edits can never be silently mixed with or lost under imported data.

## Security summary

- **Data protection is in the database:**
  - RLS on every table (owner plus allowlist);
  - no `anon` privileges at all;
  - no hard delete for signed-in users;
  - immutable ownership and parent ids;
  - invoker-rights RPCs.
- **Browser bundle:** contains only the public anon key. The app refuses to start with a secret key, and CI refuses to publish one.
- **Rich text:**
  - Allowed tags: `p br strong b em i ul ol li a`.
  - Links must be `http(s)` or `mailto`, and get `target=_blank rel="noopener noreferrer nofollow"`.
  - Sanitized on save, on import and on every render.
- **Production CSP:** `script-src 'self'`; `connect-src` is limited to the site and the Supabase project.
- **CSV:** cells are neutralized against formula injection.
- **Logging:** errors are logged by category only. Task content, tokens and credentials are never logged.
