# Backup format (version 1)

A backup is a UTF-8 JSON file:

```jsonc
{
  "format": "ppd-backup",          // required, identifies the file type
  "version": 1,                    // required, integer format version
  "exported_at": "2026-10-27T15:04:05.000Z",
  "app_version": "1.0.0",
  "data": {
    "groups": [ … ],
    "labels": [ … ],
    "recurrence_series": [ … ],
    "tasks": [ … ],
    "subtasks": [ … ],
    "task_labels": [ … ],
    "settings": { … }
  }
}
```

The backup contains no user id, e-mail address, password, session token or API key.
Deleted records are not exported.

## Records

All ids are UUIDs. Dates are `YYYY-MM-DD`, times are `HH:MM:SS` (local wall clock),
instants are ISO-8601 strings.

| Section | Fields |
|---|---|
| `groups` | `id`, `name` (1–120), `description`, `color` (`#rrggbb`), `icon`, `sort_index` (group order), `collapsed`, `grid_x`, `grid_y` (null = never placed), `grid_w` (3–12), `grid_h` (4–30), `sort_field` (`manual\|title\|due\|label\|priority`), `sort_dir` (`asc\|desc`), `created_at` |
| `labels` | `id`, `name` (1–60), `color`, `created_at` |
| `recurrence_series` | `id`, `group_id`, `unit` (`day\|week\|month`), `interval_count` (1–365), `anchor_date`, `title`, `description` (HTML), `priority`, `due_time`, `label_ids` (array), `subtasks` (array of texts, the checklist template), `ended_at` (null while active), `created_at` |
| `tasks` | `id`, `group_id`, `title` (1–300), `description` (sanitized HTML), `priority` (`low\|medium\|high\|urgent`), `due_date`, `due_time` (requires `due_date`), `completed_at`, `manual_index` (manual order), `series_id`, `occurrence_date` (required when `series_id` is set), `created_at` |
| `subtasks` | `id`, `task_id`, `text` (1–500), `completed`, `sort_index`, `created_at` |
| `task_labels` | `task_id`, `label_id` |
| `settings` | Object keyed by setting name: `theme`, `priority_colors`, `widget_order`, `layout_mode`, `labels_seeded` |

The occurrence history of a recurring series is the set of `tasks` that share its
`series_id`. Completed ones have `completed_at` set.

Optional fields may be omitted; defaults are applied. These defaults are:

- `grid_w` 4 and `grid_h` 8;
- `sort_field` `due` and `sort_dir` `asc`;
- `priority` `medium`.

## Validation on import

The whole file is checked before anything changes:

- the format and supported version;
- that each section is a list of objects;
- field types and limits;
- valid calendar dates;
- duplicate ids;
- that all references point to records in the same file.

Rich text is re-sanitized. Unknown settings are ignored, with a warning.

The database then repeats the structural checks inside a single transaction, and
rejects ids that belong to another account. A failure changes nothing.

## Compatibility

Files with a `version` newer than the app supports are rejected with a message
asking you to update the app. When the format changes, `BACKUP_VERSION` is
increased and `migrate()` in `src/lib/backup.ts` converts older files, so old
backups keep working.
