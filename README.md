# Personal Productivity Dashboard

A private, desktop-first task dashboard. Tasks are organized into customizable
groups (School, Research, Podcast, …) shown as cards on one dashboard. It works
offline, syncs safely between devices, supports recurring tasks, and exports
full backups.

The site's URL can be public. Your data stays private: PostgreSQL row-level
security limits every row to its owner, and an account allowlist adds a second
check. Hiding pages in the browser is not what protects the data.

---

## 1. Features

- **Dashboard**
  - The first login shows an empty dashboard with a clear "Create your first group" action.
  - Three summary widgets, Due Today, Overdue and Upcoming Deadlines (next 7 days), can be rearranged by drag-and-drop or with arrow buttons.
  - Clicking a widget filters the dashboard to exactly the tasks it counts. Clicking it again clears that filter.
  - Group cards sit on a 12-column grid. You can drag them, resize them (minimum and maximum sizes apply), and make them wider, narrower, taller or shorter from the card menu.
  - The grid has two modes: *arrange by group order* and *free placement*.
  - Each card can be expanded or collapsed, and there are Expand all / Collapse all buttons.
  - Move Up and Move Down are menu alternatives to dragging.
- **Groups**: create, rename, edit and delete groups. Each group has an optional description, a card color, an icon or emoji, and its own task sort setting.
  - Deleting a group lists what will be deleted and requires you to tick a confirmation box.
- **Tasks**: a full form with:
  - title and rich-text notes (bold, italic, bullet and numbered lists, links);
  - one or more labels, and a priority of Low, Medium, High or Urgent;
  - a due date with an optional time, a checklist, and a repeat setting.
  - The task's creation time and completion time are recorded.
  - Completed tasks stay in their group with strikethrough.
  - Unsaved form input survives a reload, and closing the form with unsaved changes asks for confirmation.
- **Sorting**: by title, due date, label or priority, ascending or descending, plus manual order. Manual order is stored separately, so it comes back exactly when you switch back to *Manual order*.
- **Search and filters**
  - Search covers task titles, descriptions and checklist text.
  - Filters cover priority, label, due date, group and completion status. They can be combined and reset.
  - Filters are deliberately not saved, so every visit starts unfiltered.
- **Recurring tasks**: daily, weekly, monthly, or every *N* days, weeks or months.
  - Monthly dates that don't exist fall on the last day of the month.
  - Missed occurrences are skipped.
  - When you edit a recurring task, you choose between *this occurrence only* and *this and future occurrences*.
  - Completion history is preserved.
- **Offline-first**
  - Every change is saved on your device (IndexedDB) and queued.
  - Changes sync when you are online, and the queue survives reloads and browser restarts.
  - A save indicator shows *Saving…*, *Saved* (only after the server confirms), *Pending sync*, *Offline · pending sync*, *Sync failed* or *Needs review*.
- **Conflict handling**: if a task or setting was changed elsewhere, edits to different fields are merged automatically. Overlapping edits are never overwritten silently; you choose, per field, which version to keep.
- **Backup and export**
  - A full JSON backup that is versioned and validated.
  - Import in *Replace* or *Merge* mode. Each import runs as one all-or-nothing database transaction.
  - A CSV export of all tasks in all groups, with protection against formula injection.
- **Customization**
  - Light, dark and system modes, with six theme presets.
  - Custom theme colors per mode, with contrast warnings.
  - Custom group colors and icons, and color-coded labels.
  - Customizable priority colors. Priority is always shown with text and a bar indicator, never by color alone.

## 2. Architecture and technology choices

The app is a static React app that reads and writes a local database, plus
Supabase (PostgreSQL + Auth) as the server. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for
the design, data flow, sync protocol and recurrence rules.

| Concern | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript, Vite | Required stack, fast builds |
| Server | Supabase (PostgreSQL, Auth) | Required stack. RLS enforces privacy in the database, and the free tier needs no subscription. |
| Local storage | IndexedDB via **Dexie** | Durable offline data and mutation queue |
| Offline app shell | **vite-plugin-pwa** (Workbox) | The app opens without a network |
| Dashboard grid | **react-grid-layout** | Dragging, resizing, min/max sizes |
| List reordering | **dnd-kit** | Accessible drag-and-drop for tasks and widgets, with keyboard support |
| Rich text | **TipTap** (ProseMirror) | Bold, lists, links; restricted extension set |
| Sanitizing | **DOMPurify** | Allowlist sanitizing on save, import and every render |
| Tests | Vitest, Testing Library, **PGlite**, Playwright | PGlite runs the real SQL migrations in-process |

There is no router: the app has a single screen, so GitHub Pages' lack of SPA
fallback routes is irrelevant. Sign-in is e-mail + password only, so there are
no OAuth or magic-link redirects to configure.

**GitHub Pages compatibility.** I checked whether GitHub Pages can host this app, and it can:
- **Static hosting:** the whole app is static.
- **Auth:** e-mail and password sign-in needs no callback URL.
- **Routing:** there is one route, and asset paths are relative, so it works under `/<repo>/`.
- **Security headers:** Pages cannot send them, so a Content-Security-Policy `<meta>` tag is generated at build time. It allows scripts only from the site itself and network requests only to your Supabase project.
- **Repository visibility:** on GitHub Free, Pages generally requires a **public** repository. That is acceptable because the repository contains no secrets. If you want a private repository on a free plan, use Cloudflare Pages or Netlify instead. The same `npm run build` output (`dist/`) works there unchanged.

## 3. Prerequisites

- Node.js 22+ and npm 10+
- A free Supabase account: https://supabase.com
- A GitHub account (for hosting)
- For browser tests only: Playwright's Chromium (`npx playwright install chromium`)

Docker and the Supabase CLI are **not** required.

## 4. Local installation and development

```bash
npm install
cp .env.example .env.local      # then fill in the two values (section 5)
npm run dev                     # http://localhost:5173
```

The dev server talks to the Supabase project in `.env.local`. To work against
a separate test project rather than your real data, create a second free
Supabase project and point `.env.local` at it.

## 5. Environment variables

| Variable | Where to find it | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | No |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` / publishable key | No. It is designed to be public, and RLS protects the data. |

- **Never** put the `service_role` / secret key in any `VITE_*` variable, file or workflow. Everything prefixed `VITE_` ends up in the browser bundle.
- The app refuses to start if it detects a secret key, and the deploy workflow refuses to publish one.
- `.env`, `.env.*` (except `.env.example`) are git-ignored.

## 6. Supabase project configuration

1. Create a project at https://supabase.com/dashboard. Choose a region near you and save the database password in your password manager. The app never needs the database password.
2. **Apply the database migrations** (section 7).
3. **Disable public registration**: open **Authentication → Sign In / Providers**. Turn **off** "Allow new users to sign up". Keep the **Email** provider enabled.
4. Open **Authentication → URL Configuration**. Set **Site URL** to your deployed URL, e.g. `https://<user>.github.io/<repo>/`. The app uses no redirects, but this keeps Supabase's own e-mails consistent.
5. **Create your account** (section 9).

## 7. Database migrations and schema setup

The schema is in `supabase/migrations/`. Apply the files **in filename order**:

| File | Contents |
|---|---|
| `…0001_schema.sql` | Tables, constraints, indexes, triggers, RLS policies |
| `…0002_sync.sql` | `sync_push` / `sync_pull` functions (offline sync protocol) |
| `…0003_import.sql` | `import_backup` (transactional JSON import) |
| `…0004_account_allowlist.sql` | `app_users` allowlist and the policies that require it |

**Option A: SQL Editor (no tools needed).** In the Supabase dashboard, open
**SQL Editor → New query**. Paste the contents of each file in order and click
**Run**, one file at a time.

**Option B: Supabase CLI.**

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Then run `supabase/verify_security.sql` in the SQL Editor. Each query states
its expected result, for example "0 rows" for tables without RLS.

Schema documentation (tables, relationships, constraints) is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#data-model).

## 8. RLS and authentication configuration

- **Every table** in `public` has RLS **enabled and forced**. Each policy requires `user_id = auth.uid()` **and** that the account is on the allowlist (`public.app_users`).
- **No access for signed-out visitors:**
  - The `anon` role has no table privileges and cannot call any function.
  - Signed-in users cannot hard-delete rows. Deletions are soft deletes, so they can sync.
- **Ownership cannot be faked or changed:**
  - `user_id` is set from the verified session on insert, whatever the client sends.
  - It cannot be changed on update.
  - Child rows use composite foreign keys on `(user_id, parent_id)`, so they cannot point at another user's rows.
  - A task can never be moved to another group.
- **Server functions run with your permissions:** `sync_push`, `sync_pull` and `import_backup` are `SECURITY INVOKER`, so RLS applies to imports, exports, recurrence generation and sync exactly as it does to direct queries.
- **Two independent safeguards against strangers:** sign-up is disabled in Auth, and the allowlist is enforced in the database. Even if someone registered while sign-up was accidentally enabled, they could not read or write anything.
- **Sessions:** the session is kept in the browser and refreshed automatically until you click **Sign out**. Sign out also removes this device's offline copy, unless it holds unsynced changes; in that case it warns you and keeps them.
- **No password-reset feature**, by design. To change your password, use the Supabase dashboard (Authentication → Users → … → Send password recovery, or set it there).

## 9. Secure initial account provisioning

Public sign-up stays disabled the whole time.

1. Supabase dashboard → **Authentication → Users → Add user → Create new user**.
2. Enter your e-mail and a strong password. Tick **Auto Confirm User**.
3. Open **SQL Editor** and run `supabase/provision_user.sql`, with `you@example.com` replaced by your e-mail. This puts the account on the allowlist.
4. Sign in on the site.

No password is stored in this repository or in any configuration file.

## 10. GitHub repository setup

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main         # or push this branch and open a pull request into main
```

The repository contains no secrets. `.gitignore` excludes `.env*` files,
build output, test artifacts and local databases.

## 11. Deploy the frontend (GitHub Pages)

1. GitHub → repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** tab. Add two repository variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow manually. The workflow:
   - type-checks the code;
   - runs the unit and database tests;
   - builds the site;
   - checks that no secret key is in the output;
   - publishes the site.
4. Open `https://<you>.github.io/<repo>/`. Then verify the deployment:
   - Sign in, create a group and a task, and wait for **Saved**.
   - Reload the page, or open it in another browser: the task is there.
   - Sign out, then reload: only the sign-in form is shown.
   - In a private window, try `https://<project-ref>.supabase.co/rest/v1/tasks` with the anon key in the `apikey` header. You get a permission error, not data.

`.github/workflows/ci.yml` runs the full test suite, including browser tests, on
every pull request.

## 12. Routing and authentication callbacks

- The app has one screen and no client-side routes, so no 404 fallback is needed.
- Asset URLs are relative (`base: './'`), so the same build works at `/<repo>/` or on a custom domain.
- E-mail + password sign-in uses no redirect callbacks.
- If you add a custom domain, update the Supabase **Site URL**. No other change is needed: the CSP is derived from `VITE_SUPABASE_URL` at build time.

## 13. Local testing

```bash
npm run typecheck
npm test                 # unit + component + database tests (Vitest)
npm run test:unit        # unit + component tests only (jsdom)
npm run test:db          # database, sync, recurrence, import/export tests
npx playwright install chromium   # once
npm run test:e2e         # browser tests (Playwright)
```

- **Database tests** apply the real migrations to **PGlite**, PostgreSQL compiled to WebAssembly and run in-process.
  - Requests run exactly as Supabase runs them: role `authenticated` plus JWT claims.
  - So RLS, grants, triggers and RPCs are exercised for real.
  - No Supabase project, network or credentials are used, and no real user data is ever touched.
- **Browser tests** build a special test version of the app (`VITE_E2E=true`).
  - It runs the same migrations in PGlite inside the browser, with a simulated login whose password is random per run.
  - That test backend is excluded from production builds, and the build output is checked for this.
- Supabase-specific settings, such as "sign-ups disabled", can only be checked on your project. Use `supabase/verify_security.sql` and the checks in section 11.

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| "The app is not configured" | `.env.local` (local) or the repository variables (Pages) are missing; see section 5. |
| "Refusing to start: … secret key" | You used the service_role key. Use the anon key, and **rotate the secret key** in Supabase. |
| Sign-in works, but you see "Sync failed" or "server did not accept this session" | The account is not on the allowlist. Run `supabase/provision_user.sql`. |
| "The e-mail or password is incorrect" | Check the user exists and is confirmed (Authentication → Users). |
| Nothing loads; requests time out | The free Supabase project may be **paused** after inactivity. Restore it from the dashboard. Your offline copy stays usable meanwhile. |
| "Needs review" in the header | A conflict is waiting for you. Click **Review**. |
| "Sync failed" persists | Click **Review** to see rejected changes. Retry, or discard a change explicitly. Nothing is dropped automatically. |
| Old version after deploying | A banner offers **Reload to update**. The app never reloads by itself while you might be typing. |
| Pages deploy fails at "Check configuration" | Add the two repository **variables**, not secrets, from section 11. |

## 15. Known limitations and free-tier constraints

- **Offline**
  - The first sign-in on a device needs a connection.
  - After that, the app opens offline and you can create, edit, complete, reopen and delete tasks, and change groups and settings.
  - **Importing a backup needs a connection.** It is applied on the server in one transaction. The app explains this and changes nothing when offline.
- **Device risk**
  - Unsynced changes exist **only on that device** until they sync.
  - If the browser's site data is cleared, or the device is lost before syncing, those changes are gone.
  - The app asks the browser for persistent storage to reduce eviction risk, but cannot guarantee it.
  - The local copy is not encrypted beyond the operating system's own protection.
- **Expired sessions:** while offline, the stored session is kept and you keep working locally. If the server later rejects the session, the sign-in screen appears; queued changes stay on the device and sync after you sign in again on that device.
- **Timestamps:** created and completed times are recorded by the device clock. A badly wrong device clock skews them, but this never affects ordering or sync correctness: sync uses server versions, not timestamps.
- **One account:** the app is designed for a single user. The schema and policies support multiple isolated users, but there is no sharing feature.
- **Supabase Free plan** (figures reported by third-party sources as of 2026; confirm at https://supabase.com/pricing):
  - about 500 MB database per project;
  - 2 active free projects;
  - around 5 GB egress per month;
  - 50,000 monthly active users;
  - **projects pause after about 7 days without activity**.

  A paused project keeps its data but is unreachable until you restore it in the dashboard. Visiting the site regularly avoids the pause. Free tiers can change and are not a guarantee of permanent availability, so keep JSON backups.
- **GitHub Pages:**
  - published sites are limited to 1 GB;
  - there is a soft limit of 100 GB of bandwidth per month;
  - Pages sites are always public, even from private repositories on paid plans.

  The data is not public: it lives in Supabase behind RLS. See https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits.
- **Bundle size:** the JavaScript bundle is about 370 KB gzipped, cached by the service worker after the first visit.

## 16. Backup, restore and data export

Open **Backup & export** in the header.

- **Download backup (JSON).** A full-fidelity, versioned backup; the format is documented in [docs/BACKUP_FORMAT.md](docs/BACKUP_FORMAT.md). It contains:
  - groups, tasks and checklists;
  - labels, priorities and priority colors;
  - recurrence definitions and occurrence history;
  - theme and layout settings;
  - collapsed state and other preferences.

  It contains no account, e-mail, token or key.
- **Download CSV.** Every task in every group, regardless of filters. Limitations:
  - descriptions become plain text;
  - labels are joined with `; `;
  - checklist items are listed one per line as `[x]` or `[ ]` inside one cell;
  - recurrence is described in words.

  Cells that start with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets do not run them as formulas. Use JSON for a complete backup.
- **Import a backup.** The file is fully validated before anything changes: format, version, types, limits, duplicate ids and relationships. Then you choose one of two modes:
  - **Merge**: items you already have are kept as they are, and missing items are added. Items you deleted are restored if they are in the backup, and labels with the same name are combined. Importing the same file twice changes nothing.
  - **Replace**: requires ticking a confirmation box. Your data becomes exactly the backup's contents; anything not in the backup is deleted.

  The import runs as one database transaction: it fully succeeds or changes nothing. Afterwards you get a summary per item type, for example "Tasks: 3 added, 2 kept".

  A backup can only be imported into the account (Supabase project) it came from, or into one that does not contain those ids. Ids are globally unique, and the database refuses ids that belong to another account.

Make a backup before major changes and keep a recent copy outside the browser.

## 17. Updating and maintaining

- **Code changes:** develop on a branch, run `npm run typecheck && npm test && npm run test:e2e`, and merge to `main` to deploy.
- **Database changes:** add a **new** migration file, never edit applied ones. Apply it as in section 7, then run `verify_security.sql` again. Every new table needs RLS, a `user_id` column and the same policy pattern.
- **Backup format changes:** bump `BACKUP_VERSION` in `src/lib/backup.ts` and add a migration step in `migrate()`, so older backups still import.
- **Dependencies:** `npm outdated`, then update and run all tests. `npm audit` reports advisories. At the time of writing, a few moderate advisories were in development-only tooling.
- **Rotating keys:** if the anon key is rotated in Supabase, update the `VITE_SUPABASE_ANON_KEY` variable and redeploy.
- **Free-tier upkeep:** use the app at least weekly, or restore the paused project when needed. Export a JSON backup periodically.

## Project layout

```
src/
  lib/          pure logic: dates, recurrence, sorting, filters, CSV, backup, themes, sanitizing
  data/         IndexedDB schema (db.ts), write API (repo.ts), import/export, session wiring
  sync/         sync engine and the Supabase remote
  auth/         authentication boundary and provider
  components/   React UI
  testing/      e2e-only in-browser backend (excluded from production builds)
supabase/
  migrations/   SQL schema, RLS, sync and import functions
  provision_user.sql, verify_security.sql
tests/
  unit/ ui/     Vitest (jsdom)
  db/ data/     Vitest against PGlite with the real migrations
  e2e/          Playwright
docs/           ARCHITECTURE.md, BACKUP_FORMAT.md
```
