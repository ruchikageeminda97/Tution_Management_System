# Tuition Manager Architecture

This document describes the application as it exists today and gives a practical
checklist for extending it. It is intended as a map for understanding the UI,
Electron boundary, SQLite schema, CRUD flows, and the changes required for a new
feature.

## 1. At a glance

Tuition Manager is a desktop application built with Electron, React, and SQLite.
The Electron main process owns the database and filesystem access. The React
renderer requests data through a small, explicit API exposed by the preload
script; it does not open SQLite or access Node.js APIs directly.

```text
React UI (src/)
    │ window.tuition.<feature>.<method>()
    ▼
Preload bridge (preload.js; contextBridge + ipcRenderer.invoke)
    │ named IPC channel + arguments
    ▼
Electron main process (main/main.js; ipcMain.handle)
    │ validated, parameterized SQL
    ▼
SQLite (better-sqlite3; main/schema.sql)
```

The codebase is intentionally compact at present: most pages and dialogs live
in `src/App.jsx`, and IPC handlers live in `main/main.js`. The modular folders
described in some older design notes are not present yet; use the actual files
listed below as the current source of truth.

## 2. Repository map

| Path | Responsibility |
|---|---|
| `src/main.jsx` | React entry point; mounts `App` and imports the global stylesheet. |
| `src/App.jsx` | Authentication, application shell, navigation, page components, forms, modal host, and renderer-side API calls. |
| `src/styles.css` | Main and currently only application stylesheet: design tokens, layout, components, responsive rules, and print styles. |
| `preload.js` | Defines the allow-listed `window.tuition` API and forwards calls to named IPC channels. |
| `main/main.js` | Creates the Electron window, authentication/session state, IPC handlers, validation, application workflows, and backup/restore operations. |
| `main/database.js` | Opens and returns the singleton `better-sqlite3` database connection. |
| `main/schema.sql` | Fresh-database schema, constraints, foreign keys, and indexes. |
| `main/services/backup-service.js` | Creates `better-sqlite3` snapshots, validates database files, encrypts before Drive upload, and prepares validated cloud restore files. |
| `main/services/google-drive.js` | Google OAuth PKCE with a Desktop client secret, OS-encrypted credential persistence, application-owned Drive folder/files, retries, listing, and retention. |
| `main/services/backup-crypto.js` | AES-256-GCM encryption/decryption using a recovery-passphrase-derived key. |
| `main/services/backup-scheduler.js` | Local-time daily scheduler with persisted success-date/retry state and missed-run handling. |
| `main/services/secure-store.js` | Stores OAuth tokens, the Desktop client secret, and the locally cached recovery passphrase only through Electron `safeStorage`. |
| `main/scheduling.js` | Shared weekly schedule validation and overlap/availability helpers. |
| `main/record-import.js` | Excel workbook parsing and student/teacher template generation. |
| `index.html` | Renderer HTML shell and Content Security Policy. |
| `vite.config.js` | Vite/React development and build configuration. |
| `tests/database.test.js` | SQLite schema, relationship, attendance, fee, and earnings behavior tests. |
| `tests/record-import.test.js` | Excel import and template tests. |
| `tests/electron-smoke/` | Electron-runtime smoke test for the native SQLite dependency. |
| `package.json` | Commands, dependencies, and electron-builder packaging configuration. |

### Main CSS file

The global styles are in **`src/styles.css`**. It is imported once from
`src/main.jsx`. CSS is currently kept in that one file; there are no CSS modules,
Tailwind, or component-scoped style files. The stylesheet starts with `:root`
design tokens and base styles, followed by component/page classes, responsive
media queries near the end, and print rules at the end. Reuse existing tokens
and class patterns when adding UI.

## 3. Startup, window, and database lifecycle

1. Vite serves the renderer during development (`npm run desktop`); packaged
   builds load `dist/index.html`.
2. On Electron readiness, `main/main.js` opens
   `app.getPath('userData')/app.db`, registers IPC handlers, and creates the
   BrowserWindow.
3. `main/database.js` creates the parent directory, opens the database,
   enables SQLite WAL mode and foreign keys, and executes `main/schema.sql`.
4. `schema.sql` uses `CREATE TABLE/INDEX IF NOT EXISTS`. This creates missing
   objects on a fresh install, but it does **not** alter an existing table when
   its definition changes. `main/database.js` therefore applies the numbered
   `PRAGMA user_version` migrations for existing databases (currently version 2).
5. On sign-in/setup, `activeUser` is held in the main process. Each data handler
   resolves the active organization through `org()` / `requireUser()` rather
   than accepting an organization ID from the renderer.

The database is not stored in the repository. Backups are explicit local files
created through Electron's save dialog. Restore validates the database,
preserves a safety copy, swaps the database, and attempts to recover the prior
file if restoring fails.

### Database change and migration warning

Do not assume that changing `main/schema.sql` updates databases already used by
customers. SQLite ignores changed definitions under `IF NOT EXISTS`. Before a
new feature needs a changed schema, implement and test a versioned migration
path (for example, ordered migration scripts tracked with `PRAGMA user_version`)
that upgrades existing databases transactionally. Keep fresh-install creation
and upgrade paths in sync, make migrations safe to run only once, and test both
a new database and a copy of the previous schema. Back up user data before
testing or manually changing a real database.

## 4. Database model

SQLite is the source of truth. IDs are integer primary keys; foreign keys are
enabled by the connection. Date/time values are stored as text in ISO-like
formats (`YYYY-MM-DD`, `HH:MM`, or `YYYY-MM` depending on the field). Monetary
columns use SQLite `REAL`; application calculations round where needed.

### Tables and purpose

| Table | Important columns and purpose |
|---|---|
| `organizations` | `oid` PK, `name`, `contact`, `created_at`. Organization/tenant root. |
| `users` | `user_id` PK, `oid` FK, `username` (globally unique, case-insensitive), `password_hash`, `role` (`admin` or `staff`), `created_at`. Passwords are salted scrypt hashes. |
| `students` | `stid` PK, `oid` FK, globally unique optional `rfid`, required `name` and `contact1`, optional school/contact/birthday/address, `status` (`active`/`inactive`), `created_at`. |
| `teachers` | `tid` PK, `oid` FK, name/contact/address/description, `created_at`. |
| `halls` | `hall_id` PK, `oid` FK, name, optional capacity. |
| `hall_availability` | `availability_id` PK, `hall_id` FK, weekday and start/end time. A hall has zero or more weekly open slots. |
| `classes` | `class_id` PK, `oid` FK, `class_name`, teacher `tid` FK, subject, non-negative fee, 0–100 commission percentage, optional `hall_id` FK, active/inactive status, `created_at`. |
| `class_schedules` | `schedule_id` PK, `class_id` FK, weekday and start/end time. A class has zero or more recurring schedule slots. |
| `class_enrollments` | `enrollment_id` PK, `class_id` and `stid` FKs, 0–100 discount, `enrolled_date`, active/dropped status. Unique `(class_id, stid)` means a student has one enrollment row per class, which can be reactivated. |
| `sessions` | `session_id` PK, `class_id` FK, date, optional start/end time, scheduled/ongoing/completed/cancelled status, `created_at`. Unique `(class_id, session_date, start_time)`. |
| `attendance` | `attendance_id` PK, `session_id` and `stid` FKs, present/absent/not_marked status, optional `marked_at`. Unique `(session_id, stid)`. |
| `payments` | `payment_id` PK, `enrollment_id` FK, covered month, amount, payment date/time, optional session and user references, notes, `created_at`. Unique `(enrollment_id, for_month)` prevents duplicate monthly fees. |
| `teacher_payouts` | `payout_id` PK, teacher `tid` FK, amount, payout date, notes, `created_at`. |
| `teacher_payout_details` | `detail_id` PK, `payout_id` FK, `class_id` FK, class amount, optional covered month. |
| `backup_logs` | `backup_id` PK, optional `oid` FK, backup type, file path (local path or Drive file ID), status, optional error message, `created_at`. |
| `backup_settings` | Per-organization non-secret Google OAuth client ID, automatic schedule/retention preferences, last scheduled-success date, status and retry metadata. OAuth and recovery secrets are stored separately with OS-protected storage. |

### Relationships

```text
organizations 1 ── * users
organizations 1 ── * students
organizations 1 ── * teachers
organizations 1 ── * halls
organizations 1 ── * classes

teachers 1 ── * classes
halls 1 ── * hall_availability
halls 1 ── * classes (optional hall assignment)
classes 1 ── * class_schedules
classes 1 ── * class_enrollments * ── 1 students
classes 1 ── * sessions
sessions 1 ── * attendance * ── 1 students
class_enrollments 1 ── * payments (one per covered month by unique constraint)
sessions 0..1 ── * payments
teachers 1 ── * teacher_payouts
teacher_payouts 1 ── * teacher_payout_details * ── 1 classes
```

### Data rules to preserve

- **Tenant isolation:** every user-owned query/write must be scoped to the
  authenticated user's `oid`. For linked records, prove the full relationship
  belongs to that `oid` (for example, an enrollment's class belongs to it).
  Never trust a renderer-supplied `oid`.
- `username` and RFID uniqueness are global in the current schema, not per
  organization. RFID assignment checks for conflicts across organizations.
- Students and class enrollments are generally deactivated/dropped rather than
  physically deleted so historical records remain meaningful.
- Class schedule and hall availability time slots are validated in
  `main/scheduling.js`; classes assigned to halls must fit the hall's
  availability and must not overlap other active class bookings.
- A student's fee for a class is `fee * (1 - discount_percentage / 100)`.
  Commission and organization shares are derived from payable/collected amounts.
- Age, totals, pending fees, and earnings are derived values; do not persist
  duplicate values unless a deliberate reporting/performance requirement is
  introduced.
- Foreign-key cascade rules are defined in `main/schema.sql`. Before adding a
  hard-delete path, check dependent records and preserve financial/attendance
  history; the UI's existing delete actions often intentionally use soft status
  updates or block deletion.

## 5. Data and CRUD flow

A normal renderer operation follows this pattern:

1. A page component in `src/App.jsx` calls `window.tuition.<area>.<method>()`.
2. `preload.js` exposes that method as a fixed IPC channel using
   `ipcRenderer.invoke`. Do not expose raw `ipcRenderer`, SQL, Node APIs, or
   arbitrary channel names to the renderer.
3. A matching `ipcMain.handle` in `main/main.js` checks authentication,
   validates inputs, scopes access to the active organization, and uses
   parameterized SQLite statements.
4. The handler returns serializable data or throws an error. The UI displays
   errors through its existing page/error/toast patterns.
5. After a successful mutation, the page refreshes data (commonly through the
   shared `version`/`refresh` mechanism) or updates its local state.

`better-sqlite3` is synchronous. Keep handlers focused; wrap related multi-row
changes in `db.transaction(...)` so partial writes cannot leave inconsistent
state. Use bound parameters for values. SQL identifiers cannot be bound, so
dynamic table/column names must be fixed/allow-listed, never taken from user
input.

### Existing CRUD/workflow behavior

| Area | Read | Create/update | Delete or lifecycle |
|---|---|---|---|
| Students | `students:list`, `students:fees`, `students:byRfid` | `students:save`; Excel import inserts new rows; RFID assign/remove | `students:delete` sets status inactive, preserving history. |
| Teachers | `teachers:list` | `teachers:save`; Excel import inserts rows | Hard delete is blocked while a class references the teacher. |
| Halls | `halls:list` includes availability and bookings | `halls:save` validates and transactionally replaces availability slots | Hard delete is blocked while assigned to any class. |
| Classes | `classes:list`, `classes:detail` | `classes:save` creates/updates class and transactionally replaces schedule rows | No class delete handler; class status can be inactive. Enrollments can be added/reactivated, dropped, and have discounts updated. |
| Sessions/attendance | `sessions:list`, `sessions:attendance` | Generate a date's sessions; start a session and create attendance rows; mark students | Ending an ongoing session marks remaining `not_marked` students absent and completes the session. |
| Payments | `payments:overview`; `reports:paymentRecords` accepts student/class and month/range filters; `payouts:list` accepts teacher and month/range filters | `payments:pay` and `students:payFees` create monthly student payment records; `payouts:add` records teacher payouts | No payment edit/delete handler currently; duplicate covered months are rejected by a database unique constraint. |
| Teacher payouts | `payouts:list` | `payouts:add` creates payout and optional detail rows in one transaction | No payout edit/delete handler currently. |
| Organization/settings | `settings:organization` | `settings:saveOrganization` | Not deletable in the UI. |
| Backups | Dashboard's last successful backup | `backup:create`, `backup:googleUpload` | Local restore validates a SQLite file and makes a safety copy; Drive restore downloads, authenticates/decrypts and validates before replacement. |

Setup creates the initial organization and admin user. Although the schema has a
`staff` role, account management for adding staff is not currently exposed.
Google Drive configuration and account connection are managed in Settings.

## 6. IPC API inventory

These are the renderer-facing bridge groups defined in `preload.js`. Their
corresponding handlers are registered in `main/main.js`.

| Bridge group | Methods / channel names |
|---|---|
| `auth` | `status`, `setup`, `login`, `logout` |
| `dashboard` | `get` |
| `students` | `list`, `save`, `delete`, `assignRfid`, `removeRfid`, `byRfid`, `fees`, `payFees`, `importExcel`, `downloadTemplate` |
| `teachers` | `list`, `save`, `delete`, `importExcel`, `downloadTemplate` |
| `halls` | `list`, `save`, `delete` |
| `classes` | `list`, `detail`, `save`, `enroll`, `dropEnrollment`, `updateDiscount` |
| `sessions` | `list`, `generate`, `attendance`, `start`, `mark`, `end` |
| `payments` | `overview`, `pay` |
| `reports` | `classEarnings`, `teacherBalances`, `paymentRecords`, `studentAttendance`, `pendingPayments`, `exportPDF` |
| `payouts` | `list`, `add` |
| `settings` | `organization`, `saveOrganization` |
| `backup` | `create`, `restore`, `getSettings`, `saveSettings`, `googleConnect`, `googleDisconnect`, `googleStatus`, `googleUpload`, `googleList`, `googleRestore` |

The `records:import` and `records:downloadTemplate` channels are also used
internally by student/teacher bridge methods; `preload.js` fixes the requested
record type rather than allowing arbitrary operations.

## 7. Adding a feature

Use this sequence for a feature that stores and displays data. Some changes
(such as a purely visual adjustment) will not need every step.

### 1. Define the behavior and data ownership

- Decide who can use it, which organization owns each record, how it relates to
  existing entities, and whether records need history/soft deletion.
- Identify constraints, uniqueness rules, validation, and how a feature affects
  fees, attendance, reports, backups, or other existing workflows.
- Prefer normalized relational rows and foreign keys over JSON arrays or
  duplicated totals.

### 2. Design and migrate the database

- Add tables, columns, indexes, checks, and foreign keys in `main/schema.sql`
  for fresh installations.
- Add a numbered, transactional migration for already-created databases.
  **Schema-only edits are not an upgrade path.**
- Use clear table/column names consistent with the existing schema. Include
  `oid` on organization-owned root records and validate tenant ownership through
  joins for child records.
- Add database tests for table creation, constraints, uniqueness, relationships,
  tenant isolation, and the new workflow. Test both a fresh schema and the
  migration from the previous schema.

### 3. Implement the main-process operation

- Add `ipcMain.handle('area:action', ...)` in `main/main.js`, or extract logic
  into a focused module if the feature is large enough to justify it.
- Require a signed-in user for protected operations and derive the organization
  from `org()` / `requireUser()`.
- Validate every input in the main process; renderer validation is for user
  experience, not a security boundary.
- Use parameterized SQL, explicit tenant scoping, and a transaction for
  multi-row writes. Return only the data the renderer needs.
- For destructive operations, account for foreign keys and historical records;
  follow established soft-delete/blocking behavior where appropriate.

### 4. Add the preload bridge

- Add a named method in the relevant `contextBridge.exposeInMainWorld` group in
  `preload.js`, mapped to the exact IPC channel.
- Expose the smallest operation-specific API possible. Do not add general SQL
  access, arbitrary channel invocation, filesystem access, or raw Electron
  objects.
- If this is a completely new domain, add a clearly named bridge group.

### 5. Add UI and connect the data

- Add the page/form/modal component in `src/App.jsx` (the current convention) or
  extract a component/module if the feature has grown large.
- Use the existing `api` alias (`const api = window.tuition`), loading pattern,
  validation/error/toast behavior, shared buttons/fields/tables, and
  `version`/`refresh` convention.
- For a new navigable page, update all relevant navigation and routing surfaces
  in `src/App.jsx`: `navGroups`, `pageNames`, and `PageContent`. Also add its
  modal handling in `ModalHost` if it needs dialogs.
- Ensure success and failure states, empty lists, loading, cancellation, and
  refresh behavior are covered. Confirm that the UI does not imply an operation
  (such as edit/delete) that the main process does not support.

### 6. Add styles

- Add styles to `src/styles.css`; use existing design tokens (`--ink`,
  `--muted`, `--line`, `--purple`, etc.) and reusable classes where practical.
- Check the desktop layout and the existing breakpoints (`1200px`, `900px`,
  `650px`), and add a narrowly scoped rule if the new component needs one.
- For printable content, follow the existing `@media print` rules and verify
  normal screen styles remain unaffected.

### 7. Test and verify

- Add focused tests under `tests/` using Node's built-in test runner and an
  in-memory SQLite database when testing schema/business rules.
- Run `npm test` for the regression suite; run `npm run build` to validate the
  renderer bundle. For native SQLite/Electron integration, run
  `npm run test:electron` where the platform/runtime is available.
- Manually exercise the feature in the desktop app, including at least one
  organization boundary case and a failure case for invalid/duplicate input.
- Update `README.md` if the feature changes user-facing workflows, setup,
  backup, or supported capabilities.

## 8. UI conventions and structure

`src/App.jsx` currently owns the top-level `App`, navigation state, session
bootstrap, `PageContent`, page components (Overview, Students, Teachers,
Classes, Halls, Attendance, Payments, Reports, Settings), shared UI components,
and modal forms/detail views via `ModalHost`. This single-file layout is easy to
follow for small additions but increasingly expensive to maintain. For a larger
feature, it is reasonable to extract page or dialog components while preserving
the same behavior and bridge contract; update imports and keep `App.jsx` as the
composition/navigation boundary.

Use consistent terminology with the UI and existing schema. The UI is a
renderer, not the authority for access control or validation. Do not calculate
security-sensitive identity or organization scope from editable client state.

## 9. Development and verification commands

```text
npm install            Install dependencies
npm run desktop        Start Vite and Electron for local development
npm run build          Build the React renderer into dist/
npm test               Run Node tests
npm run test:electron  Verify better-sqlite3 can run inside Electron
npm run dist           Build renderer and package an installer
```

`npm run desktop` is the normal way to test end-to-end Electron behavior. The
renderer-only Vite server is available as `npm run dev`, but database-backed
features require Electron and its preload bridge.

## 10. Current limitations to keep in mind

- There is no schema migration framework yet; add one before evolving an
  installed database schema.
- Renderer pages and main-process IPC/data logic are concentrated in
  `src/App.jsx` and `main/main.js`; these are the current locations, not ideal
  permanent boundaries for an ever-growing application.
- Authentication stores the active user in main-process memory. There is one
  initial admin setup flow; staff account CRUD and role-based authorization
  policy are not currently implemented.
- Currency is formatted with the computer's locale, but no currency code is
  stored. Amount columns use SQLite `REAL`.
- Database and local backup files are not encrypted. Protect them using trusted
  operating-system accounts and secure backup locations.
- Google Drive backups use `better-sqlite3` snapshots, AES-256-GCM encryption,
  OAuth PKCE and `drive.file`. The scheduler runs only while Electron is open;
  persisted settings prevent duplicate successful scheduled backups.
- Payments and payouts are append-only through the current UI/API. Do not
  advertise editing or deletion unless a safe audited workflow is implemented.
- The Payments page separates student fees from teacher payouts. Student
  payment history can be filtered to the last three months, a selected month, or
  a custom month range; teacher payout history has the same period filters.
  Filtered history is exported through the existing PDF print pipeline.
- Reports are organized into student, teacher, and class sections. Student
  reports include present/absent session history, paid records, and highlighted
  pending fees. Class detail includes a CSV export of active enrolled students.
