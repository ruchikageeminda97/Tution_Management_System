# Tuition Management System — Design Document

A desktop app (Electron + SQLite) to manage a tuition organization: students, teachers,
classes, attendance, payments, teacher commissions, RFID cards, and backups.
Supports **multiple organizations in one database**, but a logged-in session only ever
sees its own organization's data.

---

// ============================================================
// TUITION MANAGEMENT SYSTEM - DBML SCHEMA
// Paste this whole file into https://dbdiagram.io to render it
// Target DB engine: SQLite
// ============================================================

Table organizations {
  oid          integer  [pk, increment, note: 'Auto generated org id']
  name         varchar  [not null]
  contact      varchar
  image_directory varchar [note: 'Local folder used for student photo files']
  created_at   datetime [default: `CURRENT_TIMESTAMP`]

  Note: 'The root tenant. Every other table is scoped to an oid so many organizations can share one database file.'
}

Table users {
  user_id        integer  [pk, increment]
  oid            integer  [not null, ref: > organizations.oid]
  username       varchar  [not null, unique]
  password_hash  varchar  [not null]
  role           varchar  [default: 'admin', note: 'admin / staff']
  created_at     datetime [default: `CURRENT_TIMESTAMP`]

  Note: 'Login accounts. Logging in as a user selects/locks the active oid for the whole session.'
}

Table students {
  stid         integer  [pk, increment]
  oid          integer  [not null, ref: > organizations.oid]
  rfid         varchar  [unique, note: 'Nullable. Can be assigned / removed / reassigned anytime']
  name         varchar  [not null]
  school       varchar
  contact1     varchar  [not null]
  contact2     varchar
  birthday     date
  address      varchar
  photo_path   varchar  [note: 'Local image file path; image bytes are not stored in SQLite']
  status       varchar  [default: 'active', note: 'active / inactive']
  created_at   datetime [default: `CURRENT_TIMESTAMP`]

  Note: 'age is NOT stored. It is calculated on the fly from birthday (see md doc).'
}

Table teachers {
  tid          integer  [pk, increment]
  oid          integer  [not null, ref: > organizations.oid]
  name         varchar  [not null]
  contact      varchar
  address      varchar
  description  varchar
  created_at   datetime [default: `CURRENT_TIMESTAMP`]
}

Table halls {
  hall_id   integer [pk, increment]
  oid       integer [not null, ref: > organizations.oid]
  name      varchar [not null]
  capacity  integer
}

Table classes {
  class_id                       integer  [pk, increment]
  oid                            integer  [not null, ref: > organizations.oid]
  class_name                     varchar  [not null]
  tid                            integer  [not null, ref: > teachers.tid]
  subject                        varchar
  fee                            decimal  [not null, note: 'full monthly fee']
  teacher_commission_percentage  decimal  [not null, note: '0-100, teacher share of each payment']
  hall_id                        integer  [ref: > halls.hall_id]
  status                         varchar  [default: 'active']
  created_at                     datetime [default: `CURRENT_TIMESTAMP`]
}

Table class_schedules {
  schedule_id   integer [pk, increment]
  class_id      integer [not null, ref: > classes.class_id]
  day_of_week   varchar [not null, note: 'monday..sunday']
  start_time    time    [not null]
  end_time      time    [not null]

  Note: 'Replaces the [{day,start,end}] array with one row per weekly slot.'
}

Table class_enrollments {
  enrollment_id        integer  [pk, increment]
  class_id             integer  [not null, ref: > classes.class_id]
  stid                 integer  [not null, ref: > students.stid]
  discount_percentage  decimal  [default: 0, note: '0 = pays full fee, 100 = free, 50 = pays half']
  enrolled_date        date     [default: `CURRENT_DATE`]
  status               varchar  [default: 'active', note: 'active / dropped']

  indexes {
    (class_id, stid) [unique]
  }

  Note: 'Replaces the enrolled-student array AND the discount array with a single row per student-per-class.'
}

Table sessions {
  session_id    integer  [pk, increment]
  class_id      integer  [not null, ref: > classes.class_id]
  session_date  date     [not null]
  start_time    time
  end_time      time
  status        varchar  [default: 'scheduled', note: 'scheduled / ongoing / completed / cancelled']
  created_at    datetime [default: `CURRENT_TIMESTAMP`]

  Note: 'One row is created per class per calendar occurrence. Attendance and session-based payment both hang off this.'
}

Table attendance {
  attendance_id  integer  [pk, increment]
  session_id     integer  [not null, ref: > sessions.session_id]
  stid           integer  [not null, ref: > students.stid]
  status         varchar  [default: 'not_marked', note: 'present / absent / not_marked']
  marked_at      datetime

  indexes {
    (session_id, stid) [unique]
  }
}

Table payments {
  payment_id     integer  [pk, increment]
  enrollment_id  integer  [not null, ref: > class_enrollments.enrollment_id]
  for_month      varchar  [not null, note: 'YYYY-MM, the month this payment covers']
  amount_paid    decimal  [not null]
  payment_date   date     [not null]
  payment_time   time     [not null]
  session_id     integer  [ref: > sessions.session_id, note: 'set only if paid from the session/attendance screen']
  recorded_by    integer  [ref: > users.user_id]
  notes          varchar
  created_at     datetime [default: `CURRENT_TIMESTAMP`]

  indexes {
    (enrollment_id, for_month) [unique]
  }

  Note: 'One row = one student paid one class for one month. Powers both payment entry flows described in the md doc.'
}

Table teacher_payouts {
  payout_id    integer  [pk, increment]
  tid          integer  [not null, ref: > teachers.tid]
  amount       decimal  [not null]
  payout_date  date     [not null]
  notes        varchar
  created_at   datetime [default: `CURRENT_TIMESTAMP`]

  Note: 'One row per time the organization actually pays a teacher (could bundle several classes/months).'
}

Table teacher_payout_details {
  detail_id         integer [pk, increment]
  payout_id         integer [not null, ref: > teacher_payouts.payout_id]
  class_id          integer [not null, ref: > classes.class_id]
  amount_for_class  decimal [not null]
  for_month         varchar
}

Table backup_logs {
  backup_id    integer  [pk, increment]
  oid          integer  [ref: > organizations.oid]
  backup_type  varchar  [note: 'local / google_drive']
  file_path    varchar
  status       varchar  [note: 'success / failed']
  created_at   datetime [default: `CURRENT_TIMESTAMP`]
}


## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** | Single codebase → installable `.exe` / `.dmg` / `.AppImage` |
| Database | **SQLite** via `better-sqlite3` | File-based, zero-config, easy to back up (it's just one file) |
| Renderer UI | React + Tailwind CSS (or Vue, either works) | Fast to build an attractive, responsive UI |
| IPC | Electron `ipcMain` / `ipcRenderer` (contextBridge, `contextIsolation: true`) | Renderer never touches SQLite directly — safer |
| Backup | Node `fs` (local) + `googleapis` (Google Drive) | Drive's free 15GB personal quota, no paid API tier needed |
| Packaging | `electron-builder` | One command → installers for Windows/Mac/Linux |

**Folder structure**
```
tuition-app/
├─ main/                  Electron main process
│  ├─ db/
│  │  ├─ schema.sql       CREATE TABLE statements (from the DBML below)
│  │  ├─ migrations/
│  │  └─ queries/         one file per entity: students.js, classes.js, payments.js...
│  ├─ backup/
│  │  ├─ local.js
│  │  └─ googleDrive.js
│  ├─ ipcHandlers.js
│  └─ main.js
├─ renderer/              React app (UI)
│  ├─ pages/  (Dashboard, Students, Teachers, Classes, Attendance, Payments, Reports, Settings)
│  ├─ components/
│  └─ App.jsx
├─ preload.js             contextBridge whitelist of IPC calls
└─ package.json
```

---

## 2. Database Diagram

Full DBML is in **`tuition_schema.dbml`** — paste it directly into https://dbdiagram.io
to see the visual diagram. Summary of every table and why it exists:

| Table | Purpose |
|---|---|
| `organizations` | The tenant. Everything else carries an `oid` foreign key. |
| `users` | Login accounts; logging in fixes which `oid` the whole app session works with. |
| `students` | Student master data. `rfid` is nullable + unique so a card can be assigned, removed, or moved to another student freely. |
| `teachers` | Teacher master data. |
| `halls` | Optional physical rooms, referenced by classes. |
| `classes` | One class = one subject taught by one teacher, with a fee and a teacher-commission %. |
| `class_schedules` | Weekly recurring time slots for a class (a class can meet more than once a week). |
| `class_enrollments` | Which students are in which class **and** their personal discount % — this single table replaces both arrays from your spec (`[stids]` and `[{stid, discount}]`). |
| `sessions` | One concrete occurrence of a class on a specific date (generated from `class_schedules`). Attendance and "pay from this session" both hang off a session row. |
| `attendance` | Per-student, per-session status: `present / absent / not_marked`. |
| `payments` | One row = one student paid one class for one month. Used by both payment-entry flows. |
| `teacher_payouts` + `teacher_payout_details` | Records the organization actually paying a teacher, broken down by which classes/months it covers. |
| `backup_logs` | History of local/Drive backups (success/failure, timestamp, file path). |

Key design decisions:
- **No stored `age`** — it's calculated at query time from `birthday`
  (`(julianday('now') - julianday(birthday)) / 365.25`), so it's never stale.
- **No JSON arrays stored in columns.** Even though SQLite *can* store JSON text, arrays like
  "enrolled students" or "discount list" are normalized into real rows
  (`class_enrollments`) so you can index, filter, and join them normally (e.g. "give me every
  unpaid student this month" is one SQL query, not JSON parsing).
- **`class_enrollments.discount_percentage`** directly matches your example:
  `stid 105 → discount 50` means student 105 pays 50% of the fee; `stid 102 → discount 100`
  means student 102 pays nothing.

---

## 3. Feature-by-Feature: What It Does & How the DB Is Used

### 3.1 Organizations & Multi-Tenant Login
- On first run, user creates an Organization + an admin user (`users` row).
- Login screen asks for org username/password → server-side (main process) look-up sets
  `currentOid` in memory (never trust the renderer to send `oid`, always resolve it from the
  authenticated session).
- **Every single query in every IPC handler is filtered by `WHERE oid = ?currentOid`.**
  This is the entire mechanism that keeps organizations separate — there is no other magic.
- Switching organizations = logging out and back in as a user belonging to the other `oid`.

### 3.2 Student Management
- CRUD screen with fields per your spec; `age` is a read-only computed column shown in the
  table/detail view, never stored/edited.
- **RFID assignment** (separate small modal, not the main student form):
  1. Open "Assign RFID" → scan/type the card ID.
  2. Query `SELECT stid FROM students WHERE rfid = ?`.
     - If it belongs to *another* student → show "Already assigned to <name>, reassign?"
       confirm → `UPDATE students SET rfid = NULL WHERE stid = old_owner` then set it on the
       new one (single transaction).
     - If free → just `UPDATE students SET rfid = ? WHERE stid = ?`.
  3. "Remove RFID" button just sets it back to `NULL`.
- **Search by RFID**: a global search box (usable from Attendance screen too) that does
  `SELECT * FROM students WHERE rfid = ? AND oid = ?` — this is how a card scan instantly
  pulls up a student during attendance marking.

### 3.3 Teachers, Halls, Classes
- Teacher & Hall CRUD are simple master tables.
- Creating a Class: pick teacher, subject, fee, commission %, optional hall, then add one or
  more weekly slots (`class_schedules` rows) via a small repeatable "day / start / end" form.
- Enrolling students into a class: multi-select existing students → creates
  `class_enrollments` rows with `discount_percentage` defaulting to 0, editable per student
  inline (this is where you set the 50%/free-style discounts).

### 3.4 Attendance — Session-Based Flow (exactly as you described)
1. **Generate sessions**: a scheduled job (or a "Generate this week's sessions" button) reads
   `class_schedules` and inserts a `sessions` row for each class/day that doesn't already
   exist for that date, `status = 'scheduled'`.
2. **Start a session**: teacher/staff picks a class → sees today's (or a chosen date's)
   session → clicking "Start" sets `status = 'ongoing'` and auto-creates one `attendance`
   row per **active** enrollment (`status='not_marked'`) — this is your "still not attend"
   state.
3. **Mark present**: tap a student (or scan their RFID) → `UPDATE attendance SET status =
   'present', marked_at = now WHERE session_id = ? AND stid = ?`.
4. **End session**: clicking "End" does one bulk update:
   `UPDATE attendance SET status='absent' WHERE session_id=? AND status='not_marked'`,
   then `sessions.status = 'completed'`. So anyone never tapped automatically becomes absent,
   exactly as you specified.
5. Attendance history per student/class is just a filtered read of `attendance` joined to
   `sessions`.

### 3.5 Payments — Both Entry Modes

**Mode A — from a session (attendance screen)**
- While a session is open, next to each student there's a "Mark Paid (this month)" action.
- Inserts into `payments`: `enrollment_id`, `for_month = current month`,
  `amount_paid = fee * (1 - discount/100)`, `payment_date/time = now`, `session_id = this
  session`. The `UNIQUE(enrollment_id, for_month)` constraint prevents double-paying the
  same month by accident (UI can instead offer "update" if it already exists).

**Mode B — from a student profile**
- Open a student → see every class they're enrolled in with a computed "pending months"
  list (any month from `enrolled_date` up to current month with no matching `payments` row).
- Show per-class amount due (fee minus their discount) and a total.
- Checkbox each pending class-month or "Pay All" → one transaction inserts multiple
  `payments` rows (session_id left `NULL` since it wasn't paid during a live session).

### 3.6 Class Earnings Dashboard (matches your worked example exactly)

For a given class + month, computed live (no stored totals, always accurate):

```
enrolled_count      = COUNT(class_enrollments WHERE class_id=? AND status='active')
full_amount         = enrolled_count * fee                       -- ignoring discounts
paid_rows           = payments WHERE enrollment_id IN (this class's enrollments)
                       AND for_month = ?
paid_students       = COUNT(DISTINCT paid_rows.stid)
not_paid_students   = enrolled_count - paid_students

full_earnings       = SUM(paid_rows.amount_paid)                  -- money actually collected
teacher_earnings    = full_earnings * teacher_commission_pct / 100
org_earnings        = full_earnings - teacher_earnings

-- pending = students who haven't paid yet, valued at THEIR discounted fee
pending_rows        = enrollments with no matching payment this month
pending_full_amount = SUM(fee * (1 - discount/100)) over pending_rows
pending_teacher     = pending_full_amount * commission_pct / 100
pending_org         = pending_full_amount - pending_teacher
```

Your example (Class A, 10 students, fee 1000, commission 80%, 5 paid, no discounts):
`full_earnings=5000, teacher_earnings=4000, org_earnings=1000, paid=5, not_paid=5,
pending_full_amount=5000, pending_teacher=4000, pending_org=1000` — matches this formula
exactly.

### 3.7 Teacher & Organization Reports
- **By Teacher**: list every class they teach, each with the block above; totals row sums
  `teacher_earnings` and `pending_teacher` across all their classes.
- **Organization-wide**: sums `org_earnings` / `pending_org` across *every* class in the org,
  plus a top-line "total collected this month" and "total pending this month".
- **Teacher payouts**: a screen to record `teacher_payouts` (amount + date + notes) with a
  multi-select of which classes/months it covers → writes `teacher_payout_details` rows.
  "Pending payment to teacher" = `SUM(teacher_earnings so far) - SUM(teacher_payouts already
  made)`.

### 3.8 Backups

**Local backup**
- "Backup Now" copies the single SQLite file (`app.db`) to a user-chosen folder with a
  timestamped name, e.g. `tuition_backup_2026-09-26_1830.db`, and logs it in `backup_logs`.
- Student image files are stored in the configured local image directory and are not part
  of the SQLite backup. The database contains their paths; keep the image directory when
  moving or restoring a workspace if the photos are needed.
- **Import/restore**: "Restore from file" → file picker → validate it's a real SQLite file
  with the expected tables (quick `PRAGMA table_info` check) → close current DB connection →
  copy the chosen file over `app.db` → reopen. Always auto-backup the *current* file first,
  so a bad restore is reversible.
- Optional: a scheduled auto-backup (e.g. daily at app close) to a fixed local folder, keeping
  the last N copies.

**Google Drive backup (free, no paid tier)**
- Uses a normal Google OAuth "Desktop app" client ID (free) with scope
  `drive.file` (the app can only see/manage files *it* created — nothing else in the user's
  Drive, which is both simpler to get approved and more private).
- First time: "Connect Google Drive" opens the system browser for consent → refresh token
  stored locally (encrypted with `electron-safeStorage`).
- "Backup to Drive" uploads the same timestamped `.db` file into an app-created folder
  (e.g. `TuitionAppBackups/`) using the Drive API's simple file upload — well within the free
  15GB personal quota for a file this small.
- "Restore from Drive" lists files in that folder (`files.list` scoped to `drive.file`),
  downloads the chosen one, and runs the same restore routine as local restore.

### 3.9 UI / UX
- Sidebar navigation: Dashboard, Students, Teachers, Classes, Attendance, Payments, Reports,
  Settings — collapses to icons-only or a hamburger drawer under ~900px width so the app is
  usable in a smaller window, not just maximized.
- Responsive layout via CSS Grid/Flexbox breakpoints (not fixed pixel widths) so resizing the
  Electron window never breaks the layout.
- RFID search box pinned in the header/topbar — usable from Students *and* Attendance screens.
- Color-coded status chips: green = paid/present/active, red = pending/absent/inactive,
  amber = ongoing session.
- Dashboard landing page: today's sessions, quick attendance shortcuts, this month's
  collected vs pending totals, last backup date/time (nudges the user if it's been a while).

---

## 4. Suggested Build Order

1. SQLite schema + seed script (`schema.sql` from the DBML).
2. Electron shell + IPC scaffolding + login/org selection.
3. Students CRUD + RFID assign/search.
4. Teachers, Halls, Classes (+ schedules + enrollments/discounts).
5. Session generation + Attendance flow.
6. Payments (both modes) + the earnings formulas in §3.6.
7. Teacher/org reports + teacher payouts.
8. Local backup/restore.
9. Google Drive backup/restore.
10. UI polish pass (responsiveness, empty states, loading states).

---

## 5. Files in This Delivery
- `tuition_schema.dbml` — paste into dbdiagram.io for the visual ER diagram.
- `TUITION_MANAGEMENT_SYSTEM.md` — this document.
