const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { decryptBackup, encryptBackup } = require('./backup-crypto');

const REQUIRED_TABLES = [
  'organizations', 'users', 'students', 'teachers', 'halls', 'hall_availability',
  'classes', 'class_schedules', 'class_enrollments', 'sessions', 'attendance',
  'payments', 'teacher_payouts', 'teacher_payout_details', 'backup_logs'
];

function validateDatabaseFile(filePath, organizationId) {
  let candidate;
  try {
    candidate = new Database(filePath, { readonly: true, fileMustExist: true });
    const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (REQUIRED_TABLES.some(name => !tables.has(name))) {
      throw new Error('This file is not a valid Tuition Manager database backup.');
    }
    if (candidate.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('This backup database is damaged and cannot be restored.');
    }
    if (organizationId && !candidate.prepare('SELECT 1 FROM organizations WHERE oid=?').get(organizationId)) {
      throw new Error('This backup does not contain your organization.');
    }
    return true;
  } catch (error) {
    if (error.code === 'SQLITE_NOTADB' || /file is not a database/i.test(error.message)) {
      throw new Error('This file is not a valid Tuition Manager database backup.');
    }
    throw error;
  } finally {
    if (candidate && candidate.open) candidate.close();
  }
}

async function createCloudBackup({ database, drive, organizationId, passphrase, type, onProgress = () => {} }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tuition-backup-'));
  const snapshotPath = path.join(directory, 'snapshot.db');
  const encryptedPath = path.join(directory, 'backup.db.enc');
  try {
    onProgress({ stage: 'snapshot' });
    await database.backup(snapshotPath);
    validateDatabaseFile(snapshotPath, organizationId);
    onProgress({ stage: 'encrypt' });
    const plaintext = fs.readFileSync(snapshotPath);
    let encrypted;
    try {
      encrypted = encryptBackup(plaintext, passphrase);
    } finally {
      plaintext.fill(0);
    }
    fs.writeFileSync(encryptedPath, encrypted, { flag: 'wx' });
    encrypted.fill(0);
    onProgress({ stage: 'upload' });
    const uploaded = await drive.uploadBackup(encryptedPath, type);
    if (!uploaded || !uploaded.id || Number(uploaded.size) <= 0) {
      throw new Error('Google Drive did not verify the uploaded backup.');
    }
    return uploaded;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function prepareRestoreFile(encrypted, passphrase, directory) {
  const restorePath = path.join(directory, `restore-${crypto.randomUUID()}.db`);
  const plaintext = decryptBackup(encrypted, passphrase);
  try {
    fs.writeFileSync(restorePath, plaintext, { flag: 'wx' });
  } finally {
    plaintext.fill(0);
  }
  try {
    validateDatabaseFile(restorePath);
    return restorePath;
  } catch (error) {
    fs.rmSync(restorePath, { force: true });
    throw error;
  }
}

module.exports = { REQUIRED_TABLES, createCloudBackup, prepareRestoreFile, validateDatabaseFile };
