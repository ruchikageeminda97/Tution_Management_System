# Tuition Manager

A desktop tuition-centre manager built with Electron, React and SQLite. It keeps the day-to-day work—students, teachers, classes, attendance and tuition payments—in one locally stored workspace.

## Run on Windows

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. Open a terminal in this folder and run `npm install`.
3. Run `npm run desktop` to open the desktop app in development mode.
4. The first time the app opens, create your tuition centre and administrator account.

The application database is saved in Electron’s application data folder, not in the source-code directory. Passwords are stored as salted scrypt hashes. The renderer has no direct filesystem or database access; database operations pass through the Electron preload bridge.

## Build an installer

- `npm run build` builds the renderer.
- `npm test` runs SQLite, fee/attendance, and Excel import/template regression tests.
- `npm run test:electron` checks that SQLite loads in Electron’s runtime.
- `npm run dist` builds a platform installer (`.exe`, `.dmg` or `.AppImage`) for the current operating system.

Student and teacher pages include downloadable Excel templates and `.xlsx` import actions. Imports add new records to the current organization; student templates require a name and primary contact, and teacher templates require a name. Files may contain up to 5,000 records and must be no larger than 20 MB. The Payments page can be filtered to one student's unpaid class fees.

## Included workflows

- Student and teacher records with Excel (`.xlsx`) import and downloadable templates; student birth dates, contacts, optional profile photos stored as local image files and RFID-card assignment/search.
- Class setup, weekly schedules, optional halls with editable weekly availability, student enrolments and individual fee discounts.
- Session generation from the weekly timetable plus one-time special sessions with a chosen class, date, time and optional hall; selected halls are checked against weekly availability and overlapping bookings.
- Attendance registers with automatic RFID scanning and student details, separate register-open/class-start/end steps with recorded timestamps, student arrival punches and late-minute tracking, automatic absent marking when a session ends, attendance PDF exports with class/teacher and attendance timing details, and a non-blocking yellow warning for unpaid monthly fees after the organization's recurring payment due day.
- Monthly tuition collection from the payments screen or attendance register, with duplicate-payment protection.
- Class earnings, outstanding fees, teacher commissions, organization shares, teacher opening payable balances (manual or Excel import) and teacher-payout records, plus selectable-date daily summary PDFs covering receipts by class, teacher payouts, active students and session attendance. Printable A4 landscape annual payment-register PDFs have a separate ruled January–December sheet for each class.
- Editable organization details, a recurring student payment due day (1–31), configurable local photo storage, local SQLite backup/validated restore, and encrypted Google Drive backup/restore. Restore makes a safety copy of the active database.

## Data and backup notes

Each signed-in account is scoped to its organization. The database currently supports one initial administrator account per fresh installation; additional staff-account management is not yet exposed in the interface. Google Drive backup must be configured in **Settings** with the matching Google Desktop OAuth Client ID and Client secret plus a recovery passphrase. OAuth tokens, the client secret, and the locally cached passphrase are protected with the operating system's secure storage; the recovery passphrase is required to decrypt backups on another computer. See [`new.md`](new.md) for the required Google Console setup and step-by-step testing.

Choose a student-photo folder during first-time setup or later in Settings. Changing the folder moves existing photos there. Database backups contain student records and photo paths, but do not include the image files; keep the image folder when moving or restoring a workspace if photos must remain available.

Google Drive uploads contain only an encrypted SQLite snapshot; student photos are stored outside the database and are not uploaded. The weekly automatic schedule supports multiple times per day, writes database snapshots to a configurable local folder, and also uploads encrypted copies when Google Drive is connected. When several run times are missed while the app is closed, reopening the app can trigger one catch-up backup rather than one per missed time. Local database files and local backups are not encrypted, so keep them somewhere trusted. Google Drive backups use AES-256-GCM and cannot be recovered without the recovery passphrase.

Amounts are displayed using the computer’s locale number formatting; the app does not yet store a currency code. Choose a consistent currency for records managed in this workspace.

When enrolling students, the app shows each student’s tuition after their discount and the resulting teacher and organization shares. For example, a 50% discount on a 1,000 fee results in 500 due; at 80% teacher commission, the teacher receives 400 and the organization receives 100. A zero discount means the full 1,000 fee.
