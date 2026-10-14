# Google Drive backup setup checklist

Complete the Google Cloud steps once for the app, then connect each tuition
centre's own Google account from **Settings**. The app and database remain local;
Google Drive stores only encrypted SQLite backup files. No hosting, database
server, Firebase project, or service account is needed.

## 1. Create the OAuth client

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) with an
   account you control and create/select a project for Tuition Manager. Creating
   a project does not mean hosting the app in Google Cloud.
2. In **APIs & Services → Library**, enable **Google Drive API**. Drive API
   access for this desktop workflow uses the user's Drive storage and API quota;
   it does not upload data to a Tuition Manager server. Follow any current
   Console quota/billing prompts, but do not set up paid hosting.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**)
   and configure the app name and support/developer contact details. For
   personal Google accounts, choose an **External** audience. An **Internal**
   audience is only suitable when all users belong to the same Google Workspace
   organization.
4. While the consent screen is in **Testing**, add every Google account that
   will connect under **Test users**. Google's testing-user and refresh-token
   restrictions apply; in particular, external apps left in testing can have
   refresh tokens expire after seven days for scopes beyond basic profile
   access, so users may need to reconnect. Publishing or verification
   requirements depend on the selected audience and Google's current scope
   classification/policies. The app requests `drive.file` plus basic account
   identity; review the Console's current verification prompts before wider
   distribution.
5. Create an OAuth client with application type **Desktop app**. Open
   **Google Cloud → Clients**, select that client, and copy both its **Client
   ID** and **Client secret**. Do not create a service account or choose a Web
   application client. Desktop client secrets are part of a public-client
   configuration and cannot be treated as confidential; Tuition Manager stores
   the configured value locally using operating-system-protected storage. The
   app uses the system browser and PKCE with a temporary local loopback callback.
6. Keep the same Desktop OAuth client ID for all copies of the distributed
   application. Each tuition centre can authorize its own Google account.
7. On Linux, make sure a supported desktop key store (for example Secret
   Service/libsecret) is available. The app deliberately refuses to save
   credentials when Electron reports that only the insecure `basic_text`
   backend is available.

## 2. Configure Tuition Manager

1. Open **Settings → Google Drive automatic backup**.
2. Paste the Desktop OAuth **Client ID** and matching **Client secret** from
   Google Cloud → Clients into their respective fields. The secret is masked
   and stored locally using operating-system-protected storage; it is not
   returned to the settings page after saving.
3. Choose a recovery passphrase of at least 12 characters, enter it twice, and
   save. Use a passphrase you can securely retain and type on another computer.
   Electron stores its local copy with the operating system's protected secure
   storage; it is not stored in SQLite or in Drive.
4. Keep the defaults or select a local backup time, retention of the last 7 or
   30 backups, or **Keep all backups**, and whether to catch up after a missed
   run. Save the settings.
5. Select **Connect Google Drive**. Complete Google's authorization in the
   system browser and return to the app. The connected email is shown in
   Settings. Disconnecting removes the local OAuth token; it does not delete
   Drive backups.
6. Select **Backup Now** to make an immediate encrypted backup. This manual
   upload does not count as that day's scheduled backup.

## 3. Check automatic backups

1. Leave automatic backups enabled and keep Tuition Manager open and signed in
   at the configured local time (default **3:00 PM**).
2. Check Settings for the last successful Drive backup and recent history. In
   Google Drive, the app-created files are in **Tuition Manager Backups** and
   have `.db.enc` names.
3. To test missed-backup recovery, set the time a few minutes ahead, save, keep
   the app signed in and connected, and wait for the scheduled result. Then set
   a time in the past, close the app before that time, reopen it and sign in.
   With missed recovery enabled, it attempts one catch-up backup for that local
   calendar day.
4. Scheduled backups do **not** run while the application is closed. Successful
   scheduled dates and retry times are persisted so restarts do not cause
   duplicate successful daily backups. Temporary network failures are retried
   with backoff and later retry attempts.
5. Test local backups separately with **Settings → Backup & restore → Back up
   now**. Local backups remain available if Drive is disconnected.

## 4. Restore on another computer

1. Install and open Tuition Manager on the other computer. Complete initial
   setup with the same tuition-centre name as the source workspace; the app uses
   that name to keep Drive backups separated by centre.
2. In Settings, enter the same Desktop OAuth Client ID and Client secret and
   the exact recovery passphrase used for the backup. Save and connect the same
   Google account.
3. Select **List backups**, choose the intended file, and select **Restore**.
   Confirm the replacement prompt. The app downloads and decrypts the file,
   checks SQLite integrity and Tuition Manager compatibility, and retains a
   local safety copy before restoring.
4. After it returns to the sign-in screen, sign in using the username and
   password contained in the restored database. If photos are required, also
   copy the original student image folder; image files are intentionally not
   backed up.
5. Keep the recovery passphrase that encrypted each backup. Changing the
   passphrase affects future backups only; older files still require their
   original passphrase. Losing it makes encrypted Drive backups unrecoverable.

## Important limitations

- Backups include the SQLite database only. Student/teacher images are stored as
  external local files and are neither copied nor uploaded; database photo
  paths remain in the backup.
- Automatic work runs only while the app is open and signed in. It is not a
  Windows/macOS/Linux background service and makes no backup while the computer
  or app is off.
- Google account authorization is device-local. A second computer must connect
  the same Google account and use the same OAuth client ID and recovery
  passphrase.
- Cloud backup files are AES-256-GCM encrypted. Local `.db` backups and the
  active `app.db` are not encrypted.
- `drive.file` limits access to files created or selected by this app. The app
  creates and manages its own backup folder/files and does not delete unrelated
  Drive content.
- Drive capacity, API quotas, internet connectivity, OAuth consent status and
  the user's Google account remain external dependencies. Keep a separate local
  backup as additional protection.
