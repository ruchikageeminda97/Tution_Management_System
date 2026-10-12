const fs = require('node:fs');
const path = require('node:path');

class SecureStore {
  constructor(directory, safeStorage) {
    this.directory = directory;
    this.safeStorage = safeStorage;
  }

  filePath(name) {
    return path.join(this.directory, `${name}.secure`);
  }

  assertAvailable() {
    const backend = this.safeStorage.getSelectedStorageBackend?.();
    if (!this.safeStorage.isEncryptionAvailable() || backend === 'basic_text') {
      throw new Error('OS-protected secure storage is unavailable. Configure the operating-system key store before using Drive backups.');
    }
  }

  read(name) {
    const file = this.filePath(name);
    if (!fs.existsSync(file)) return null;
    this.assertAvailable();
    const ciphertext = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
    return JSON.parse(this.safeStorage.decryptString(ciphertext));
  }

  write(name, value) {
    this.assertAvailable();
    fs.mkdirSync(this.directory, { recursive: true });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    const temporary = `${this.filePath(name)}.tmp`;
    fs.writeFileSync(temporary, encrypted, { flag: 'w' });
    fs.renameSync(temporary, this.filePath(name));
  }

  remove(name) {
    fs.rmSync(this.filePath(name), { force: true });
  }
}

module.exports = { SecureStore };
