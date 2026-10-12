const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { openDatabase, getDatabase, resetDatabase } = require('./database');
const { createCloudBackup, prepareRestoreFile, validateDatabaseFile } = require('./services/backup-service');
const { createBackupScheduler, localDate: backupLocalDate } = require('./services/backup-scheduler');
const { GoogleDriveService } = require('./services/google-drive');
const { SecureStore } = require('./services/secure-store');
const { overlaps, slotIsAvailable, validateSlots, validTime } = require('./scheduling');
const { overduePaymentMonths } = require('./payment-due');
const { buildAttendanceReportHtml } = require('./attendance-report');
const { buildDailySummaryReportHtml } = require('./daily-summary-report');
const { buildClassPaymentReportHtml } = require('./class-payment-report');
const { createTemplateBuffer, parseExcelRecords } = require('./record-import');
const { completeOngoingSession, endExpiredSessions } = require('./session-lifecycle');
const { recordPaymentReceipt, listRecentPaymentReceipts } = require('./payment-receipt');
const { buildPaymentReceiptHtml } = require('./payment-receipt-report');
const { recoverExistingAdmin } = require('./account-recovery');
const {
  changeImageDirectory,
  decodeImageData,
  ensureImageDirectory,
  migrateLegacyStudentPhotos,
  readStudentImage,
  removeFiles,
  writeStudentImage
} = require('./student-images');

let window;
let activeUser = null;
let driveService;
let backupScheduler;
let backupOperationRunning = false;
const dev = !app.isPackaged;
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex')
});
const verifyPassword = (password, stored) => {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
};
const today = () => new Date().toISOString().slice(0, 10);
const localDate = (date = new Date()) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');
const currentMonth = () => today().slice(0, 7);
const validMonth = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const validDate = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const requireUser = () => {
  if (!activeUser) throw new Error('Please sign in to continue.');
  return activeUser;
};
const org = () => requireUser().oid;

function getBackupSettings(oid = org()) {
  const database = getDatabase();
  database.prepare('INSERT INTO backup_settings (oid) VALUES (?) ON CONFLICT(oid) DO NOTHING').run(oid);
  return database.prepare('SELECT * FROM backup_settings WHERE oid=?').get(oid);
}

function backupErrorMessage(error) {
  return String(error?.message || 'The backup operation failed.')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/ya29\.[\w.-]+/g, '[redacted]')
    .replace(/1\/\/[\w.-]+/g, '[redacted]')
    .slice(0, 300);
}

function organizationBackupKey(organizationName) {
  return crypto.createHash('sha256').update(String(organizationName).trim().toLocaleLowerCase()).digest('hex').slice(0, 32);
}

function recordBackup(oid, type, filePath, status, error) {
  getDatabase().prepare(`INSERT INTO backup_logs (oid,backup_type,file_path,status,error_message)
    VALUES (?,?,?,?,?)`).run(oid, type, filePath || null, status, error ? backupErrorMessage(error) : null);
}

function checkScheduledBackupAfterLogin() {
  if (backupScheduler) {
    void backupScheduler.checkStartup().catch(error => console.error('Scheduled cloud backup failed:', backupErrorMessage(error)));
  }
}

async function runGoogleBackup(type, scheduledDate) {
  if (backupOperationRunning) throw new Error('Another backup or restore operation is already in progress.');
  const user = requireUser();
  const settings = getBackupSettings(user.oid);
  if (type === 'google-scheduled' && !settings.auto_enabled) {
    throw new Error('Automatic Google Drive backups are disabled.');
  }
  if (type === 'google-scheduled' && settings.last_scheduled_date === scheduledDate) {
    return { skipped: true };
  }
  const connected = driveService.status(user.oid).connected;
  if (!connected) throw new Error('Connect a Google account before using Drive backups.');
  const passphrase = driveService.getPassphrase(user.oid);
  if (!passphrase) throw new Error('Set a recovery passphrase in Backup settings before backing up.');
  backupOperationRunning = true;
  let uploaded;
  try {
    const orgKey = organizationBackupKey(user.organization);
    const drive = {
      uploadBackup: (filePath, backupType) =>
        driveService.uploadBackup(filePath, backupType, user.oid, orgKey, scheduledDate)
    };
    if (type === 'google-scheduled') {
      uploaded = await driveService.findScheduledBackup(user.oid, orgKey, scheduledDate);
    }
    if (!uploaded) {
      uploaded = await createCloudBackup({
        database: getDatabase(),
        drive,
        organizationId: user.oid,
        passphrase,
        type
      });
    }
    const retention = await driveService.retentionForSettings(user.oid, settings.retention, uploaded.id, orgKey)
      .catch(error => ({ deleted: 0, errors: [backupErrorMessage(error)] }));
    getDatabase().prepare(`UPDATE backup_settings
      SET last_status='success',last_error=?,last_backup_at=?,last_scheduled_date=CASE WHEN ? IS NULL THEN last_scheduled_date ELSE ? END,retry_after=NULL
      WHERE oid=?`).run(
      retention.errors.length ? `Backup uploaded; retention cleanup: ${retention.errors.join('; ')}` : null,
      new Date().toISOString(), scheduledDate || null, scheduledDate || null, user.oid
    );
    recordBackup(user.oid, type, uploaded.id, 'success',
      retention.errors.length ? new Error(`Upload succeeded, but some old backups could not be removed: ${retention.errors.join('; ')}`) : null);
    return { uploaded, retention };
  } catch (error) {
    const message = backupErrorMessage(error);
    getDatabase().prepare(`UPDATE backup_settings SET last_status='failed',last_error=?,retry_after=? WHERE oid=?`)
      .run(message, new Date(Date.now() + 15 * 60 * 1000).toISOString(), user.oid);
    recordBackup(user.oid, type, uploaded?.id || null, 'failed', error);
    throw error;
  } finally {
    backupOperationRunning = false;
  }
}

async function restoreDatabaseFile(source, {
  expectedOrganizationName,
  organizationId,
  retainSafetyCopy = false,
  backupLogReference,
  onRestoredOrganization = () => {}
} = {}) {
  validateDatabaseFile(source);
  const Database = require('better-sqlite3');
  let candidate;
  try {
    candidate = new Database(source, { readonly: true, fileMustExist: true });
    const organization = expectedOrganizationName
      ? candidate.prepare('SELECT oid,name FROM organizations WHERE name=? COLLATE NOCASE').get(expectedOrganizationName)
      : candidate.prepare('SELECT oid,name FROM organizations WHERE oid=?').get(organizationId);
    if (!organization) throw new Error('This backup does not contain the expected tuition centre.');
    candidate.close();
    candidate = null;
    const database = getDatabase();
    database.pragma('wal_checkpoint(TRUNCATE)');
    const databaseFile = path.join(app.getPath('userData'), 'app.db');
    if (path.resolve(source).toLowerCase() === path.resolve(databaseFile).toLowerCase()) {
      throw new Error('Choose a separate backup file, not the database currently in use.');
    }
    const safetyCopy = `${databaseFile}.before-restore-${Date.now()}.db`;
    fs.copyFileSync(databaseFile, safetyCopy);
    const previousUser = activeUser;
    try {
      database.close();
      fs.copyFileSync(source, databaseFile);
      openDatabase(databaseFile);
      migrateLegacyStudentPhotos(getDatabase(), path.join(app.getPath('userData'), 'student-images'));
      if (retainSafetyCopy) {
        const restoredOrganization = getDatabase().prepare('SELECT oid FROM organizations WHERE name=? COLLATE NOCASE')
          .get(organization.name);
        onRestoredOrganization(restoredOrganization.oid);
        recordBackup(restoredOrganization.oid, 'google-restore', backupLogReference || source, 'success');
        activeUser = null;
      } else {
        activeUser = getDatabase().prepare(`SELECT u.user_id,u.oid,u.username,u.role,o.name AS organization
          FROM users u JOIN organizations o ON o.oid=u.oid WHERE u.user_id=?`).get(previousUser.user_id);
        if (!activeUser) throw new Error('Restored backup no longer contains the signed-in account. Sign in again.');
        recordBackup(activeUser.oid, 'restore', source, 'success');
      }
      if (!retainSafetyCopy) fs.rmSync(safetyCopy, { force: true });
      return { restored: true, safetyCopy: retainSafetyCopy ? safetyCopy : undefined, requiresSignIn: retainSafetyCopy };
    } catch (error) {
      try {
        if (getDatabase()) getDatabase().close();
      } catch {}
      fs.copyFileSync(safetyCopy, databaseFile);
      openDatabase(databaseFile);
      migrateLegacyStudentPhotos(getDatabase(), path.join(app.getPath('userData'), 'student-images'));
      activeUser = previousUser;
      throw new Error(`Restore failed; the previous database was recovered. ${error.message}`);
    }
  } finally {
    if (candidate && candidate.open) candidate.close();
  }
}

function findPaymentReceipt(receiptCode) {
  if (!/^\d{8}$/.test(receiptCode)) throw new Error('Enter an 8-digit payment receipt number.');
  const db = getDatabase();
  const receipt = db.prepare(`SELECT receipt_id,receipt_code,payment_date,payment_time
    FROM payment_receipts WHERE oid=? AND receipt_code=?`).get(org(), receiptCode);
  if (!receipt) return null;
  const rows = db.prepare(`SELECT p.payment_id,p.for_month,p.amount_paid,s.stid,s.name AS student_name,
      s.rfid,c.class_name
    FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
    JOIN students s ON s.stid=e.stid JOIN classes c ON c.class_id=e.class_id
    WHERE p.receipt_id=? AND c.oid=? AND s.oid=c.oid
    ORDER BY p.for_month,s.name COLLATE NOCASE,c.class_name COLLATE NOCASE`).all(receipt.receipt_id, org());
  return { ...receipt, rows, total: money(rows.reduce((sum, row) => sum + Number(row.amount_paid), 0)) };
}

async function createPaymentReceiptWindow(user, receipt) {
  const reportWindow = new BrowserWindow({
    show: false,
    parent: window,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  try {
    const html = buildPaymentReceiptHtml({
      organization: user.organization,
      receipt,
      rows: receipt.rows,
      total: receipt.total
    });
    await reportWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    return reportWindow;
  } catch (error) {
    if (!reportWindow.isDestroyed()) reportWindow.close();
    throw error;
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 650,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const permitted = dev
      ? url.startsWith('http://127.0.0.1:5173/')
      : url.startsWith('file://');
    if (!permitted) event.preventDefault();
  });
  if (dev) window.loadURL('http://127.0.0.1:5173');
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function scopedList(table, columns, orderBy) {
  return () => getDatabase().prepare(`SELECT ${columns} FROM ${table} WHERE oid = ? ORDER BY ${orderBy}`).all(org());
}

function registerIpc() {
  ipcMain.handle('auth:status', () => ({
    needsSetup: getDatabase().prepare('SELECT COUNT(*) AS count FROM users').get().count === 0,
    user: activeUser ? { username: activeUser.username, organization: activeUser.organization, role: activeUser.role } : null
  }));
  ipcMain.handle('images:chooseDirectory', async (_event, currentPath) => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose student photo folder',
      defaultPath: typeof currentPath === 'string' && currentPath ? currentPath : app.getPath('userData'),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths[0]
      ? { canceled: true }
      : { canceled: false, directory: result.filePaths[0] };
  });
  ipcMain.handle('auth:setup', (_event, input) => {
    const name = String(input.organization || '').trim();
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    if (!name || !username || password.length < 8) throw new Error('Enter an organization, username, and password of at least 8 characters.');
    const imageDirectory = ensureImageDirectory(input.image_directory);
    const database = getDatabase();
    const create = database.transaction(() => {
      if (database.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new Error('Initial setup has already been completed. Sign in instead.');
      const result = database.prepare('INSERT INTO organizations (name, contact, image_directory) VALUES (?, ?, ?)').run(name, String(input.contact || '').trim(), imageDirectory);
      const credentials = hashPassword(password);
      const user = database.prepare('INSERT INTO users (oid, username, password_hash, role) VALUES (?, ?, ?, ?)').run(
        result.lastInsertRowid, username, `${credentials.salt}:${credentials.hash}`, 'admin'
      );
      return { oid: result.lastInsertRowid, user_id: user.lastInsertRowid };
    });
    const created = create();
    activeUser = { ...created, username, organization: name, role: 'admin' };
    checkScheduledBackupAfterLogin();
    return { username, organization: name, role: 'admin' };
  });
  ipcMain.handle('auth:login', (_event, input) => {
    const username = String(input.username || '').trim();
    const user = getDatabase().prepare(
      'SELECT u.user_id, u.oid, u.username, u.password_hash, u.role, o.name AS organization FROM users u JOIN organizations o ON o.oid = u.oid WHERE u.username = ? COLLATE NOCASE'
    ).get(username);
    if (!user || !verifyPassword(String(input.password || ''), user.password_hash)) throw new Error('Username or password is incorrect.');
    activeUser = user;
    checkScheduledBackupAfterLogin();
    return { username: user.username, organization: user.organization, role: user.role };
  });
  ipcMain.handle('auth:recover', (_event, input) => {
    activeUser = recoverExistingAdmin(getDatabase(), input, hashPassword);
    checkScheduledBackupAfterLogin();
    return {
      username: activeUser.username,
      organization: activeUser.organization,
      role: activeUser.role
    };
  });
  ipcMain.handle('auth:resetDatabase', async () => {
    if (activeUser) throw new Error('Sign out before resetting the database.');
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Reset all local data?',
      message: 'This permanently deletes all data in this app on this computer.',
      detail: 'Workspaces, students, teachers, classes, attendance, payments, and backups recorded in the app will be erased. This cannot be undone.',
      buttons: ['Cancel', 'Reset database'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (result.response !== 1) return { reset: false };
    const photoPaths = getDatabase().prepare('SELECT photo_path FROM students WHERE photo_path IS NOT NULL').all()
      .map(student => student.photo_path);
    for (const organization of getDatabase().prepare('SELECT oid FROM organizations').all()) {
      driveService.forgetOrganization(organization.oid);
    }
    resetDatabase(getDatabase());
    removeFiles(photoPaths);
    activeUser = null;
    return { reset: true };
  });
  ipcMain.handle('auth:logout', () => { activeUser = null; return true; });
  ipcMain.handle('dashboard:get', () => {
    const oid = org();
    const db = getDatabase();
    return {
      students: db.prepare("SELECT COUNT(*) AS count FROM students WHERE oid=? AND status='active'").get(oid).count,
      teachers: db.prepare('SELECT COUNT(*) AS count FROM teachers WHERE oid=?').get(oid).count,
      classes: db.prepare("SELECT COUNT(*) AS count FROM classes WHERE oid=? AND status='active'").get(oid).count,
      collected: db.prepare('SELECT COALESCE(SUM(p.amount_paid),0) AS amount FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id JOIN classes c ON c.class_id=e.class_id WHERE c.oid=? AND p.for_month=?').get(oid, currentMonth()).amount,
      pending: getPendingTotal(oid, currentMonth()),
      sessions: db.prepare("SELECT s.session_id,s.session_date,s.start_time,s.end_time,s.status,s.ended_automatically,c.class_name,c.subject FROM sessions s JOIN classes c ON c.class_id=s.class_id WHERE c.oid=? AND s.session_date=? AND s.status!='cancelled' ORDER BY s.start_time").all(oid, today()),
      lastBackup: db.prepare("SELECT created_at,file_path FROM backup_logs WHERE oid=? AND status='success' ORDER BY backup_id DESC LIMIT 1").get(oid) || null
    };
  });
  ipcMain.handle('students:list', scopedList('students', 'stid,rfid,name,school,contact1,contact2,birthday,address,status', 'name COLLATE NOCASE'));
  ipcMain.handle('students:photo', (_event, stid) => {
    const studentId = Number(stid);
    if (!Number.isInteger(studentId) || studentId < 1) throw new Error('Choose a valid student.');
    const student = getDatabase().prepare('SELECT photo_path FROM students WHERE stid=? AND oid=?').get(studentId, org());
    if (!student) throw new Error('Student not found.');
    return readStudentImage(student.photo_path);
  });
  ipcMain.handle('students:choosePhoto', async () => {
    requireUser();
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a student photo',
      properties: ['openFile'],
      filters: [{ name: 'Student image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const filePath = result.filePaths[0];
    const image = await fs.promises.readFile(filePath);
    if (image.length > 2 * 1024 * 1024) throw new Error('Student photos must be 2 MB or smaller.');
    const mime = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
      ? 'image/jpeg'
      : image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? 'image/png'
        : image.subarray(0, 4).toString('ascii') === 'RIFF' && image.subarray(8, 12).toString('ascii') === 'WEBP'
          ? 'image/webp'
          : null;
    if (!mime) throw new Error('Choose a valid JPEG, PNG or WebP image.');
    return { canceled: false, data: `data:${mime};base64,${image.toString('base64')}` };
  });
  ipcMain.handle('records:downloadTemplate', async (_event, kind) => {
    const user = requireUser();
    if (!['students', 'teachers'].includes(kind)) throw new Error('Choose student or teacher records.');
    const label = kind === 'students' ? 'Student' : 'Teacher';
    const result = await dialog.showSaveDialog(window, {
      title: `Download ${label} Excel template`,
      defaultPath: `${kind}-template.xlsx`,
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = result.filePath.toLowerCase().endsWith('.xlsx') ? result.filePath : `${result.filePath}.xlsx`;
    fs.writeFileSync(filePath, Buffer.from(await createTemplateBuffer(kind)));
    return { canceled: false, filePath };
  });
  ipcMain.handle('records:import', async (_event, kind) => {
    const user = requireUser();
    if (!['students', 'teachers'].includes(kind)) throw new Error('Choose student or teacher records.');
    const label = kind === 'students' ? 'Student' : 'Teacher';
    const result = await dialog.showOpenDialog(window, {
      title: `Import ${label} records`,
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const filePath = result.filePaths[0];
    const { size } = fs.statSync(filePath);
    if (size > 20 * 1024 * 1024) throw new Error('Excel files must be 20 MB or smaller.');
    const records = await parseExcelRecords(await fs.promises.readFile(filePath), kind);
    const db = getDatabase();
    const insertStudents = db.prepare(`INSERT INTO students
      (oid,name,school,contact1,contact2,birthday,address,status) VALUES (?,?,?,?,?,?,?,?)`);
    const insertTeachers = db.prepare(`INSERT INTO teachers
      (oid,name,contact,address,description) VALUES (?,?,?,?,?)`);
    db.transaction(() => records.forEach((record) => {
      if (kind === 'students') {
        insertStudents.run(user.oid, record.name, record.school || null, record.contact1, record.contact2 || null,
          record.birthday, record.address || null, record.status);
      } else {
        insertTeachers.run(user.oid, record.name, record.contact || null, record.address || null, record.description || null);
      }
    }))();
    return { canceled: false, count: records.length, fileName: path.basename(filePath) };
  });
  ipcMain.handle('students:save', (_event, input) => {
    const db = getDatabase();
    const values = [String(input.name || '').trim(), String(input.school || ''), String(input.contact1 || '').trim(), String(input.contact2 || ''), input.birthday || null, String(input.address || ''), input.status === 'inactive' ? 'inactive' : 'active'];
    if (!values[0] || !values[2]) throw new Error('Student name and primary contact are required.');
    const hasPhoto = Object.hasOwn(input, 'photo_data');
    const photoData = input.photo_data ?? null;
    if (photoData !== null) decodeImageData(photoData);
    const oid = org();
    const imageDirectory = db.prepare('SELECT image_directory FROM organizations WHERE oid=?').get(oid).image_directory;
    let createdPath = null;
    let previousPath = null;
    try {
      const save = db.transaction(() => {
        if (input.stid) {
          const student = db.prepare('SELECT photo_path FROM students WHERE stid=? AND oid=?').get(input.stid, oid);
          if (!student) throw new Error('Student not found.');
          previousPath = student.photo_path;
          const photoPath = hasPhoto && photoData !== null
            ? (createdPath = writeStudentImage(imageDirectory, input.stid, photoData))
            : hasPhoto ? null : student.photo_path;
          db.prepare(`UPDATE students SET name=?,school=?,contact1=?,contact2=?,birthday=?,address=?,status=?,photo_path=?
            WHERE stid=? AND oid=?`).run(...values, photoPath, input.stid, oid);
          return input.stid;
        }
        const stid = db.prepare(`INSERT INTO students
          (oid,name,school,contact1,contact2,birthday,address,status,photo_path) VALUES (?,?,?,?,?,?,?,?,NULL)`)
          .run(oid, ...values).lastInsertRowid;
        if (photoData !== null) {
          createdPath = writeStudentImage(imageDirectory, stid, photoData);
          db.prepare('UPDATE students SET photo_path=? WHERE stid=? AND oid=?').run(createdPath, stid, oid);
        }
        return stid;
      });
      const stid = save();
      if (previousPath && previousPath !== createdPath &&
          !db.prepare('SELECT 1 FROM students WHERE photo_path=? LIMIT 1').get(previousPath)) {
        removeFiles([previousPath]);
      }
      return stid;
    } catch (error) {
      if (createdPath) removeFiles([createdPath]);
      throw error;
    }
  });
  ipcMain.handle('students:delete', (_event, stid) => {
    const result = getDatabase().prepare("UPDATE students SET status='inactive' WHERE stid=? AND oid=?").run(stid, org());
    if (!result.changes) throw new Error('Student not found.');
    return true;
  });
  ipcMain.handle('students:assignRfid', (_event, { stid, rfid, reassign }) => {
    const db = getDatabase();
    const id = Number(stid);
    const card = String(rfid || '').trim();
    if (!card) throw new Error('Scan or enter an RFID card number.');
    const student = db.prepare('SELECT stid FROM students WHERE stid=? AND oid=?').get(id, org());
    if (!student) throw new Error('Student not found.');
    const existing = db.prepare('SELECT stid,name FROM students WHERE rfid=? AND oid=?').get(card, org());
    if (!existing && db.prepare('SELECT 1 FROM students WHERE rfid=?').get(card)) {
      throw new Error('This card is already associated with a different organization.');
    }
    if (existing && existing.stid !== id && !reassign) return { conflict: existing.name };
    db.transaction(() => {
      if (existing && existing.stid !== id) db.prepare('UPDATE students SET rfid=NULL WHERE stid=? AND oid=?').run(existing.stid, org());
      db.prepare('UPDATE students SET rfid=? WHERE stid=? AND oid=?').run(card, id, org());
    })();
    return { success: true };
  });
  ipcMain.handle('students:removeRfid', (_event, stid) => getDatabase().prepare('UPDATE students SET rfid=NULL WHERE stid=? AND oid=?').run(stid, org()).changes > 0);
  ipcMain.handle('students:byRfid', (_event, rfid) => getDatabase().prepare('SELECT stid,name,rfid FROM students WHERE rfid=? AND oid=? AND status=?').get(String(rfid).trim(), org(), 'active') || null);
  ipcMain.handle('students:fees', (_event, stid) => {
    const db = getDatabase();
    if (!db.prepare('SELECT 1 FROM students WHERE stid=? AND oid=?').get(stid, org())) throw new Error('Student not found.');
    const enrollments = db.prepare(`SELECT e.enrollment_id,e.enrolled_date,e.discount_percentage,c.class_name,c.fee
      FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id
      WHERE e.stid=? AND e.status='active' AND c.oid=? AND c.status='active' ORDER BY c.class_name`).all(stid, org());
    return enrollments.map(enrollment => ({
      ...enrollment,
      paid_months: db.prepare('SELECT for_month FROM payments WHERE enrollment_id=? AND for_month<=?').all(enrollment.enrollment_id, currentMonth()).map(payment => payment.for_month)
    }));
  });
  ipcMain.handle('teachers:list', scopedList('teachers', 'tid,name,contact,address,description', 'name COLLATE NOCASE'));
  ipcMain.handle('teachers:save', (_event, input) => {
    const db = getDatabase();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Teacher name is required.');
    const vals = [name, String(input.contact || ''), String(input.address || ''), String(input.description || '')];
    if (input.tid) {
      const result = db.prepare('UPDATE teachers SET name=?,contact=?,address=?,description=? WHERE tid=? AND oid=?').run(...vals, input.tid, org());
      if (!result.changes) throw new Error('Teacher not found.');
      return input.tid;
    }
    return db.prepare('INSERT INTO teachers (oid,name,contact,address,description) VALUES (?,?,?,?,?)').run(org(), ...vals).lastInsertRowid;
  });
  ipcMain.handle('teachers:delete', (_event, tid) => {
    const db = getDatabase();
    if (db.prepare('SELECT 1 FROM classes WHERE tid=? AND oid=? LIMIT 1').get(tid, org())) throw new Error('Move the teacher’s classes before removing this teacher.');
    return db.prepare('DELETE FROM teachers WHERE tid=? AND oid=?').run(tid, org()).changes > 0;
  });
  ipcMain.handle('halls:list', () => {
    const db = getDatabase();
    return db.prepare(`SELECT h.hall_id,h.name,h.capacity,
      (SELECT COUNT(*) FROM classes c WHERE c.hall_id=h.hall_id AND c.oid=h.oid) AS class_count
      FROM halls h WHERE h.oid=? ORDER BY h.name COLLATE NOCASE`).all(org())
      .map(hall => ({
        ...hall,
        availability: db.prepare('SELECT availability_id,day_of_week,start_time,end_time FROM hall_availability WHERE hall_id=? ORDER BY day_of_week,start_time').all(hall.hall_id),
        bookings: db.prepare(`SELECT c.class_id,c.class_name,c.subject,s.day_of_week,s.start_time,s.end_time,
          (SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id=c.class_id AND e.status='active') AS student_count
          FROM classes c JOIN class_schedules s ON s.class_id=c.class_id
          WHERE c.hall_id=? AND c.oid=? AND c.status='active'
          ORDER BY CASE s.day_of_week WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3
            WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 WHEN 'saturday' THEN 6 ELSE 7 END,s.start_time`).all(hall.hall_id, org())
      }));
  });
  ipcMain.handle('halls:save', (_event, input) => {
    const db = getDatabase();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Hall name is required.');
    if (input.capacity && (!Number.isInteger(Number(input.capacity)) || Number(input.capacity) < 1)) throw new Error('Hall capacity must be a positive whole number.');
    const slots = Array.isArray(input.availability) ? input.availability : [];
    validateSlots(slots, 'Hall availability');
    const hallId = Number(input.hall_id || 0);
    if (hallId && !db.prepare('SELECT 1 FROM halls WHERE hall_id=? AND oid=?').get(hallId, org())) throw new Error('Hall not found.');
    if (hallId) {
      const scheduledClasses = db.prepare(`SELECT c.class_id,c.class_name,s.day_of_week,s.start_time,s.end_time
        FROM classes c JOIN class_schedules s ON s.class_id=c.class_id
        WHERE c.hall_id=? AND c.oid=? AND c.status='active'`).all(hallId, org());
      for (const scheduled of scheduledClasses) {
        if (!slotIsAvailable(scheduled, slots)) {
          throw new Error(`${scheduled.class_name} meets ${scheduled.day_of_week} ${scheduled.start_time}–${scheduled.end_time}, outside the proposed hall availability.`);
        }
      }
    }
    const save = db.transaction(() => {
      let id = hallId;
      if (id) db.prepare('UPDATE halls SET name=?,capacity=? WHERE hall_id=? AND oid=?').run(name, input.capacity || null, id, org());
      else id = db.prepare('INSERT INTO halls (oid,name,capacity) VALUES (?,?,?)').run(org(), name, input.capacity || null).lastInsertRowid;
      db.prepare('DELETE FROM hall_availability WHERE hall_id=?').run(id);
      const insert = db.prepare('INSERT INTO hall_availability (hall_id,day_of_week,start_time,end_time) VALUES (?,?,?,?)');
      slots.forEach(slot => insert.run(id, slot.day_of_week, slot.start_time, slot.end_time));
      return id;
    });
    return save();
  });
  ipcMain.handle('halls:delete', (_event, hallId) => {
    const db = getDatabase();
    if (db.prepare('SELECT 1 FROM halls WHERE hall_id=? AND oid=?').get(hallId, org()) === undefined) throw new Error('Hall not found.');
    if (db.prepare('SELECT 1 FROM classes WHERE hall_id=? AND oid=? LIMIT 1').get(hallId, org())) throw new Error('This hall is assigned to a class. Remove or change that class’s hall first.');
    return db.prepare('DELETE FROM halls WHERE hall_id=? AND oid=?').run(hallId, org()).changes > 0;
  });
  ipcMain.handle('classes:list', () => getDatabase().prepare(`
    SELECT c.class_id,c.class_name,c.tid,c.subject,c.fee,c.teacher_commission_percentage,c.hall_id,c.status,t.name AS teacher_name,h.name AS hall_name,
      (SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id=c.class_id AND e.status='active') AS student_count
    FROM classes c JOIN teachers t ON t.tid=c.tid LEFT JOIN halls h ON h.hall_id=c.hall_id
    WHERE c.oid=? ORDER BY c.class_name COLLATE NOCASE`).all(org()));
  ipcMain.handle('classes:detail', (_event, classId) => {
    const db = getDatabase();
    const c = db.prepare('SELECT * FROM classes WHERE class_id=? AND oid=?').get(classId, org());
    if (!c) throw new Error('Class not found.');
    return {
      ...c,
      schedules: db.prepare('SELECT schedule_id,day_of_week,start_time,end_time FROM class_schedules WHERE class_id=? ORDER BY schedule_id').all(classId),
      enrollments: db.prepare('SELECT e.enrollment_id,e.stid,e.discount_percentage,e.enrolled_date,e.status,s.name,s.rfid FROM class_enrollments e JOIN students s ON s.stid=e.stid WHERE e.class_id=? ORDER BY s.name').all(classId)
    };
  });
  ipcMain.handle('classes:save', (_event, input) => {
    const db = getDatabase();
    const name = String(input.class_name || '').trim();
    const tid = Number(input.tid);
    const fee = Number(input.fee);
    const commission = Number(input.teacher_commission_percentage);
    if (!name || !db.prepare('SELECT 1 FROM teachers WHERE tid=? AND oid=?').get(tid, org())) throw new Error('A class name and valid teacher are required.');
    if (input.hall_id && !db.prepare('SELECT 1 FROM halls WHERE hall_id=? AND oid=?').get(input.hall_id, org())) throw new Error('Choose a hall in this organization.');
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(commission) || commission < 0 || commission > 100) throw new Error('Enter a valid fee and commission from 0 to 100%.');
    const schedules = Array.isArray(input.schedules) ? input.schedules : [];
    validateSlots(schedules, 'Class schedule');
    if (input.hall_id && schedules.length) {
      const availability = db.prepare('SELECT day_of_week,start_time,end_time FROM hall_availability WHERE hall_id=?').all(input.hall_id);
      for (const slot of schedules) {
        if (!slotIsAvailable(slot, availability)) {
          throw new Error(`The hall is not available ${slot.day_of_week} ${slot.start_time}–${slot.end_time}. Update its availability or choose another hall.`);
        }
      }
      const classIdToIgnore = Number(input.class_id || 0);
      for (const slot of schedules) {
        const conflict = db.prepare(`SELECT c.class_name,s.start_time,s.end_time
          FROM classes c JOIN class_schedules s ON s.class_id=c.class_id
          WHERE c.hall_id=? AND c.oid=? AND c.status='active' AND c.class_id!=? AND s.day_of_week=?
            AND s.start_time<? AND s.end_time>? LIMIT 1`)
          .get(input.hall_id, org(), classIdToIgnore, slot.day_of_week, slot.end_time, slot.start_time);
        if (conflict) throw new Error(`${conflict.class_name} already uses this hall at ${conflict.start_time}–${conflict.end_time} on ${slot.day_of_week}.`);
      }
    }
    const save = db.transaction(() => {
      let classId = input.class_id;
      const vals = [name, tid, String(input.subject || ''), fee, commission, input.hall_id || null, input.status === 'inactive' ? 'inactive' : 'active'];
      if (classId) {
        if (!db.prepare('SELECT 1 FROM classes WHERE class_id=? AND oid=?').get(classId, org())) throw new Error('Class not found.');
        db.prepare('UPDATE classes SET class_name=?,tid=?,subject=?,fee=?,teacher_commission_percentage=?,hall_id=?,status=? WHERE class_id=? AND oid=?').run(...vals, classId, org());
        db.prepare('DELETE FROM class_schedules WHERE class_id=?').run(classId);
      } else {
        classId = db.prepare('INSERT INTO classes (oid,class_name,tid,subject,fee,teacher_commission_percentage,hall_id,status) VALUES (?,?,?,?,?,?,?,?)').run(org(), ...vals).lastInsertRowid;
      }
      const addSchedule = db.prepare('INSERT INTO class_schedules (class_id,day_of_week,start_time,end_time) VALUES (?,?,?,?)');
      schedules.forEach(s => addSchedule.run(classId, s.day_of_week, s.start_time, s.end_time));
      return classId;
    });
    return save();
  });
  ipcMain.handle('classes:enroll', (_event, { class_id, students }) => {
    const db = getDatabase();
    if (!db.prepare('SELECT 1 FROM classes WHERE class_id=? AND oid=?').get(class_id, org())) throw new Error('Class not found.');
    const enroll = db.prepare(`INSERT INTO class_enrollments (class_id,stid,discount_percentage) SELECT ?,stid,? FROM students WHERE stid=? AND oid=? AND status='active' ON CONFLICT(class_id,stid) DO UPDATE SET discount_percentage=excluded.discount_percentage,status='active'`);
    db.transaction(() => {
      for (const item of students || []) {
        const discount = Number(item.discount_percentage);
        if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Discount must be between 0 and 100%.');
        enroll.run(class_id, discount, item.stid, org());
      }
    })();
    return true;
  });
  ipcMain.handle('classes:dropEnrollment', (_event, enrollmentId) => {
    const result = getDatabase().prepare(`UPDATE class_enrollments SET status='dropped' WHERE enrollment_id=? AND class_id IN (SELECT class_id FROM classes WHERE oid=?)`).run(enrollmentId, org());
    return result.changes > 0;
  });
  ipcMain.handle('classes:updateDiscount', (_event, { enrollment_id, discount_percentage }) => {
    const discount = Number(discount_percentage);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Discount must be between 0 and 100%.');
    const result = getDatabase().prepare(`UPDATE class_enrollments SET discount_percentage=?
      WHERE enrollment_id=? AND status='active' AND class_id IN (SELECT class_id FROM classes WHERE oid=?)`).run(discount, enrollment_id, org());
    if (!result.changes) throw new Error('Active class enrolment not found.');
    return true;
  });
  ipcMain.handle('sessions:list', (_event, date = today()) => getDatabase().prepare(`
    SELECT s.session_id,s.class_id,s.session_date,s.start_time,s.end_time,s.status,s.ended_automatically,
      s.register_opened_at,s.class_started_at,s.ended_at,c.class_name,c.subject,
      s.is_special,CASE WHEN s.is_special=1 THEN s.hall_id ELSE COALESCE(s.hall_id,c.hall_id) END AS hall_id,
      h.name AS hall_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.session_id AND a.status='present') AS present_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.session_id) AS roster_count
    FROM sessions s JOIN classes c ON c.class_id=s.class_id
    LEFT JOIN halls h ON h.hall_id=CASE WHEN s.is_special=1 THEN s.hall_id ELSE COALESCE(s.hall_id,c.hall_id) END
    WHERE c.oid=? AND s.session_date=? ORDER BY s.start_time,c.class_name`).all(org(), date));
  ipcMain.handle('sessions:generate', (_event, date = today()) => {
    if (!validDate(date)) throw new Error('Enter a valid session date.');
    const db = getDatabase();
    const day = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const schedules = db.prepare(`SELECT s.class_id,s.start_time,s.end_time,c.hall_id
      FROM class_schedules s JOIN classes c ON c.class_id=s.class_id
      WHERE c.oid=? AND c.status='active' AND s.day_of_week=?`).all(org(), day);
    const insert = db.prepare('INSERT OR IGNORE INTO sessions (class_id,session_date,start_time,end_time,hall_id) VALUES (?,?,?,?,?)');
    let created = 0;
    db.transaction(() => schedules.forEach(s => { created += insert.run(s.class_id, date, s.start_time, s.end_time, s.hall_id).changes; }))();
    return { created };
  });
  ipcMain.handle('sessions:scheduleSpecial', (_event, input) => {
    const db = getDatabase();
    const classId = Number(input.class_id);
    if (!Number.isInteger(classId)) throw new Error('Choose an active class in this organization.');
    const classRow = db.prepare("SELECT class_id,hall_id FROM classes WHERE class_id=? AND oid=? AND status='active'").get(classId, org());
    if (!classRow) throw new Error('Choose an active class in this organization.');
    const date = String(input.session_date || '');
    const startTime = String(input.start_time || '');
    const endTime = String(input.end_time || '');
    if (!validDate(date) || !validTime(startTime) || !validTime(endTime) || startTime >= endTime) {
      throw new Error('Enter a valid session date and time range.');
    }
    const hallId = input.hall_id ? Number(input.hall_id) : null;
    const day = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const timeSlot = { day_of_week: day, start_time: startTime, end_time: endTime };
    const classScheduleConflict = db.prepare(`SELECT start_time,end_time FROM class_schedules
      WHERE class_id=? AND day_of_week=? AND start_time<? AND end_time>? LIMIT 1`)
      .get(classId, day, endTime, startTime);
    if (classScheduleConflict) {
      throw new Error(`This class already has a weekly session at ${classScheduleConflict.start_time}–${classScheduleConflict.end_time} on ${day}.`);
    }
    if (hallId !== null) {
      if (!Number.isInteger(hallId) || !db.prepare('SELECT 1 FROM halls WHERE hall_id=? AND oid=?').get(hallId, org())) {
        throw new Error('Choose a hall in this organization.');
      }
      const availability = db.prepare('SELECT day_of_week,start_time,end_time FROM hall_availability WHERE hall_id=?').all(hallId);
      if (!slotIsAvailable(timeSlot, availability)) {
        throw new Error(`The hall is not available ${day} ${startTime}–${endTime}.`);
      }
      const recurringConflict = db.prepare(`SELECT c.class_name,s.start_time,s.end_time
        FROM classes c JOIN class_schedules s ON s.class_id=c.class_id
        WHERE c.hall_id=? AND c.oid=? AND c.status='active' AND s.day_of_week=?
          AND s.start_time<? AND s.end_time>? LIMIT 1`).get(hallId, org(), day, endTime, startTime);
      if (recurringConflict) {
        throw new Error(`${recurringConflict.class_name} already uses this hall at ${recurringConflict.start_time}–${recurringConflict.end_time} on ${day}.`);
      }
      const sessionConflict = db.prepare(`SELECT c.class_name,s.start_time,s.end_time
        FROM sessions s JOIN classes c ON c.class_id=s.class_id
        WHERE c.oid=? AND s.session_date=? AND s.status!='cancelled'
          AND (CASE WHEN s.is_special=1 THEN s.hall_id ELSE COALESCE(s.hall_id,c.hall_id) END)=?
          AND s.start_time<? AND s.end_time>? LIMIT 1`).get(org(), date, hallId, endTime, startTime);
      if (sessionConflict) {
        throw new Error(`${sessionConflict.class_name} already has this hall booked at ${sessionConflict.start_time}–${sessionConflict.end_time} on ${date}.`);
      }
    }
    const classConflict = db.prepare(`SELECT start_time,end_time FROM sessions
      WHERE class_id=? AND session_date=? AND status!='cancelled' AND start_time<? AND end_time>? LIMIT 1`)
      .get(classId, date, endTime, startTime);
    if (classConflict && overlaps(classConflict.start_time, classConflict.end_time, startTime, endTime)) {
      throw new Error(`This class already has a session at ${classConflict.start_time}–${classConflict.end_time} on ${date}.`);
    }
    return db.prepare(`INSERT INTO sessions (class_id,session_date,start_time,end_time,hall_id,is_special)
      VALUES (?,?,?,?,?,1)`).run(classId, date, startTime, endTime, hallId).lastInsertRowid;
  });
  ipcMain.handle('sessions:attendance', (_event, sessionId) => {
    const db = getDatabase();
    const session = db.prepare('SELECT s.session_id,s.status,s.class_id,s.register_opened_at,s.class_started_at,s.ended_at,s.ended_automatically,c.oid FROM sessions s JOIN classes c ON c.class_id=s.class_id WHERE s.session_id=? AND c.oid=?').get(sessionId, org());
    if (!session) throw new Error('Session not found.');
    const dueDay = db.prepare('SELECT payment_due_day FROM organizations WHERE oid=?').get(session.oid).payment_due_day;
    const attendees = db.prepare(`SELECT a.attendance_id,a.stid,a.status,a.marked_at,a.present_at,
      CASE WHEN a.present_at IS NOT NULL AND se.class_started_at IS NOT NULL
        THEN MAX(0,CAST((julianday(a.present_at)-julianday(se.class_started_at))*1440 AS INTEGER)) END AS late_minutes,
      s.name,s.rfid,s.school,s.contact1,s.contact2,s.birthday,s.address,s.status AS student_status,e.enrollment_id,e.discount_percentage,e.enrolled_date,c.fee,
      p.payment_id,p.amount_paid,
      (SELECT GROUP_CONCAT(for_month) FROM payments WHERE enrollment_id=e.enrollment_id) AS paid_months,
      (SELECT COUNT(*) FROM (
        SELECT previous_attendance.status
        FROM attendance previous_attendance
        JOIN sessions previous_session ON previous_session.session_id=previous_attendance.session_id
        WHERE previous_attendance.stid=a.stid AND previous_session.class_id=se.class_id
          AND previous_session.status='completed'
          AND (previous_session.session_date<se.session_date OR
            (previous_session.session_date=se.session_date AND
              (COALESCE(previous_session.start_time,'')<COALESCE(se.start_time,'') OR
                (COALESCE(previous_session.start_time,'')=COALESCE(se.start_time,'')
                  AND previous_session.session_id<se.session_id))))
          AND EXISTS (SELECT 1 FROM class_enrollments eligible
            WHERE eligible.class_id=previous_session.class_id AND eligible.stid=a.stid
              AND eligible.status='active' AND substr(eligible.enrolled_date,1,10)<=previous_session.session_date)
        ORDER BY previous_session.session_date DESC,previous_session.start_time DESC,previous_session.session_id DESC
        LIMIT 2
      ) recent_sessions WHERE recent_sessions.status!='present') AS recent_absence_count
      FROM attendance a JOIN students s ON s.stid=a.stid
      JOIN sessions se ON se.session_id=a.session_id
      JOIN classes c ON c.class_id=?
      LEFT JOIN class_enrollments e ON e.class_id=? AND e.stid=a.stid AND e.status='active'
      LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
      WHERE a.session_id=? ORDER BY s.name COLLATE NOCASE`).all(session.class_id, session.class_id, currentMonth(), sessionId);
    return {
      session: {
        status: session.status,
        register_opened_at: session.register_opened_at,
        class_started_at: session.class_started_at,
        ended_at: session.ended_at,
        ended_automatically: session.ended_automatically
      },
      attendees: attendees.map(attendee => {
      const overdueDates = Number(attendee.discount_percentage) >= 100 ? [] : overduePaymentMonths(
        attendee.enrolled_date,
        attendee.paid_months ? attendee.paid_months.split(',') : [],
        dueDay,
        today()
      );
      return {
        ...attendee,
        overdue_month_count: overdueDates.length,
        overdue_since: overdueDates[0]?.due_date || null,
        overdue_months: overdueDates
      };
      })
    };
  });
  ipcMain.handle('sessions:exportAttendancePDF', async (_event, sessionId) => {
    const user = requireUser();
    const db = getDatabase();
    const session = db.prepare(`SELECT s.session_id,s.session_date,s.start_time,s.end_time,s.status,
      s.register_opened_at,s.class_started_at,s.ended_at,s.ended_automatically,
      c.class_name,t.name AS teacher_name,o.name AS organization
      FROM sessions s JOIN classes c ON c.class_id=s.class_id
      JOIN teachers t ON t.tid=c.tid JOIN organizations o ON o.oid=c.oid
      WHERE s.session_id=? AND c.oid=?`).get(Number(sessionId), user.oid);
    if (!session) throw new Error('Session not found.');
    const students = db.prepare(`SELECT s.name,a.status,a.marked_at,a.present_at,
      CASE WHEN a.present_at IS NOT NULL AND se.class_started_at IS NOT NULL
        THEN MAX(0,CAST((julianday(a.present_at)-julianday(se.class_started_at))*1440 AS INTEGER)) END AS late_minutes
      FROM attendance a JOIN sessions se ON se.session_id=a.session_id
      JOIN students s ON s.stid=a.stid
      WHERE a.session_id=? ORDER BY s.name COLLATE NOCASE`).all(session.session_id);
    const choice = await dialog.showSaveDialog(window, {
      title: 'Export session attendance report',
      defaultPath: `attendance_${session.session_date}_${session.class_name.replace(/[<>:"/\\|?*]/g, '_')}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const filePath = choice.filePath.toLowerCase().endsWith('.pdf') ? choice.filePath : `${choice.filePath}.pdf`;
    const reportWindow = new BrowserWindow({
      show: false,
      parent: window,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try {
      const html = buildAttendanceReportHtml({
        organization: session.organization,
        session,
        students,
        generatedOn: today()
      });
      await reportWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      const pdf = await reportWindow.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      });
      await fs.promises.writeFile(filePath, pdf);
      return { canceled: false, filePath };
    } finally {
      if (!reportWindow.isDestroyed()) reportWindow.close();
    }
  });
  ipcMain.handle('sessions:start', (_event, sessionId) => {
    const db = getDatabase();
    const session = db.prepare('SELECT s.session_id,s.class_id,s.status FROM sessions s JOIN classes c ON c.class_id=s.class_id WHERE s.session_id=? AND c.oid=?').get(sessionId, org());
    if (!session) throw new Error('Session not found.');
    if (session.status === 'completed' || session.status === 'cancelled') throw new Error('This session cannot be started.');
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO attendance (session_id,stid,status) SELECT ?,stid,'not_marked' FROM class_enrollments WHERE class_id=? AND status='active'`).run(sessionId, session.class_id);
      db.prepare("UPDATE sessions SET status='ongoing',register_opened_at=COALESCE(register_opened_at,CURRENT_TIMESTAMP) WHERE session_id=?").run(sessionId);
    })();
    return true;
  });
  ipcMain.handle('sessions:classStarted', (_event, sessionId) => {
    const result = getDatabase().prepare(`UPDATE sessions SET class_started_at=CURRENT_TIMESTAMP
      WHERE session_id=? AND status='ongoing' AND class_started_at IS NULL
      AND class_id IN (SELECT class_id FROM classes WHERE oid=?)`).run(sessionId, org());
    if (!result.changes) throw new Error('Only an open session that has not started can be marked as class started.');
    return getDatabase().prepare('SELECT class_started_at FROM sessions WHERE session_id=?').get(sessionId).class_started_at;
  });
  ipcMain.handle('sessions:mark', (_event, { session_id, stid, status }) => {
    if (!['present','absent'].includes(status)) throw new Error('Attendance status must be present or absent.');
    const result = getDatabase().prepare(`UPDATE attendance SET status=?,marked_at=CURRENT_TIMESTAMP,
      present_at=CASE WHEN ?='present' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE session_id=? AND stid=? AND session_id IN (SELECT s.session_id FROM sessions s JOIN classes c ON c.class_id=s.class_id WHERE c.oid=? AND s.status='ongoing')`).run(status, status, session_id, stid, org());
    if (!result.changes) throw new Error('Attendance could not be updated. Start the session first.');
    return true;
  });
  ipcMain.handle('sessions:end', (_event, sessionId) => {
    const db = getDatabase();
    const endSession = db.transaction(() => {
      const session = db.prepare(`SELECT s.session_id FROM sessions s JOIN classes c ON c.class_id=s.class_id
        WHERE s.session_id=? AND c.oid=? AND s.status='ongoing'`).get(sessionId, org());
      if (!session || !completeOngoingSession(db, session.session_id)) {
        throw new Error('Only an ongoing session can be ended.');
      }
    });
    endSession();
    return true;
  });
  ipcMain.handle('payments:overview', (_event, month = currentMonth()) => {
    if (!validMonth(month) || month > currentMonth()) throw new Error('Choose a payment month up to the current month.');
    const db = getDatabase();
    return {
      month,
      collected: db.prepare(`SELECT COALESCE(SUM(p.amount_paid),0) AS amount FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id JOIN classes c ON c.class_id=e.class_id WHERE c.oid=? AND p.for_month=?`).get(org(), month).amount,
      due: getPendingTotal(org(), month),
      rows: db.prepare(`SELECT e.enrollment_id,e.stid,s.name,s.rfid,c.class_id,c.class_name,c.fee,e.discount_percentage,
        CASE WHEN e.discount_percentage>=100 THEN 1 ELSE 0 END AS free_access,
        ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS due_amount,p.payment_id,p.amount_paid,p.payment_date,p.payment_time,p.notes
        FROM class_enrollments e JOIN students s ON s.stid=e.stid JOIN classes c ON c.class_id=e.class_id
        LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
        WHERE c.oid=? AND e.status='active' AND c.status='active' AND substr(e.enrolled_date,1,7)<=? ORDER BY s.name,c.class_name`).all(month, org(), month)
    };
  });
  ipcMain.handle('payments:pendingFees', () => {
    const db = getDatabase();
    const enrollments = db.prepare(`SELECT e.enrollment_id,e.stid,s.name,s.rfid,c.class_name,c.fee,
        e.discount_percentage,e.enrolled_date
      FROM class_enrollments e
      JOIN students s ON s.stid=e.stid
      JOIN classes c ON c.class_id=e.class_id
      WHERE c.oid=? AND s.oid=c.oid AND s.status='active'
        AND e.status='active' AND c.status='active'
        AND e.discount_percentage<100
      ORDER BY s.name COLLATE NOCASE,c.class_name COLLATE NOCASE`).all(org());
    const current = currentMonth();
    const paidMonths = new Set(db.prepare(`SELECT p.enrollment_id,p.for_month FROM payments p
      JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
      JOIN classes c ON c.class_id=e.class_id
      WHERE c.oid=? AND e.status='active' AND c.status='active'`).all(org())
      .map(payment => `${payment.enrollment_id}:${payment.for_month}`));
    const pending = [];
    for (const enrollment of enrollments) {
      const start = enrollment.enrolled_date.slice(0, 7);
      if (start > current) continue;
      const [year, month] = start.split('-').map(Number);
      for (let date = new Date(Date.UTC(year, month - 1, 1)); date.toISOString().slice(0, 7) <= current; date.setUTCMonth(date.getUTCMonth() + 1)) {
        const forMonth = date.toISOString().slice(0, 7);
        if (paidMonths.has(`${enrollment.enrollment_id}:${forMonth}`)) continue;
        pending.push({
          enrollment_id: enrollment.enrollment_id,
          stid: enrollment.stid,
          name: enrollment.name,
          rfid: enrollment.rfid,
          class_name: enrollment.class_name,
          for_month: forMonth,
          due_amount: money(enrollment.fee * (1 - enrollment.discount_percentage / 100))
        });
      }
    }
    return pending.sort((a, b) => a.for_month.localeCompare(b.for_month)
      || a.name.localeCompare(b.name) || a.class_name.localeCompare(b.class_name));
  });
  ipcMain.handle('payments:make', (_event, items) => {
    if (!Array.isArray(items) || !items.length) throw new Error('Select at least one pending payment.');
    const current = currentMonth();
    const uniqueItems = [...new Map(items.map(item => {
      const enrollmentId = Number(item?.enrollment_id);
      return [`${enrollmentId}:${item?.for_month}`, { enrollment_id: enrollmentId, for_month: item?.for_month }];
    })).values()];
    const db = getDatabase();
    const select = db.prepare(`SELECT e.enrollment_id,e.stid,e.enrolled_date,e.discount_percentage,
        ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS amount,c.class_name,s.name,s.oid AS student_oid,c.oid
      FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id
      JOIN students s ON s.stid=e.stid
      WHERE e.enrollment_id=? AND e.status='active' AND c.status='active' AND s.status='active'`);
    const rows = uniqueItems.map(item => {
      if (!Number.isInteger(item.enrollment_id) || item.enrollment_id < 1
        || !validMonth(item.for_month) || item.for_month > current) {
        throw new Error('One or more selected payments are invalid.');
      }
      const row = select.get(item.enrollment_id);
      if (!row || row.oid !== org() || row.student_oid !== org()) {
        throw new Error('One or more selected class enrolments are unavailable.');
      }
      if (item.for_month < row.enrolled_date.slice(0, 7)) {
        throw new Error('Payment cannot be recorded before the student enrolled.');
      }
      if (Number(row.discount_percentage) >= 100 || row.amount <= 0) {
        throw new Error('Free access students do not have a payment due.');
      }
      if (db.prepare('SELECT 1 FROM payments WHERE enrollment_id=? AND for_month=?').get(item.enrollment_id, item.for_month)) {
        throw new Error('One or more selected payments have already been recorded.');
      }
      return { ...row, for_month: item.for_month };
    });
    const savedReceipt = recordPaymentReceipt(db, org(), rows.map(row => ({
      enrollment_id: row.enrollment_id,
      for_month: row.for_month,
      amount: row.amount
    })), {
      date: today(),
      time: new Date().toTimeString().slice(0, 8),
      userId: requireUser().user_id
    });
    return findPaymentReceipt(savedReceipt.receipt_code);
  });
  ipcMain.handle('payments:receipt', (_event, code) => {
    const receiptCode = String(code || '').trim().toUpperCase();
    return findPaymentReceipt(receiptCode);
  });
  ipcMain.handle('payments:recentReceipts', () => {
    return listRecentPaymentReceipts(getDatabase(), org());
  });
  ipcMain.handle('payments:exportReceipt', async (_event, code) => {
    const user = requireUser();
    const receipt = findPaymentReceipt(String(code || '').trim().toUpperCase());
    if (!receipt) throw new Error('Payment receipt was not found.');
    const choice = await dialog.showSaveDialog(window, {
      title: 'Download payment receipt',
      defaultPath: `payment_receipt_${receipt.receipt_code}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const filePath = choice.filePath.toLowerCase().endsWith('.pdf') ? choice.filePath : `${choice.filePath}.pdf`;
    const reportWindow = await createPaymentReceiptWindow(user, receipt);
    try {
      const pdf = await reportWindow.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      });
      await fs.promises.writeFile(filePath, pdf);
    } finally {
      if (!reportWindow.isDestroyed()) reportWindow.close();
    }
    return { canceled: false, filePath };
  });
  ipcMain.handle('payments:printReceipt', async (_event, code) => {
    const user = requireUser();
    const receipt = findPaymentReceipt(String(code || '').trim().toUpperCase());
    if (!receipt) throw new Error('Payment receipt was not found.');
    const reportWindow = await createPaymentReceiptWindow(user, receipt);
    reportWindow.show();
    return new Promise((resolve, reject) => {
      reportWindow.webContents.print({ printBackground: true }, (success, failureReason) => {
        if (!reportWindow.isDestroyed()) reportWindow.close();
        if (!success) reject(new Error(failureReason || 'The receipt could not be printed.'));
        else resolve(true);
      });
    });
  });
  ipcMain.handle('payments:pay', (_event, { enrollment_ids, month, session_id, notes }) => {
    if (!validMonth(month) || month > currentMonth()) throw new Error('Choose a payment month up to the current month.');
    const db = getDatabase();
    const uniqueIds = [...new Set((enrollment_ids || []).map(Number))];
    if (!uniqueIds.length) throw new Error('Select at least one unpaid class fee.');
    const rows = uniqueIds.map(id => db.prepare(`SELECT e.enrollment_id,e.class_id,e.enrolled_date,e.discount_percentage,
      ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS amount,c.oid
      FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id WHERE e.enrollment_id=? AND e.status='active' AND c.status='active'`).get(id));
    if (rows.some(row => !row || row.oid !== org())) throw new Error('One or more selected enrollments are unavailable.');
    if (rows.some(row => Number(row.discount_percentage) >= 100 || row.amount <= 0)) {
      throw new Error('Free access students do not have a payment due.');
    }
    if (rows.some(row => month < row.enrolled_date.slice(0, 7))) throw new Error('Payment cannot be recorded before the student enrolled.');
    if (session_id && rows.some(row => !db.prepare(`SELECT 1 FROM sessions s JOIN classes c ON c.class_id=s.class_id
      WHERE s.session_id=? AND s.class_id=? AND s.status='ongoing' AND c.oid=?`).get(session_id, row.class_id, org()))) {
      throw new Error('This session is not open for the selected class.');
    }
    return recordPaymentReceipt(db, org(), rows.map(row => ({
      enrollment_id: row.enrollment_id,
      for_month: month,
      amount: row.amount
    })), {
      date: today(),
      time: new Date().toTimeString().slice(0, 8),
      userId: requireUser().user_id,
      sessionId: session_id || null,
      notes: String(notes || '')
    });
  });
  ipcMain.handle('students:payFees', (_event, items) => {
    if (!Array.isArray(items) || !items.length) throw new Error('Select at least one unpaid class month.');
    const db = getDatabase();
    const uniqueItems = [...new Map(items.map(item => [`${Number(item.enrollment_id)}:${item.month}`, item])).values()];
    const select = db.prepare(`SELECT e.enrollment_id,e.discount_percentage,
      ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS amount,c.oid,e.stid,e.enrolled_date
      FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id WHERE e.enrollment_id=? AND e.status='active'`);
    const rows = uniqueItems.map(item => {
      if (!validMonth(item.month) || item.month > currentMonth()) throw new Error('Choose a valid payment month up to the current month.');
      const row = select.get(Number(item.enrollment_id));
      if (!row || row.oid !== org()) throw new Error('One or more selected class enrolments are unavailable.');
      if (Number(row.discount_percentage) >= 100 || row.amount <= 0) throw new Error('Free access students do not have a payment due.');
      if (item.month < row.enrolled_date.slice(0, 7)) throw new Error('Payment cannot be recorded before the student enrolled.');
      return { ...row, month: item.month };
    });
    return recordPaymentReceipt(db, org(), rows.map(row => ({
      enrollment_id: row.enrollment_id,
      for_month: row.month,
      amount: row.amount
    })), {
      date: today(),
      time: new Date().toTimeString().slice(0, 8),
      userId: requireUser().user_id
    });
  });
  ipcMain.handle('reports:classEarnings', (_event, month = currentMonth()) => {
    if (!validMonth(month)) throw new Error('Enter a valid month.');
    return getDatabase().prepare(`
      SELECT c.class_id,c.class_name,t.tid,t.name AS teacher_name,c.fee,c.teacher_commission_percentage,
        COUNT(e.enrollment_id) AS enrolled_count,
        SUM(CASE WHEN p.payment_id IS NOT NULL THEN 1 ELSE 0 END) AS paid_students,
        SUM(CASE WHEN p.payment_id IS NULL THEN 1 ELSE 0 END) AS not_paid_students,
        COALESCE(SUM(p.amount_paid),0) AS collected,
        COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN ROUND(c.fee*(1-e.discount_percentage/100.0),2) ELSE 0 END),0) AS pending,
        COALESCE(SUM(p.amount_paid)*c.teacher_commission_percentage/100.0,0) AS teacher_earnings,
        COALESCE(SUM(p.amount_paid)*(100-c.teacher_commission_percentage)/100.0,0) AS org_earnings,
        COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN ROUND(ROUND(c.fee*(1-e.discount_percentage/100.0),2)*c.teacher_commission_percentage/100.0,2) ELSE 0 END),0) AS pending_teacher,
        COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN ROUND(c.fee*(1-e.discount_percentage/100.0),2)-ROUND(ROUND(c.fee*(1-e.discount_percentage/100.0),2)*c.teacher_commission_percentage/100.0,2) ELSE 0 END),0) AS pending_org
      FROM classes c JOIN teachers t ON t.tid=c.tid LEFT JOIN class_enrollments e ON e.class_id=c.class_id AND e.status='active'
      LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
      WHERE c.oid=? AND c.status='active' GROUP BY c.class_id ORDER BY t.name,c.class_name`).all(month, org());
  });
  ipcMain.handle('reports:exportClassPaymentPDF', async (_event, year) => {
    const user = requireUser();
    const reportYear = String(typeof year === 'object' ? year.year : year);
    if (!/^\d{4}$/.test(reportYear)) throw new Error('Choose a valid report year.');
    const classId = typeof year === 'object' && year.class_id !== undefined ? Number(year.class_id) : null;
    if (classId !== null && (!Number.isInteger(classId) || classId < 1)) throw new Error('Choose a valid class.');
    const classFilter = classId === null ? '' : ' AND c.class_id=?';
    const rows = getDatabase().prepare(`SELECT c.class_id,c.class_name,t.name AS teacher_name,
        s.stid,s.name AS student_name
      FROM classes c JOIN teachers t ON t.tid=c.tid
      LEFT JOIN class_enrollments e ON e.class_id=c.class_id AND e.status='active'
      LEFT JOIN students s ON s.stid=e.stid AND s.status='active'
      WHERE c.oid=? AND c.status='active'${classFilter}
      ORDER BY c.class_name COLLATE NOCASE,s.name COLLATE NOCASE`)
      .all(...(classId === null ? [user.oid] : [user.oid, classId]));
    if (classId !== null && !rows.length) throw new Error('Class not found in this organization.');
    const classesById = new Map();
    for (const row of rows) {
      let classRecord = classesById.get(row.class_id);
      if (!classRecord) {
        classRecord = { class_name: row.class_name, teacher_name: row.teacher_name, students: [] };
        classesById.set(row.class_id, classRecord);
      }
      if (row.stid !== null) classRecord.students.push({ name: row.student_name });
    }
    const classes = [...classesById.values()];
    const choice = await dialog.showSaveDialog(window, {
      title: 'Export annual class payment register',
      defaultPath: `${classes.length === 1 ? `${classes[0].class_name.replace(/[<>:"/\\|?*]/g, '_')}_` : ''}class_payments_${reportYear}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const filePath = choice.filePath.toLowerCase().endsWith('.pdf') ? choice.filePath : `${choice.filePath}.pdf`;
    const reportWindow = new BrowserWindow({
      show: false,
      parent: window,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try {
      const html = buildClassPaymentReportHtml({
        organization: user.organization,
        year: reportYear,
        classes,
        generatedOn: today()
      });
      await reportWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      const pdf = await reportWindow.webContents.printToPDF({
        pageSize: 'A4',
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0.35, bottom: 0.35, left: 0.35, right: 0.35 }
      });
      await fs.promises.writeFile(filePath, pdf);
    } finally {
      if (!reportWindow.isDestroyed()) reportWindow.close();
    }
    return { canceled: false, filePath };
  });
  ipcMain.handle('reports:teacherBalances', () => getDatabase().prepare(`
    SELECT t.tid,t.name,
      COALESCE((SELECT SUM(p.amount_paid*c.teacher_commission_percentage/100.0)
        FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
        JOIN classes c ON c.class_id=e.class_id WHERE c.tid=t.tid AND c.oid=t.oid),0) AS earned,
      COALESCE((SELECT SUM(p.amount) FROM teacher_payouts p WHERE p.tid=t.tid),0) AS paid_out,
      COALESCE((SELECT SUM(p.amount) FROM teacher_payouts p
        WHERE p.tid=t.tid AND substr(p.payout_date,1,7)=?),0) AS paid_out_this_month
    FROM teachers t WHERE t.oid=? ORDER BY t.name`).all(currentMonth(), org()).map(row => ({
      ...row,
      paid_out_this_month: money(row.paid_out_this_month),
      outstanding: money(row.earned - row.paid_out)
    })));
  ipcMain.handle('reports:paymentRecords', (_event, filters = {}) => {
    const db = getDatabase();
    const clauses = ['c.oid=?', 's.oid=c.oid', 't.oid=c.oid'];
    const params = [org()];
    if (filters.month) {
      if (!validMonth(filters.month)) throw new Error('Enter a valid payment month.');
      clauses.push('p.for_month=?');
      params.push(filters.month);
    } else if (filters.year) {
      const year = String(filters.year);
      if (!/^\d{4}$/.test(year)) throw new Error('Enter a valid payment year.');
      clauses.push('substr(p.for_month,1,4)=?');
      params.push(year);
    }
    if (filters.start_month || filters.end_month) {
      if (!validMonth(filters.start_month) || !validMonth(filters.end_month) || filters.start_month > filters.end_month) {
        throw new Error('Choose a valid payment month range.');
      }
      clauses.push('p.for_month BETWEEN ? AND ?');
      params.push(filters.start_month, filters.end_month);
    }
    if (filters.stid) {
      const stid = Number(filters.stid);
      if (!Number.isInteger(stid) || stid < 1) throw new Error('Choose a valid student.');
      clauses.push('s.stid=?');
      params.push(stid);
    }
    if (filters.class_id) {
      clauses.push('c.class_id=?');
      params.push(Number(filters.class_id));
    }
    return db.prepare(`SELECT p.payment_id,p.for_month,p.amount_paid,p.payment_date,p.payment_time,p.notes,
      s.stid,s.name AS student_name,s.rfid,c.class_id,c.class_name,t.name AS teacher_name
      FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
      JOIN students s ON s.stid=e.stid JOIN classes c ON c.class_id=e.class_id
      JOIN teachers t ON t.tid=c.tid
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.for_month DESC,p.payment_date DESC,s.name COLLATE NOCASE,c.class_name`).all(...params);
  });
  ipcMain.handle('reports:studentAttendance', (_event, filters = {}) => {
    const clauses = ['c.oid=?', 's.oid=c.oid'];
    const params = [org()];
    if (filters.stid) {
      const stid = Number(filters.stid);
      if (!Number.isInteger(stid) || stid < 1) throw new Error('Choose a valid student.');
      clauses.push('s.stid=?');
      params.push(stid);
    }
    if (filters.start_month || filters.end_month) {
      if (!validMonth(filters.start_month) || !validMonth(filters.end_month) || filters.start_month > filters.end_month) {
        throw new Error('Choose a valid attendance month range.');
      }
      clauses.push("strftime('%Y-%m', se.session_date) BETWEEN ? AND ?");
      params.push(filters.start_month, filters.end_month);
    }
    return getDatabase().prepare(`SELECT a.attendance_id,s.stid,s.name AS student_name,c.class_id,c.class_name,
      se.session_date,a.status,a.marked_at
      FROM attendance a JOIN sessions se ON se.session_id=a.session_id
      JOIN classes c ON c.class_id=se.class_id
      JOIN students s ON s.stid=a.stid
      WHERE ${clauses.join(' AND ')} AND a.status IN ('present','absent')
      ORDER BY se.session_date DESC,s.name COLLATE NOCASE,c.class_name`).all(...params);
  });
  ipcMain.handle('reports:sessions', (_event, filters = {}) => {
    const startDate = String(filters.start_date || '');
    const endDate = String(filters.end_date || '');
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new Error('Choose a valid session date range.');
    }
    const params = [org(), startDate, endDate];
    let teacherFilter = '';
    if (filters.tid) {
      const teacherId = Number(filters.tid);
      if (!Number.isInteger(teacherId) || teacherId < 1) throw new Error('Choose a valid teacher.');
      teacherFilter = ' AND t.tid=?';
      params.push(teacherId);
    }
    return getDatabase().prepare(`SELECT se.session_id,se.session_date,se.start_time,se.end_time,se.status,
        c.class_name,t.tid,t.name AS teacher_name,
        (SELECT COUNT(*) FROM class_enrollments e
          WHERE e.class_id=c.class_id AND e.status='active' AND substr(e.enrolled_date,1,10)<=se.session_date) AS enrolled_count,
        (SELECT COUNT(*) FROM attendance a
          WHERE a.session_id=se.session_id AND a.status='present') AS present_count
      FROM sessions se JOIN classes c ON c.class_id=se.class_id
      JOIN teachers t ON t.tid=c.tid
      WHERE c.oid=? AND se.session_date BETWEEN ? AND ? AND se.status!='cancelled'${teacherFilter}
      ORDER BY se.session_date DESC,se.start_time,c.class_name COLLATE NOCASE`).all(...params);
  });
  ipcMain.handle('reports:pendingPayments', (_event, month = currentMonth()) => {
    if (!validMonth(month) || month > currentMonth()) throw new Error('Choose a payment month up to the current month.');
    return getDatabase().prepare(`SELECT e.enrollment_id,e.stid,s.name AS student_name,s.rfid,c.class_id,c.class_name,t.name AS teacher_name,
      ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS amount_due
      FROM class_enrollments e JOIN students s ON s.stid=e.stid JOIN classes c ON c.class_id=e.class_id
      JOIN teachers t ON t.tid=c.tid
      LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
      WHERE c.oid=? AND e.status='active' AND c.status='active' AND e.discount_percentage<100 AND p.payment_id IS NULL
        AND substr(e.enrolled_date,1,7)<=?
      ORDER BY s.name COLLATE NOCASE,c.class_name`).all(month, org(), month);
  });
  ipcMain.handle('reports:exportPDF', async () => {
    requireUser();
    const choice = await dialog.showSaveDialog(window, {
      title: 'Export tuition payment report',
      defaultPath: `tuition_report_${today()}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const filePath = choice.filePath.toLowerCase().endsWith('.pdf') ? choice.filePath : `${choice.filePath}.pdf`;
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
    await fs.promises.writeFile(filePath, pdf);
    return { canceled: false, filePath };
  });
  ipcMain.handle('reports:exportDailySummaryPDF', async (_event, date = today()) => {
    const user = requireUser();
    if (!validDate(date)) throw new Error('Choose a valid report date.');
    const db = getDatabase();
    const activeStudentCount = db.prepare("SELECT COUNT(*) AS count FROM students WHERE oid=? AND status='active'").get(user.oid).count;
    const totalReceived = db.prepare(`SELECT COALESCE(SUM(p.amount_paid),0) AS total
      FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
      JOIN classes c ON c.class_id=e.class_id WHERE c.oid=? AND p.payment_date=?`).get(user.oid, date).total;
    const totalTeacherPayouts = db.prepare(`SELECT COALESCE(SUM(p.amount),0) AS total
      FROM teacher_payouts p JOIN teachers t ON t.tid=p.tid
      WHERE t.oid=? AND p.payout_date=?`).get(user.oid, date).total;
    const classPayments = db.prepare(`SELECT c.class_name,t.name AS teacher_name,
        COUNT(DISTINCT e.stid) AS student_count,SUM(p.amount_paid) AS amount_received
      FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
      JOIN classes c ON c.class_id=e.class_id JOIN teachers t ON t.tid=c.tid
      WHERE c.oid=? AND p.payment_date=?
      GROUP BY c.class_id ORDER BY c.class_name COLLATE NOCASE`).all(user.oid, date);
    const teacherPayouts = db.prepare(`SELECT t.name AS teacher_name,p.amount
      FROM teacher_payouts p JOIN teachers t ON t.tid=p.tid
      WHERE t.oid=? AND p.payout_date=? ORDER BY t.name COLLATE NOCASE,p.payout_id`).all(user.oid, date);
    const sessions = db.prepare(`SELECT s.session_id,s.start_time,s.end_time,s.status,c.class_name,t.name AS teacher_name,
        (SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id=c.class_id AND e.status='active'
          AND substr(e.enrolled_date,1,10)<=s.session_date) AS enrolled_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.session_id AND a.status='present') AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.session_id AND a.status='absent') AS absent_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.session_id AND a.status='not_marked') AS not_marked_count
      FROM sessions s JOIN classes c ON c.class_id=s.class_id JOIN teachers t ON t.tid=c.tid
      WHERE c.oid=? AND s.session_date=? AND s.status!='cancelled'
      ORDER BY s.start_time,c.class_name COLLATE NOCASE`).all(user.oid, date);
    const choice = await dialog.showSaveDialog(window, {
      title: 'Export daily summary report',
      defaultPath: `daily_summary_${date}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const filePath = choice.filePath.toLowerCase().endsWith('.pdf') ? choice.filePath : `${choice.filePath}.pdf`;
    const reportWindow = new BrowserWindow({
      show: false,
      parent: window,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try {
      const html = buildDailySummaryReportHtml({
        organization: user.organization,
        date,
        activeStudentCount,
        totalReceived,
        totalTeacherPayouts,
        classPayments,
        teacherPayouts,
        sessions,
        generatedOn: today()
      });
      await reportWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      const pdf = await reportWindow.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      });
      await fs.promises.writeFile(filePath, pdf);
      return { canceled: false, filePath };
    } finally {
      if (!reportWindow.isDestroyed()) reportWindow.close();
    }
  });
  ipcMain.handle('payouts:list', (_event, filters = {}) => {
    const clauses = ['t.oid=?'];
    const params = [org()];
    if (filters.tid) {
      const tid = Number(filters.tid);
      if (!Number.isInteger(tid) || tid < 1) throw new Error('Choose a valid teacher.');
      clauses.push('p.tid=?');
      params.push(tid);
    }
    if (filters.start_month || filters.end_month) {
      if (!validMonth(filters.start_month) || !validMonth(filters.end_month) || filters.start_month > filters.end_month) {
        throw new Error('Choose a valid payout month range.');
      }
      clauses.push("substr(p.payout_date,1,7) BETWEEN ? AND ?");
      params.push(filters.start_month, filters.end_month);
    }
    return getDatabase().prepare(`SELECT p.payout_id,p.tid,t.name AS teacher_name,p.amount,p.payout_date,p.notes,
    (SELECT GROUP_CONCAT(c.class_name || ' · ' || COALESCE(d.for_month,'all months'), ', ') FROM teacher_payout_details d JOIN classes c ON c.class_id=d.class_id WHERE d.payout_id=p.payout_id AND c.oid=t.oid) AS details
    FROM teacher_payouts p JOIN teachers t ON t.tid=p.tid WHERE ${clauses.join(' AND ')}
    ORDER BY p.payout_date DESC,p.payout_id DESC`).all(...params);
  });
  ipcMain.handle('payouts:add', (_event, input) => {
    const db = getDatabase();
    const tid = Number(input.tid), amount = Number(input.amount);
    if (!db.prepare('SELECT 1 FROM teachers WHERE tid=? AND oid=?').get(tid, org()) || !Number.isFinite(amount) || amount <= 0) throw new Error('Choose a valid teacher and payout amount.');
    const details = Array.isArray(input.details) ? input.details : [];
    for (const detail of details) {
      if (!db.prepare('SELECT 1 FROM classes WHERE class_id=? AND tid=? AND oid=?').get(detail.class_id, tid, org())) throw new Error('Payout class does not belong to this teacher.');
      if (!Number.isFinite(Number(detail.amount_for_class)) || Number(detail.amount_for_class) < 0) throw new Error('Enter a valid class payout amount.');
    }
    const save = db.transaction(() => {
      const payoutId = db.prepare('INSERT INTO teacher_payouts (tid,amount,payout_date,notes) VALUES (?,?,?,?)').run(tid, amount, input.payout_date || today(), String(input.notes || '')).lastInsertRowid;
      const insert = db.prepare('INSERT INTO teacher_payout_details (payout_id,class_id,amount_for_class,for_month) VALUES (?,?,?,?)');
      details.forEach(d => insert.run(payoutId, d.class_id, Number(d.amount_for_class), d.for_month || null));
      return payoutId;
    });
    return save();
  });
  ipcMain.handle('settings:organization', () => {
    const oid = org();
    const db = getDatabase();
    return db.prepare('SELECT name,contact,payment_due_day,image_directory FROM organizations WHERE oid=?').get(oid);
  });
  ipcMain.handle('settings:saveOrganization', (_event, input) => {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Organization name is required.');
    const inputDueDay = input.payment_due_day;
    const dueDay = inputDueDay === '' || inputDueDay === null || inputDueDay === undefined
      ? null
      : Number(inputDueDay);
    if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      throw new Error('Payment due day must be between 1 and 31.');
    }
    const oid = org();
    const db = getDatabase();
    const updated = db.prepare('UPDATE organizations SET name=?,contact=?,payment_due_day=? WHERE oid=?')
      .run(name, String(input.contact || ''), dueDay, oid).changes > 0;
    if (updated) activeUser.organization = name;
    return updated;
  });
  ipcMain.handle('settings:saveImageDirectory', (_event, directory) => {
    return changeImageDirectory(getDatabase(), org(), directory);
  });
  ipcMain.handle('backup:getSettings', () => {
    const user = requireUser();
    const settings = getBackupSettings(user.oid);
    const connected = driveService.status(user.oid);
    const history = getDatabase().prepare(`SELECT backup_id,backup_type,file_path,status,error_message,created_at
      FROM backup_logs WHERE oid=? ORDER BY backup_id DESC LIMIT 20`).all(user.oid);
    const lastSuccessful = getDatabase().prepare(`SELECT created_at,backup_type FROM backup_logs
      WHERE oid=? AND status='success' AND backup_type IN ('google-manual','google-scheduled')
      ORDER BY backup_id DESC LIMIT 1`).get(user.oid) || null;
    let nextScheduled = null;
    if (settings.auto_enabled) {
      const now = new Date();
      const [hour, minute] = settings.backup_time.split(':').map(Number);
      const candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate <= now || settings.last_scheduled_date === backupLocalDate(now)) {
        candidate.setDate(candidate.getDate() + 1);
      }
      nextScheduled = candidate.toISOString();
    }
    return {
      settings: {
        googleClientId: settings.google_client_id,
        googleClientSecretConfigured: Boolean(driveService.getClientSecret(user.oid)),
        autoEnabled: Boolean(settings.auto_enabled),
        backupTime: settings.backup_time,
        retention: settings.retention,
        missedRecovery: Boolean(settings.missed_recovery),
        lastScheduledDate: settings.last_scheduled_date,
        lastStatus: settings.last_status,
        lastError: settings.last_error,
        lastBackupAt: settings.last_backup_at,
        nextScheduled
      },
      connected,
      passphraseConfigured: Boolean(driveService.getPassphrase(user.oid)),
      lastSuccessful,
      history
    };
  });
  ipcMain.handle('backup:saveSettings', (_event, input = {}) => {
    const user = requireUser();
    const clientId = String(input.googleClientId || '').trim();
    const clientSecret = String(input.googleClientSecret || '').trim();
    const backupTime = String(input.backupTime || '');
    const retention = String(input.retention || '');
    const autoEnabled = input.autoEnabled === true ? 1 : input.autoEnabled === false ? 0 : null;
    const missedRecovery = input.missedRecovery === true ? 1 : input.missedRecovery === false ? 0 : null;
    if (clientId.length > 255 || (clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))) {
      throw new Error('Enter a valid Google OAuth Client ID ending in .apps.googleusercontent.com.');
    }
    if (clientSecret.length > 1024) throw new Error('Enter a valid Google OAuth Client Secret.');
    if (clientSecret && !clientId) throw new Error('Enter the Google OAuth Client ID before saving its Client Secret.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(backupTime)) throw new Error('Choose a valid local backup time.');
    if (!['7', '30', 'all'].includes(retention)) throw new Error('Choose a valid backup retention setting.');
    if (autoEnabled === null || missedRecovery === null) throw new Error('Choose valid automatic and missed-backup settings.');
    const passphrase = String(input.recoveryPassphrase || '');
    if (passphrase && passphrase.length < 12) throw new Error('Use a recovery passphrase that is at least 12 characters long.');
    const current = getBackupSettings(user.oid);
    const currentClientSecret = driveService.getClientSecret(user.oid);
    if (clientId && !clientSecret && (!currentClientSecret || clientId !== current.google_client_id)) {
      throw new Error('Enter the Google OAuth Client Secret for this Client ID.');
    }
    if (passphrase) driveService.savePassphrase(user.oid, passphrase);
    if (clientId && clientSecret) driveService.saveClientSecret(user.oid, clientSecret);
    if (!clientId && currentClientSecret) driveService.secureStore.remove(driveService.clientSecretKey(user.oid));
    if (clientId !== current.google_client_id || (clientSecret && clientSecret !== currentClientSecret)) {
      driveService.clearConnection(user.oid);
    }
    getDatabase().prepare(`UPDATE backup_settings SET google_client_id=?,auto_enabled=?,backup_time=?,retention=?,
      missed_recovery=? WHERE oid=?`).run(clientId, autoEnabled, backupTime, retention, missedRecovery, user.oid);
    if (backupScheduler) void backupScheduler.checkStartup().catch(error => console.error('Scheduled cloud backup failed:', backupErrorMessage(error)));
    return true;
  });
  ipcMain.handle('backup:googleConnect', async () => {
    const user = requireUser();
    const result = await driveService.connect(user.oid);
    if (backupScheduler) void backupScheduler.check().catch(error => console.error('Scheduled cloud backup failed:', backupErrorMessage(error)));
    return result;
  });
  ipcMain.handle('backup:googleDisconnect', () => driveService.disconnect(org()));
  ipcMain.handle('backup:googleStatus', () => driveService.status(org()));
  ipcMain.handle('backup:googleUpload', async () => {
    const result = await runGoogleBackup('google-manual');
    return { uploaded: result.uploaded };
  });
  ipcMain.handle('backup:googleList', async () => {
    const user = requireUser();
    return driveService.listBackups(user.oid, organizationBackupKey(user.organization));
  });
  ipcMain.handle('backup:googleRestore', async (_event, fileId) => {
    const user = requireUser();
    if (backupOperationRunning) throw new Error('Another backup or restore operation is already in progress.');
    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Restore Google Drive backup?',
      message: 'Replace this computer’s Tuition Manager database?',
      detail: 'The selected backup will replace the current database. A local safety copy will be retained. After restore, sign in using an account from the backup.',
      buttons: ['Cancel', 'Restore database'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return { canceled: true };
    if (backupOperationRunning) throw new Error('Another backup or restore operation is already in progress.');
    backupOperationRunning = true;
    try {
      const passphrase = driveService.getPassphrase(user.oid);
      if (!passphrase) throw new Error('Enter and save the recovery passphrase in Backup settings first.');
      const orgKey = organizationBackupKey(user.organization);
      const encrypted = await driveService.downloadBackup(user.oid, fileId, orgKey);
      const directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'tuition-restore-'));
      try {
        const restorePath = prepareRestoreFile(encrypted, passphrase, directory);
        const restored = await restoreDatabaseFile(restorePath, {
          expectedOrganizationName: user.organization,
          retainSafetyCopy: true,
          backupLogReference: fileId,
          onRestoredOrganization: restoredOid => driveService.transferLocalSecrets(user.oid, restoredOid)
        });
        return restored;
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    } catch (error) {
      recordBackup(user.oid, 'google-restore', fileId, 'failed', error);
      throw error;
    } finally {
      backupOperationRunning = false;
    }
  });
  ipcMain.handle('backup:create', async () => {
    const choice = await dialog.showSaveDialog(window, {
      title: 'Save tuition database backup',
      defaultPath: `tuition_backup_${today()}_${new Date().toTimeString().slice(0, 5).replace(':', '')}.db`,
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    if (backupOperationRunning) throw new Error('Another backup or restore operation is already in progress.');
    backupOperationRunning = true;
    const destination = choice.filePath.endsWith('.db') ? choice.filePath : `${choice.filePath}.db`;
    try {
      await getDatabase().backup(destination);
      recordBackup(org(), 'local', destination, 'success');
      return { path: destination };
    } catch (error) {
      recordBackup(org(), 'local', destination, 'failed', error);
      throw error;
    } finally {
      backupOperationRunning = false;
    }
  });
  ipcMain.handle('backup:restore', async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'Choose a tuition database backup', properties: ['openFile'], filters: [{ name: 'SQLite database', extensions: ['db','sqlite','sqlite3'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
    const source = choice.filePaths[0];
    if (backupOperationRunning) throw new Error('Another backup or restore operation is already in progress.');
    backupOperationRunning = true;
    try {
      return await restoreDatabaseFile(source, { organizationId: org() });
    } catch (error) {
      recordBackup(org(), 'restore', source, 'failed', error);
      throw error;
    } finally {
      backupOperationRunning = false;
    }
  });
}

function getPendingTotal(oid, month) {
  const result = getDatabase().prepare(`SELECT COALESCE(SUM(ROUND(c.fee*(1-e.discount_percentage/100.0),2)),0) AS amount
    FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id
    LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
    WHERE c.oid=? AND c.status='active' AND e.status='active' AND substr(e.enrolled_date,1,7)<=? AND p.payment_id IS NULL`).get(month, oid, month);
  return money(result.amount);
}

function scheduleSessionAutoEnd(retryDelay) {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = retryDelay ?? Math.max(1, nextMidnight.getTime() - now.getTime());
  setTimeout(() => {
    try {
      endExpiredSessions(getDatabase(), localDate());
      scheduleSessionAutoEnd();
    } catch (error) {
      console.error('Failed to automatically end expired sessions:', error);
      scheduleSessionAutoEnd(60 * 1000);
    }
  }, delay);
}

app.whenReady().then(() => {
  const db = openDatabase(path.join(app.getPath('userData'), 'app.db'));
  migrateLegacyStudentPhotos(db, path.join(app.getPath('userData'), 'student-images'));
  endExpiredSessions(db, localDate());
  const secureStore = new SecureStore(path.join(app.getPath('userData'), 'secure-backup'), safeStorage);
  driveService = new GoogleDriveService({
    getSettings: getBackupSettings,
    secureStore,
    shell,
    getWindow: () => window,
    onConnectionChanged: () => {
      if (backupScheduler) void backupScheduler.check().catch(error => console.error('Scheduled cloud backup failed:', backupErrorMessage(error)));
    }
  });
  backupScheduler = createBackupScheduler({
    getSettings: () => {
      if (!activeUser) return null;
      const settings = getBackupSettings(activeUser.oid);
      return driveService.status(activeUser.oid).connected ? settings : null;
    },
    runScheduled: date => runGoogleBackup('google-scheduled', date),
    onError: error => console.error('Scheduled cloud backup failed:', backupErrorMessage(error))
  });
  registerIpc();
  scheduleSessionAutoEnd();
  createWindow();
  backupScheduler.start();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
