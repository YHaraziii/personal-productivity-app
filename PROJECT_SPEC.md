# Comprehensive Development Prompt: Personal Productivity Dashboard

## 1. Project objective

Build a complete, production-minded, desktop-first personal productivity website for managing tasks across customizable groups.

The website must let me organize different areas of my life and work, such as school, personal projects, research, and podcast activities. Each group contains its own tasks and appears as a customizable, expandable card on a dashboard.

The application must be fully functional, hosted online, persistent across sessions, and private to my account. It must support offline editing, reliable synchronization, recurring tasks, advanced customization, and data export/import.

**This is an implementation task, not a request for a mockup or a demonstration.** Build the complete application in one implementation pass, following a clear internal development plan. Do not stop after scaffolding the project or creating a visually attractive but nonfunctional interface.

## 2. Development principles

- Use an architecture that is straightforward to understand, maintain, and extend.
- Choose suitable, actively maintained libraries compatible with the approved stack.
- Document major architectural and dependency decisions.
- Keep the approved stack unless a necessary change is explained and justified.
- Prefer reliable, well-tested solutions over unnecessary complexity.
- Implement the requested features instead of replacing them with placeholders.
- Do not silently omit difficult requirements. Document any genuine limitation and provide the best secure alternative.
- Do not claim that tests passed, deployment succeeded, or features work unless the corresponding results have actually been verified.
- Preserve all user data and settings across reloads, sign-ins, and deployments.

## 3. Technology stack and deployment

### Preferred stack

- **Frontend:** React with TypeScript.
- **Build tooling:** Vite or an equivalent lightweight, well-supported toolchain.
- **Backend and database:** Supabase with PostgreSQL.
- **Authentication:** Supabase Auth or an equivalent secure provider-managed solution if a justified architectural change is necessary.
- **Hosting:** GitHub Pages for the frontend, if compatible with the final authentication and routing architecture.
- **Source control:** A GitHub repository owned by me.
- **Styling:** A maintainable CSS approach or component system that supports custom themes, colors, layout, and responsive desktop sizing.
- **Testing:** An appropriate unit/component testing framework and browser-level testing tools where practical.

Choose suitable libraries for drag-and-drop, rich-text editing, resizing, and offline persistence. Avoid adding multiple libraries that duplicate the same functionality.

### Free-tier requirements

- Prefer services with free tiers and no mandatory recurring subscription.
- Explain any usage limits, inactivity restrictions, quotas, or potential charges that could affect operation.
- Do not assume that a free tier guarantees permanent availability or unlimited storage.
- Do not require a paid service for a core feature if a practical free alternative exists.
- Never embed privileged database credentials, service-role keys, or other secrets in frontend code.
- Include a `.env.example` containing variable names and safe placeholders only.
- Ensure that deployment can be repeated from the repository using documented instructions.

### GitHub ownership and deployment

Create a project structure suitable for a repository I own. Provide instructions for pushing the code to GitHub, configuring the required services, setting environment variables, deploying the frontend, and verifying the live application.

GitHub Pages is a static host. If its routing, authentication callbacks, or other limitations make the required application unreliable, explain the issue and recommend an appropriate free-tier alternative. Do not compromise access controls to force an unsuitable deployment method.

## 4. Authentication, privacy, and account provisioning

The website has a public URL but private application data.

### Required behavior

- Sign in using email and password.
- Disable public registration.
- Provision my initial account through a secure setup process.
- Allow users to remain signed in between visits until they explicitly log out, subject to secure session handling.
- Provide a clear sign-out action.
- Protect all authenticated application routes.
- Show appropriate loading, error, and signed-out states.
- Do not implement a password-reset feature.
- Never hardcode passwords or authentication credentials.

### Authorization

Security must be enforced on the backend, not merely through hidden buttons or frontend route guards.

For Supabase, configure Row Level Security (RLS) policies on every private table. Every query and mutation must be constrained to the authenticated user's authorized data.

- Users must not be able to read, modify, export, or delete another user's data.
- A user must not be able to change ownership fields to gain access to another account.
- Related records must be protected consistently.
- Do not expose service-role keys to the browser.
- Apply authorization to imports, exports, recurring-task generation, and any backend operations.
- Document how the initial account is created without opening public registration.

Verify the security design before deployment. The fact that the site URL is public must never make task data public.

## 5. Application layout and dashboard

### Initial experience

- The first login opens an empty dashboard.
- Do not automatically populate example groups or tasks.
- Provide an obvious way to create the first group.
- Display helpful empty states explaining how to get started.

### Main dashboard

The dashboard is the primary and only main task-management view. Do not make a separate calendar, Kanban board, or global all-task list a required feature.

Include three summary widgets:

1. Due Today
2. Overdue
3. Upcoming Deadlines

Each widget must be interactive. Selecting one should help me find the relevant tasks, not merely display a number.

The widgets must be rearrangeable. Their arrangement should persist across refreshes and sign-ins.

### Group cards

Each group represents an independent area of work.

Groups must support:

- Creating, renaming, editing, and deleting groups.
- An optional description.
- A customizable card color.
- A customizable icon or emoji.
- Expanding and collapsing.
- Persistent expanded/collapsed state.
- Reordering using drag-and-drop.
- Move Up and Move Down controls as alternatives to drag-and-drop.
- Flexible dashboard placement and manually adjustable card sizes.
- Confirmation before deletion.

Deleting a group must display a clear warning that all tasks, checklists, and associated records in that group will also be deleted. Require explicit confirmation before proceeding.

Include Expand All and Collapse All controls if they can be implemented cleanly. Persist individual group states and handle these bulk controls consistently.

### Dashboard customization

Create a flexible grid-based dashboard that supports:

- Dragging and rearranging group cards.
- Manually resizing cards.
- Rearranging summary widgets.
- Saving layout settings.
- Restoring the layout after refresh and sign-in.

Use sensible minimum and maximum card sizes to prevent unusable layouts. The dashboard must remain usable at different desktop resolutions, without requiring mobile optimization as a core deliverable.

Keep group order, dashboard position, widget order, card dimensions, and task sort preferences as distinct settings. Changing one must not accidentally overwrite another.

## 6. Visual design and themes

Create a polished, colorful, modern productivity interface with balanced visual density.

The interface should feel cohesive, practical, and refined rather than overly decorative.

Implement:

- Light mode and dark mode.
- Several built-in theme presets.
- Customizable theme colors.
- Custom group colors and icons.
- Color-coded labels.
- Color-coded priority levels.
- Clear visual distinction between active, completed, overdue, and upcoming tasks.
- Consistent spacing, typography, borders, and interaction states.
- Accessible contrast and visible keyboard focus.
- Clear confirmation dialogs and useful error messages.

Theme selections and customization must persist across visits.

Do not rely on color alone to communicate priority or status; always include readable text or another clear indicator.

## 7. Task management

Every task belongs to exactly one group. Tasks cannot be moved between groups.

### Task fields

Each task should support:

- Unique identifier.
- Title (required).
- Description or notes with basic rich-text formatting.
- One or more labels.
- Priority.
- Due date.
- Optional due time.
- Completion status.
- Creation date/time.
- Completion date/time, when applicable.
- Checklist subtasks.
- Recurrence settings, if recurring.
- Ordering and sorting metadata.
- Update timestamps for synchronization and conflict detection.

Use readable dates in the interface, such as `Oct 27, 2026`. Interpret dates and optional times according to the user's local time zone, and handle daylight-saving transitions correctly.

A task with a date but no time is a date-only deadline. Do not silently assign it an arbitrary time of day.

### Task creation and editing

Use a full task-creation form rather than a title-only quick-add workflow.

The form must let me enter the task title, description, due date/time, priority, labels, subtasks, and recurrence options as applicable.

Implement:

- Create, view, edit, and delete.
- Completion and reopening.
- Confirmation before destructive actions.
- Validation and clear feedback for invalid inputs.
- Saving indicators.
- Preservation of unsaved changes during transient connectivity failures.
- Keyboard-accessible controls.

Use a rich-text editor that supports bold text, bullet lists, and clickable links. Sanitize rich-text content and validate URLs to prevent script injection and unsafe links.

### Task completion

Completed tasks must remain visible in their original groups and appear with strikethrough styling. Do not automatically hide or delete completed tasks.

- Completing a task records its completion date/time.
- Reopening a task clears or updates its current completion state appropriately.
- A completion checkbox can be toggled off to reopen a task.
- Reopening a recurring occurrence must be handled without accidentally corrupting the recurrence schedule.
- Completed tasks must remain available for export.

### Priorities

Use exactly four priority levels:

- Low
- Medium
- High
- Urgent

Allow customization of each level's color, but do not require users to create additional priority levels.

### Labels

- Support multiple labels per task.
- Provide sensible default labels.
- Allow custom labels and custom label colors.
- Allow users to apply, remove, rename, and recolor labels.
- Make labels available in task forms, filters, and exports.
- Ensure label renames and deletions do not leave broken task references.

### Subtasks

Subtasks are simple checklist items with independent completion checkboxes.

- Add, edit, reorder, and delete checklist items.
- Preserve their order.
- Show checklist progress where useful.
- Checking all subtasks must **not** automatically complete the parent task.
- The parent task must be completed separately.

## 8. Sorting and manual ordering

Each group supports manual ordering and automatic sorting.

Automatic sorting must support ascending and descending order by:

- Title.
- Due date.
- Label.
- Priority.

### Default sorting

New groups default to due date, earliest first.

Tasks without a due date must be handled consistently and documented. Prefer placing undated tasks after dated tasks in due-date sorting.

### Preserve manual order

Maintain manual task order separately from automatic sorting.

When I switch from automatic sorting back to manual mode, restore the previously saved manual order. Automatic sorting must not overwrite it.

Define predictable tie-breakers for tasks with identical sort values. Avoid unstable ordering between refreshes.

Group order and task order are separate. Sorting tasks must never reorder the dashboard's groups.

## 9. Search and filtering

Provide global search and filters on the dashboard.

Search must examine:

- Task titles.
- Task descriptions.
- Checklist item text.

It does not need to search labels or unrelated group descriptions.

Provide filters for:

- Priority.
- Label.
- Due date.
- Group.
- Completion status.

Allow relevant filters to be combined and provide a clear way to reset them.

Search and filter state should reset when starting a new visit. Do not permanently store stale filters that unexpectedly hide tasks after the user returns.

Ensure summary widgets and filtering work together predictably. A task should appear in results only when it matches the active criteria.

## 10. Recurring tasks

Support these recurrence types:

- Daily.
- Weekly.
- Monthly.
- Custom intervals, such as every two weeks.

The interface must make the recurrence schedule understandable and editable.

### Completion behavior

Completing a recurring task must:

1. Mark the current occurrence complete.
2. Preserve its completion history.
3. Create or schedule the next occurrence with its appropriate due date.
4. Keep the recurrence schedule associated with the task series.
5. Prevent duplicate future occurrences if the completion operation is retried.

### Missed occurrences

Skip missed occurrences and schedule the next future occurrence rather than creating an unlimited backlog of overdue instances.

Define and document how the next future date is calculated for each recurrence type. A recurrence must not generate multiple duplicate occurrences after a long period offline.

### Monthly dates

If a monthly task is scheduled on a day that does not exist in a particular month, use the last day of that month.

For example, a task scheduled for the 31st should fall on the 30th in a 30-day month and on the last day of February.

Preserve the intended recurrence rule when calculating subsequent occurrences.

### Editing recurring tasks

When editing a recurring task, ask whether to apply the changes to:

- This occurrence only.
- This occurrence and future occurrences.

Changes to a single occurrence must not unexpectedly modify the entire recurrence series.

Deleting a recurring task must explain the scope of the deletion and require confirmation.

Define how edits to a series affect existing future occurrences and how past completed occurrences are preserved. Avoid rewriting historical completion records when changing a recurrence schedule.

### Recurrence and offline synchronization

Ensure that recurrence generation is idempotent. A synchronization retry must not create duplicate tasks or advance the recurrence schedule twice.

## 11. Saving, offline mode, and synchronization

The application must support offline edits, not just offline viewing.

Use a reliable local persistence mechanism such as IndexedDB. Do not rely solely on transient component state or a temporary in-memory queue.

### Save status

Show clear save states, including:

- Saving…
- Saved
- Pending sync / Offline
- Sync failed

Do not display Saved until the server confirms persistence.

Local-only changes must be clearly distinguished from changes confirmed by the server.

### Offline behavior

When offline:

- Allow creating, editing, completing, reopening, and deleting tasks where local data is available.
- Allow supported group and customization changes.
- Persist edits locally.
- Queue mutations for synchronization.
- Display a pending-sync indicator.
- Preserve pending edits across refreshes and browser restarts.
- Retry synchronization when connectivity returns.
- Never silently discard queued changes.

If an operation cannot safely be completed offline, explain why and preserve the user's input.

### Conflict handling

Detect conflicts when local changes overlap with newer server changes.

Do not blindly overwrite newer server data or automatically choose the latest timestamp without understanding the conflict.

When a conflict occurs:

- Preserve both versions where practical.
- Identify the affected task or setting.
- Show enough information for the user to understand the competing changes.
- Let the user choose which version to keep, or explicitly reconcile the changes.
- Keep the unresolved conflict visible until resolved.
- Retry synchronization after resolution.

Use stable IDs, versioning or equivalent concurrency controls, and idempotent operations. Ensure deletion and recurrence operations are also safe to retry.

Do not assume timestamps alone are sufficient to prevent data loss.

### Data integrity

A failed request, browser reload, or temporary network outage must not silently erase locally queued changes.

Document the limitations of the selected offline approach. If browser storage is cleared or the device is lost before pending edits synchronize, explain the risk honestly rather than promising impossible recovery.

## 12. Data export and import

Provide manual export and import functionality. Automatic backups are not required.

### JSON export

Provide a full JSON backup containing everything needed to reconstruct the application state, including:

- Groups and their ordering.
- Tasks and their ordering.
- Descriptions and rich-text content.
- Completion status and completion history.
- Due dates and times.
- Labels and their colors.
- Priority settings and colors.
- Subtasks.
- Recurrence definitions and relevant occurrence history.
- Theme and appearance settings.
- Dashboard layout, widget positions, and card sizes.
- Expanded/collapsed group state.
- Relevant user-level preferences.

Use a documented, versioned export format so future application versions can validate or migrate older backups.

Do not export authentication credentials, passwords, session tokens, or service secrets.

### JSON import

Allow the user to choose between:

1. **Replace:** Replace the current application data with the imported backup.
2. **Merge:** Combine imported data with existing data.

Require explicit confirmation before replacing data.

Validate the imported file before changing the database. Handle malformed JSON, unsupported versions, duplicate IDs, missing fields, and invalid relationships gracefully.

A failed import must not leave the database partially overwritten. Use transactional operations where supported, or an equivalent safe import strategy.

Define merge rules for duplicate IDs and conflicting records. Avoid accidental duplication of recurring occurrences, groups, and tasks. Explain the merge result to the user.

Never trust imported data merely because it was generated by this application.

### CSV export

Provide a CSV export of **all tasks across all groups in one file**, regardless of active search or filters.

Include at least:

- Task ID.
- Task title.
- Group name.
- Description.
- Completion status.
- Due date.
- Due time, when present.
- Priority.
- Labels.
- Creation date.
- Completion date.
- Recurrence information.
- Subtask information, where a practical, documented representation is possible.

Use consistent headers, escaping, and encoding. Ensure commas, quotation marks, and line breaks in user content do not corrupt the file.

Prevent spreadsheet formula injection when exporting user-controlled text. Clearly document which complex data, such as rich-text formatting and nested subtasks, cannot be represented perfectly in CSV. JSON remains the full-fidelity backup format.

## 13. Data model and database design

Design a normalized PostgreSQL schema that supports the required features without unnecessary duplication.

The schema will likely need tables or equivalent structures for:

- User-owned groups.
- Tasks.
- Checklist subtasks.
- Labels.
- Task-label relationships.
- Recurrence series and occurrence history, or a carefully documented equivalent.
- User preferences and themes.
- Dashboard layout and widget positions.
- Synchronization/version metadata where needed.

Exact table names and normalization are up to the agent, but the final schema must satisfy these principles:

- Use stable primary keys.
- Enforce foreign-key relationships.
- Include ownership information and authorization rules.
- Add suitable indexes for common queries and filters.
- Represent date-only deadlines separately from timestamps where appropriate.
- Store due-time and time-zone semantics consistently.
- Preserve manual ordering independently from automatic sort settings.
- Track creation and modification timestamps.
- Support reliable recurring-task generation and conflict detection.
- Prevent orphaned records when groups, labels, or tasks are deleted.
- Use database constraints and transactions for critical operations where appropriate.

Document the schema, migrations, relationships, and RLS policies.

Do not store the entire application as an opaque JSON blob if that makes querying, authorization, synchronization, or data integrity unreliable. JSON may be appropriate for versioned export files and selected flexible settings.

## 14. Reliability, accessibility, and errors

Implement useful loading, empty, success, and error states throughout the application.

- Validate forms and provide understandable error messages.
- Avoid duplicate submissions.
- Prevent accidental destructive actions.
- Handle network failures gracefully.
- Preserve user input when an operation fails.
- Use keyboard-accessible forms and controls.
- Provide accessible labels and focus states.
- Ensure drag-and-drop has button-based alternatives where specified.
- Keep the interface usable on different desktop screen sizes.
- Prevent invalid URLs or unsafe rich-text content.
- Avoid unnecessary animations or effects that interfere with productivity.

Do not silently swallow exceptions. Log useful diagnostic information without exposing private task content, credentials, or session data.

## 15. Required project documentation

Include a complete README with:

1. Project overview and feature list.
2. Architecture and technology choices.
3. Prerequisites.
4. Local installation and development instructions.
5. Environment-variable setup.
6. Supabase project configuration.
7. Database migrations and schema setup.
8. RLS and authentication configuration.
9. Secure initial account provisioning.
10. GitHub repository setup.
11. Frontend deployment instructions.
12. Routing and authentication callback configuration.
13. Local testing instructions.
14. Troubleshooting.
15. Known limitations and free-tier constraints.
16. Backup, restore, and data-export instructions.
17. How to update and maintain the application.

Include `.env.example` with safe placeholder values. Ensure real `.env` files, credentials, local databases containing private data, and generated secrets are excluded from version control.

Add a concise architecture document describing key design decisions, important dependencies, data flow, offline synchronization, and recurrence handling.

## 16. Automated tests

Write automated tests, but do not claim they have passed unless they have actually been executed and verified.

Include tests for the following areas where practical:

### Authentication and authorization

- Signed-out users cannot access protected application data.
- Public registration is disabled.
- Users cannot access another user's groups, tasks, labels, or settings.
- RLS and related access policies enforce ownership.

### Task management

- Creating, editing, deleting, completing, and reopening tasks.
- Date-only and date-time deadlines.
- Multiple labels and custom label colors.
- Subtask behavior.
- Group deletion confirmation and related data handling.

### Sorting and dashboard

- Every requested sort field in ascending and descending order.
- Restoring manual task order.
- Independent group order and task order.
- Persisting dashboard layout and group expansion state.
- Search and combined filters.
- Summary widget filtering.

### Recurrence

- Daily, weekly, monthly, and custom intervals.
- Monthly dates that do not exist.
- Skipping missed occurrences.
- Editing one occurrence versus future occurrences.
- Preventing duplicate occurrence creation after retries.
- Preserving completed occurrence history.

### Offline synchronization

- Local edits remain after reload.
- Queued changes synchronize when connectivity returns.
- Failed requests do not silently lose changes.
- Conflicts are detected and surfaced.
- Resolving a conflict results in the chosen version being persisted.
- Repeated synchronization does not duplicate operations or recurring occurrences.

### Import and export

- JSON export and restore.
- Replace and merge behavior.
- Malformed or unsupported import files.
- Full CSV export across all groups.
- CSV escaping and formula-injection protections.
- No credentials or session tokens in exported data.

### UI and persistence

- Themes and custom colors persist.
- Group and widget layout persists.
- Save status accurately reflects server confirmation.
- Destructive actions require confirmation.

Use mocked services for appropriate unit tests and a real test environment for integration tests where necessary. Never run tests against production user data.

## 17. Implementation and delivery requirements

Implement the full application in one pass, while organizing the work into sensible internal stages:

1. Set up the repository, build system, and architecture.
2. Configure the database schema, migrations, authentication, and access policies.
3. Implement core task and group management.
4. Implement sorting, search, filtering, and dashboard layout.
5. Implement themes, labels, checklists, and recurring tasks.
6. Implement offline persistence, synchronization, and conflict resolution.
7. Implement JSON and CSV export/import.
8. Write automated tests and documentation.
9. Review security, error handling, and deployment readiness.

These are implementation stages, not a reason to stop after an early prototype.

Deliver:

- Complete frontend source code.
- Database schema and migrations.
- Authentication and access-control configuration.
- All requested core features.
- Automated test files.
- README and setup documentation.
- `.env.example`.
- Deployment instructions.
- A clear summary of implementation decisions and known limitations.

The agent may choose appropriate libraries and internal structure, but must document major decisions and explain any necessary architecture changes.

The agent must not create accounts, invent credentials, or claim to have deployed to my GitHub account without the necessary access and actual confirmation. If an external setup step requires my action, provide exact instructions and clearly identify that step.

## 18. Acceptance checklist

The application is ready for handoff only when the implementation is complete and the following criteria have been addressed.

- [ ] The application runs locally using documented instructions.
- [ ] The application can be deployed from a GitHub repository I own.
- [ ] Authentication works and public registration is disabled.
- [ ] Private data is protected by backend authorization and database policies.
- [ ] The initial dashboard is empty.
- [ ] Groups can be created, customized, expanded, collapsed, reordered, and resized.
- [ ] Group order and dashboard layout persist across visits.
- [ ] Tasks support all required fields, multiple labels, rich-text descriptions, and checklists.
- [ ] Completed tasks remain visible with strikethrough.
- [ ] Sorting supports every requested field and both directions.
- [ ] Manual task ordering survives switching to and from automatic sorting.
- [ ] Search and filters work together and reset for a new visit.
- [ ] Summary widgets display correct counts and filter relevant tasks.
- [ ] Recurring tasks follow the specified rules and avoid duplicate occurrences.
- [ ] Offline edits persist locally and synchronize when connectivity returns.
- [ ] Conflicts are detected and can be resolved without silent overwrites.
- [ ] Save indicators distinguish local pending changes from server-confirmed changes.
- [ ] JSON export includes all necessary application data and settings.
- [ ] JSON import supports both replacement and merging with appropriate safeguards.
- [ ] CSV exports all tasks across all groups in one file.
- [ ] Themes, colors, group settings, and dashboard layout persist.
- [ ] Automated tests have been written for the required functionality.
- [ ] Documentation explains setup, security, deployment, backup, and maintenance.
- [ ] No secrets are committed to the repository or exposed to the browser.
- [ ] Remaining limitations and unverified steps are explicitly documented.

## 19. Final instructions

Prioritize correctness, privacy, data integrity, and maintainability over unnecessary visual complexity.

Do not silently reduce the scope to a basic CRUD application. In particular, offline synchronization, conflict handling, recurrence rules, full JSON restoration, and database-level authorization are essential requirements.

If a requirement conflicts with a hosting provider's capabilities or free-tier limits, explain the limitation and propose the least disruptive solution before weakening that requirement.

At the end of the implementation, provide a concise handoff report containing:

- What was implemented.
- The final architecture and major dependency decisions.
- Repository and deployment status.
- Required account or environment setup steps.
- How I can run the automated tests.
- Any known limitations or unverified behavior.

**Do not claim that the project is fully verified until the relevant tests have been run and the live deployment, if performed, has been checked.**