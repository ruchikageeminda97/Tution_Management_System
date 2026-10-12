const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

let db;

function openDatabase(filePath) {
  if (db && db.open) db.close();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrateBackupSettings(db);
  const organizationColumns = new Set(db.pragma('table_info(organizations)').map(column => column.name));
  if (!organizationColumns.has('payment_due_day')) {
    db.exec('ALTER TABLE organizations ADD COLUMN payment_due_day INTEGER CHECK (payment_due_day BETWEEN 1 AND 31)');
  }
  if (!organizationColumns.has('image_directory')) {
    db.exec('ALTER TABLE organizations ADD COLUMN image_directory TEXT');
  }
  const studentColumns = new Set(db.pragma('table_info(students)').map(column => column.name));
  if (!studentColumns.has('photo_path')) {
    db.exec('ALTER TABLE students ADD COLUMN photo_path TEXT');
  }
  const paymentColumns = new Set(db.pragma('table_info(payments)').map(column => column.name));
  if (!paymentColumns.has('receipt_id')) {
    db.exec('ALTER TABLE payments ADD COLUMN receipt_id INTEGER REFERENCES payment_receipts(receipt_id)');
  }
  const historicalPayments = db.prepare(`SELECT p.payment_id,p.payment_date,p.payment_time,p.recorded_by,c.oid
    FROM payments p JOIN class_enrollments e ON e.enrollment_id=p.enrollment_id
    JOIN classes c ON c.class_id=e.class_id
    WHERE p.receipt_id IS NULL ORDER BY p.payment_id`).all();
  if (historicalPayments.length) {
    const migratePayments = db.transaction(() => {
      const insertReceipt = db.prepare(`INSERT INTO payment_receipts
        (oid,payment_date,payment_time,recorded_by) VALUES (?,?,?,?)`);
      const setReceiptCode = db.prepare('UPDATE payment_receipts SET receipt_code=? WHERE receipt_id=?');
      const linkPayment = db.prepare('UPDATE payments SET receipt_id=? WHERE payment_id=?');
      for (const payment of historicalPayments) {
        const receiptId = insertReceipt.run(
          payment.oid, payment.payment_date, payment.payment_time, payment.recorded_by
        ).lastInsertRowid;
        const receiptCode = String(receiptId).padStart(8, '0');
        if (receiptCode.length > 8) throw new Error('Payment receipt number limit reached during database migration.');
        setReceiptCode.run(receiptCode, receiptId);
        linkPayment.run(receiptId, payment.payment_id);
      }
    });
    migratePayments();
  }
  const legacyDueDates = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payment_due_dates'").get();
  if (legacyDueDates) {
    db.exec(`UPDATE organizations
      SET payment_due_day=(
        SELECT CAST(substr(due_date,9,2) AS INTEGER)
        FROM payment_due_dates
        WHERE oid=organizations.oid
        ORDER BY (for_month=strftime('%Y-%m','now')) DESC,for_month DESC
        LIMIT 1
      )
      WHERE payment_due_day IS NULL
        AND EXISTS (SELECT 1 FROM payment_due_dates WHERE oid=organizations.oid)`);
  }
  const sessionColumns = new Set(db.pragma('table_info(sessions)').map(column => column.name));
  if (!sessionColumns.has('hall_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN hall_id INTEGER REFERENCES halls(hall_id)');
  }
  if (!sessionColumns.has('is_special')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_special INTEGER NOT NULL DEFAULT 0 CHECK (is_special IN (0,1))');
  }
  for (const column of ['register_opened_at', 'class_started_at', 'ended_at']) {
    if (!sessionColumns.has(column)) db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT`);
  }
  if (!sessionColumns.has('ended_automatically')) {
    db.exec('ALTER TABLE sessions ADD COLUMN ended_automatically INTEGER NOT NULL DEFAULT 0 CHECK (ended_automatically IN (0,1))');
  }
  const attendanceColumns = new Set(db.pragma('table_info(attendance)').map(column => column.name));
  if (!attendanceColumns.has('present_at')) {
    db.exec('ALTER TABLE attendance ADD COLUMN present_at TEXT');
  }
  return db;
}

function migrateBackupSettings(database) {
  const version = database.pragma('user_version', { simple: true });
  if (version >= 2) return;
  const migrate = database.transaction(() => {
    const backupColumns = new Set(database.pragma('table_info(backup_logs)').map(column => column.name));
    if (!backupColumns.has('error_message')) {
      database.exec('ALTER TABLE backup_logs ADD COLUMN error_message TEXT');
    }
    const settingsColumns = new Set(database.pragma('table_info(backup_settings)').map(column => column.name));
    if (!settingsColumns.has('retry_after')) {
      database.exec('ALTER TABLE backup_settings ADD COLUMN retry_after TEXT');
    }
    database.pragma('user_version = 2');
  });
  migrate();
}

function getDatabase() {
  if (!db) throw new Error('Database is not available.');
  return db;
}

function resetDatabase(database = getDatabase()) {
  const foreignKeysEnabled = database.pragma('foreign_keys', { simple: true });
  const tables = database.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(row => row.name);
  const reset = database.transaction(() => {
    for (const table of tables) {
      database.prepare(`DELETE FROM "${table.replace(/"/g, '""')}"`).run();
    }
    const hasSequence = database.prepare(`SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='sqlite_sequence'`).get();
    if (hasSequence) database.prepare('DELETE FROM sqlite_sequence').run();
  });

  if (foreignKeysEnabled) database.pragma('foreign_keys = OFF');
  try {
    reset();
  } finally {
    if (foreignKeysEnabled) database.pragma('foreign_keys = ON');
  }
}

module.exports = { openDatabase, getDatabase, resetDatabase, migrateBackupSettings };
