const crypto = require('node:crypto');

const MAGIC = Buffer.from('TCMSGDR1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function encryptBackup(plaintext, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new Error('Use a recovery passphrase that is at least 12 characters long.');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = crypto.scryptSync(passphrase, salt, KEY_BYTES);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
  } finally {
    key.fill(0);
  }
}

function decryptBackup(encrypted, passphrase) {
  if (!Buffer.isBuffer(encrypted) || encrypted.length < MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('This Google Drive backup is incomplete or not supported.');
  }
  if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('This Google Drive backup is not a Tuition Manager encrypted backup.');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new Error('Enter the recovery passphrase used when this backup was created.');
  }
  let offset = MAGIC.length;
  const salt = encrypted.subarray(offset, offset += SALT_BYTES);
  const iv = encrypted.subarray(offset, offset += IV_BYTES);
  const tag = encrypted.subarray(offset, offset += TAG_BYTES);
  const ciphertext = encrypted.subarray(offset);
  const key = crypto.scryptSync(passphrase, salt, KEY_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('The recovery passphrase is incorrect or this backup has been damaged.');
  } finally {
    key.fill(0);
  }
}

module.exports = { decryptBackup, encryptBackup };
