const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { decryptBackup, encryptBackup } = require('../main/services/backup-crypto');
const { createCloudBackup, prepareRestoreFile, validateDatabaseFile } = require('../main/services/backup-service');
const { backupIsDue, createBackupScheduler, localDate } = require('../main/services/backup-scheduler');
const { expiredBackups, GoogleDriveService, retry } = require('../main/services/google-drive');
const { SecureStore } = require('../main/services/secure-store');
const { migrateBackupSettings } = require('../main/database');

const PASSPHRASE = 'correct horse battery staple';

function createValidDatabase(filePath) {
  const database = new Database(filePath);
  database.exec(fs.readFileSync(path.join(__dirname, '..', 'main', 'schema.sql'), 'utf8'));
  database.prepare('INSERT INTO organizations (name) VALUES (?)').run('Backup Academy');
  database.close();
}

test('backup encryption is authenticated and requires the matching recovery phrase', () => {
  const plaintext = Buffer.from('private student and payment records');
  const encrypted = encryptBackup(plaintext, PASSPHRASE);
  assert.notDeepEqual(encrypted, plaintext);
  assert.equal(decryptBackup(encrypted, PASSPHRASE).toString(), plaintext.toString());
  assert.throws(() => decryptBackup(encrypted, 'wrong recovery phrase'), /incorrect or.*damaged/);
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => decryptBackup(damaged, PASSPHRASE), /incorrect or.*damaged/);
  assert.throws(() => encryptBackup(plaintext, 'short'), /at least 12/);
});

test('consistent SQLite snapshot is validated, encrypted before upload, and excludes external image files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-backup-test-'));
  const databasePath = path.join(directory, 'active.db');
  const externalPhoto = path.join(directory, 'student-photo.png');
  const database = new Database(databasePath);
  database.exec(fs.readFileSync(path.join(__dirname, '..', 'main', 'schema.sql'), 'utf8'));
  const oid = database.prepare('INSERT INTO organizations (name) VALUES (?)').run('Backup Academy').lastInsertRowid;
  database.prepare('INSERT INTO students (oid,name,contact1,photo_path) VALUES (?,?,?,?)')
    .run(oid, 'Private Student', '555-0100', externalPhoto);
  fs.writeFileSync(externalPhoto, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    let received;
    const uploaded = await createCloudBackup({
      database,
      organizationId: oid,
      passphrase: PASSPHRASE,
      type: 'google-manual',
      drive: {
        uploadBackup: async (filePath) => {
          received = fs.readFileSync(filePath);
          return { id: 'drive-file-identifier', size: received.length };
        }
      }
    });
    assert.equal(uploaded.id, 'drive-file-identifier');
    assert.ok(received.subarray(0, 8).equals(Buffer.from('TCMSGDR1')));
    assert.notEqual(received.subarray(0, 16).toString(), 'SQLite format 3\u0000');
    const decrypted = path.join(directory, 'decrypted.db');
    fs.writeFileSync(decrypted, decryptBackup(received, PASSPHRASE));
    validateDatabaseFile(decrypted, oid);
    const restored = new Database(decrypted, { readonly: true });
    assert.equal(restored.prepare('SELECT photo_path FROM students WHERE name=?').get('Private Student').photo_path, externalPhoto);
    restored.close();
    assert.equal(fs.existsSync(externalPhoto), true);
    assert.equal(fs.statSync(externalPhoto).size, 4);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('failed cloud upload surfaces an error and removes its temporary snapshot directory', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-backup-failure-test-'));
  const filePath = path.join(directory, 'source.db');
  createValidDatabase(filePath);
  const database = new Database(filePath);
  const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('tuition-backup-')));
  try {
    await assert.rejects(createCloudBackup({
      database,
      organizationId: 1,
      passphrase: PASSPHRASE,
      type: 'google-manual',
      drive: { uploadBackup: async () => { throw new Error('Upload interrupted'); } }
    }), /Upload interrupted/);
    const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('tuition-backup-'));
    assert.deepEqual(after.filter(name => !before.has(name)), []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('decrypted restore files are validated before they can be swapped into place', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-restore-test-'));
  const validPath = path.join(directory, 'valid.db');
  createValidDatabase(validPath);
  const encrypted = encryptBackup(fs.readFileSync(validPath), PASSPHRASE);
  try {
    const restored = prepareRestoreFile(encrypted, PASSPHRASE, directory);
    validateDatabaseFile(restored);
    assert.throws(() => prepareRestoreFile(encryptBackup(Buffer.from('not sqlite'), PASSPHRASE), PASSPHRASE, directory), /valid Tuition Manager/);
    assert.throws(() => prepareRestoreFile(encrypted, 'wrong recovery phrase', directory), /incorrect or.*damaged/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('existing local database backups without Drive metadata remain compatible', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-local-compatibility-'));
  const filePath = path.join(directory, 'older-local-backup.db');
  createValidDatabase(filePath);
  const older = new Database(filePath);
  older.exec('DROP TABLE backup_settings');
  older.close();
  try {
    assert.equal(validateDatabaseFile(filePath), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('daily schedule only runs after the configured local time and once per local date', () => {
  const settings = { auto_enabled: 1, backup_time: '15:00', last_scheduled_date: null };
  const before = new Date(2026, 9, 12, 14, 59, 59);
  const after = new Date(2026, 9, 12, 15, 0, 0);
  assert.equal(backupIsDue(settings, before), false);
  assert.equal(backupIsDue(settings, after), true);
  assert.equal(backupIsDue({ ...settings, last_scheduled_date: localDate(after) }, after), false);
  assert.equal(backupIsDue({ ...settings, auto_enabled: 0 }, after), false);
});

test('scheduler coalesces concurrent checks and recovers one missed daily backup', async () => {
  let current = new Date(2026, 9, 12, 16, 0);
  let count = 0;
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const scheduler = createBackupScheduler({
    getSettings: () => ({ auto_enabled: 1, backup_time: '15:00', last_scheduled_date: null }),
    now: () => current,
    runScheduled: async date => {
      count += 1;
      assert.equal(date, count === 1 ? '2026-10-12' : '2026-10-13');
      await gate;
    }
  });
  const first = scheduler.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.isRunning(), true);
  assert.equal(await scheduler.check(), false);
  finish();
  assert.equal(await first, true);
  current = new Date(2026, 9, 13, 16, 0);
  await scheduler.check();
  assert.equal(count, 2);
});

test('missed backup setting suppresses a backup missed while the app was closed', async () => {
  let calls = 0;
  const scheduler = createBackupScheduler({
    getSettings: () => ({ auto_enabled: 1, missed_recovery: 0, backup_time: '15:00', last_scheduled_date: null }),
    now: () => new Date(2026, 9, 12, 16, 0),
    runScheduled: async () => { calls += 1; }
  });
  scheduler.start();
  await scheduler.check();
  scheduler.stop();
  assert.equal(calls, 0);
});

test('retention keeps the newest valid file and supports keeping all backups', () => {
  const backups = Array.from({ length: 31 }, (_, index) => ({ id: `backup-${index}` }));
  assert.equal(expiredBackups(backups, '30', 'backup-0').length, 1);
  assert.equal(expiredBackups(backups, '7', 'backup-0').length, 24);
  assert.equal(expiredBackups(backups, 'all', 'backup-0').length, 0);
  assert.throws(() => expiredBackups(backups, '3', 'backup-0'), /retention/);
});

test('temporary Drive rate limits are retried with exponential backoff but quota errors are not', async () => {
  let calls = 0;
  const waits = [];
  const result = await retry(async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error('rate limited');
      error.response = { status: 403, data: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } };
      throw error;
    }
    return 'uploaded';
  }, 3, async delay => { waits.push(delay); });
  assert.equal(result, 'uploaded');
  assert.deepEqual(waits, [500, 1000]);
  const quota = new Error('Drive storage quota exceeded');
  quota.response = { status: 403, data: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } };
  await assert.rejects(retry(async () => { throw quota; }, 3, async () => {}), /quota exceeded/);
});

test('OAuth connection state is stored only through the secure store and disconnect clears it', async () => {
  const values = new Map();
  const secureStore = {
    read: name => values.get(name) || null,
    write: (name, value) => values.set(name, value),
    remove: name => values.delete(name)
  };
  const service = new GoogleDriveService({
    getSettings: () => ({ google_client_id: 'desktop.apps.googleusercontent.com' }),
    secureStore,
    shell: { openExternal: async () => {} }
  });
  service.savePassphrase(4, PASSPHRASE);
  service.saveClientSecret(4, 'desktop-client-secret');
  service.authorize = async () => ({ tokens: { access_token: 'secret-token' }, email: 'admin@example.com' });
  const connected = await service.connect(4);
  assert.deepEqual(connected, { connected: true, email: 'admin@example.com' });
  assert.deepEqual(service.status(4), { connected: true, email: 'admin@example.com' });
  assert.equal(values.get('google-tokens-4').tokens.access_token, 'secret-token');
  await service.disconnect(4);
  assert.deepEqual(service.status(4), { connected: false, email: '' });
});

test('Drive upload, listing, verification and deletion use mocked API records owned by this app', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-drive-mock-'));
  const uploadPath = path.join(directory, 'backup.db.enc');
  const contents = Buffer.from('encrypted backup payload');
  fs.writeFileSync(uploadPath, contents);
  const files = new Map();
  const deleted = [];
  const api = {
    auth: {
      OAuth2: class {
        constructor(...args) { constructorArgs.push(args); }
        setCredentials() {}
        on() {}
      }
    },
    drive: () => ({
      files: {
        generateIds: async () => ({ data: { ids: ['generated-drive-file-id'] } }),
        list: async ({ q }) => ({
          data: {
            files: q.includes("name='Tuition Manager Backups'")
              ? [{ id: 'backup-folder-id', name: 'Tuition Manager Backups' }]
              : [...files.values()]
          }
        }),
        create: async ({ requestBody, media }) => {
          let written = 0;
          for await (const chunk of media.body) written += chunk.length;
          const result = {
            id: requestBody.id,
            name: requestBody.name,
            size: String(written),
            createdTime: '2026-10-12T10:00:00.000Z',
            modifiedTime: '2026-10-12T10:00:00.000Z',
            appProperties: requestBody.appProperties
          };
          files.set(result.id, result);
          return { data: result };
        },
        get: async ({ fileId, alt }) => ({
          data: alt === 'media' ? contents : files.get(fileId)
        }),
        delete: async ({ fileId }) => { deleted.push(fileId); files.delete(fileId); }
      }
    })
  };
  const constructorArgs = [];
  const secureStore = {
    read: name => name === 'google-tokens-7'
      ? { tokens: { refresh_token: 'encrypted-by-store' } }
      : name === 'google-oauth-client-secret-7' ? { value: 'desktop-client-secret' } : null
  };
  const service = new GoogleDriveService({
    getSettings: () => ({ google_client_id: 'desktop.apps.googleusercontent.com' }),
    secureStore,
    shell: { openExternal: async () => {} },
    googleApi: api
  });
  try {
    const uploaded = await service.uploadBackup(uploadPath, 'google-scheduled', 7, 'centre-key', '2026-10-12');
    assert.equal(uploaded.id, 'generated-drive-file-id');
    const listed = await service.listBackups(7, 'centre-key');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'success');
    assert.equal(listed[0].scheduledDate, '2026-10-12');
    assert.deepEqual(constructorArgs[0], ['desktop.apps.googleusercontent.com', 'desktop-client-secret']);
    assert.equal((await service.findScheduledBackup(7, 'centre-key', '2026-10-12')).id, uploaded.id);
    assert.deepEqual(await service.downloadBackup(7, uploaded.id, 'centre-key'), contents);
    const retention = await service.prune(7, '7', uploaded.id, 'centre-key');
    assert.equal(retention.deleted, 0);
    assert.deepEqual(deleted, []);
    await assert.rejects(service.downloadBackup(7, 'unrelated-drive-file-id', 'centre-key'), /not created by Tuition Manager/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('secure token and recovery settings can follow a restored organization with a different local ID', () => {
  const values = new Map([
    ['google-tokens-3', { tokens: { refresh_token: 'encrypted-refresh' }, email: 'admin@example.com' }],
    ['backup-passphrase-3', { value: PASSPHRASE }],
    ['google-oauth-client-secret-3', { value: 'desktop-client-secret' }]
  ]);
  const secureStore = {
    read: name => values.get(name) || null,
    write: (name, value) => values.set(name, value)
  };
  const service = new GoogleDriveService({
    getSettings: () => ({ google_client_id: 'desktop.apps.googleusercontent.com' }),
    secureStore,
    shell: { openExternal: async () => {} }
  });
  service.transferLocalSecrets(3, 28);
  assert.deepEqual(values.get('google-tokens-28'), values.get('google-tokens-3'));
  assert.deepEqual(values.get('backup-passphrase-28'), values.get('backup-passphrase-3'));
  assert.deepEqual(values.get('google-oauth-client-secret-28'), values.get('google-oauth-client-secret-3'));
});

test('OAuth uses a fresh state and PKCE verifier, matching loopback redirect and client secret', async () => {
  const createdClients = [];
  const tokenRequests = [];
  let verifierNumber = 0;
  let tamperState = false;
  const api = {
    auth: {
      OAuth2: class {
        constructor(clientId, clientSecret, redirectUri) {
          Object.assign(this, { clientId, clientSecret, redirectUri });
          createdClients.push(this);
        }
        async generateCodeVerifierAsync() {
          verifierNumber += 1;
          const codeVerifier = `fresh-verifier-${verifierNumber}`;
          return { codeVerifier, codeChallenge: `S256(${codeVerifier})` };
        }
        generateAuthUrl(options) {
          this.options = options;
          const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          for (const [key, value] of Object.entries({
            ...options,
            scope: options.scope.join(' ')
          })) url.searchParams.set(key, value);
          url.searchParams.set('redirect_uri', this.redirectUri);
          this.authorizationRedirectUri = url.searchParams.get('redirect_uri');
          return url.toString();
        }
        async getToken(request) {
          this.tokenRedirectUri = this.redirectUri;
          tokenRequests.push({ client: this, request });
          return { tokens: { access_token: `access-${verifierNumber}` } };
        }
        setCredentials() {}
      }
    },
    oauth2: () => ({ userinfo: { get: async () => ({ data: { email: 'owner@example.com' } }) } })
  };
  const service = new GoogleDriveService({
    getSettings: () => ({}),
    secureStore: { read: () => null, write() {}, remove() {} },
    googleApi: api,
    shell: {
      openExternal: async authUrl => {
        const authorization = new URL(authUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', 'authorization-code');
        redirect.searchParams.set('state', tamperState ? 'incorrect-state' : authorization.searchParams.get('state'));
        await new Promise((resolve, reject) => {
          const request = require('node:http').get(redirect, response => {
            response.resume();
            response.on('end', resolve);
          });
          request.on('error', reject);
        });
      }
    }
  });

  for (let index = 1; index <= 2; index += 1) {
    const result = await service.authorize('desktop.apps.googleusercontent.com', 'desktop-client-secret');
    assert.equal(result.email, 'owner@example.com');
  }
  tamperState = true;
  await assert.rejects(
    service.authorize('desktop.apps.googleusercontent.com', 'desktop-client-secret'),
    /could not be verified/
  );
  assert.equal(createdClients.length, 3);
  assert.equal(new Set(createdClients.map(client => client.options.state)).size, 3);
  for (const [index, client] of createdClients.slice(0, 2).entries()) {
    assert.equal(client.clientSecret, 'desktop-client-secret');
    assert.equal(client.options.access_type, 'offline');
    assert.equal(client.options.prompt, 'consent');
    assert.equal(client.options.code_challenge, `S256(fresh-verifier-${index + 1})`);
    assert.equal(client.options.code_challenge_method, 'S256');
    assert.equal(client.authorizationRedirectUri, client.tokenRedirectUri);
    assert.equal(new URL(client.authorizationRedirectUri).pathname, '/oauth2callback');
    assert.equal(tokenRequests[index].request.codeVerifier, `fresh-verifier-${index + 1}`);
  }
  assert.equal(tokenRequests.length, 2);
});

test('OAuth token exchange exposes a useful error and logs response details without credentials', async () => {
  const clientSecret = 'private-client-secret';
  const authorizationCode = 'private-authorization-code';
  const verifier = 'private-code-verifier';
  let logged;
  const originalError = console.error;
  console.error = (...args) => { logged = args.join(' '); };
  const api = {
    auth: {
      OAuth2: class {
        constructor(_clientId, _clientSecret, redirectUri) { this.redirectUri = redirectUri; }
        async generateCodeVerifierAsync() { return { codeVerifier: verifier, codeChallenge: 'challenge' }; }
        generateAuthUrl(options) {
          const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          url.searchParams.set('state', options.state);
          url.searchParams.set('redirect_uri', this.redirectUri);
          return url.toString();
        }
        async getToken() {
          const error = new Error('token endpoint rejected credentials');
          error.response = {
            data: {
              error: 'invalid_client',
              error_description: 'bad client configuration',
              client_secret: clientSecret,
              access_token: 'must-not-be-logged',
              code: authorizationCode,
              code_verifier: verifier
            }
          };
          throw error;
        }
      }
    }
  };
  const service = new GoogleDriveService({
    getSettings: () => ({}),
    secureStore: { read: () => null, write() {}, remove() {} },
    googleApi: api,
    shell: {
      openExternal: async authUrl => {
        const authorization = new URL(authUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', authorizationCode);
        redirect.searchParams.set('state', authorization.searchParams.get('state'));
        await new Promise((resolve, reject) => {
          const request = require('node:http').get(redirect, response => {
            response.resume();
            response.on('end', resolve);
          });
          request.on('error', reject);
        });
      }
    }
  });
  try {
    await assert.rejects(
      service.authorize('desktop.apps.googleusercontent.com', clientSecret),
      /Google rejected the OAuth client credentials/
    );
    assert.match(logged, /invalid_client/);
    assert.doesNotMatch(logged, new RegExp(clientSecret));
    assert.doesNotMatch(logged, new RegExp(authorizationCode));
    assert.doesNotMatch(logged, /must-not-be-logged/);
    assert.match(logged, /\[redacted\]/);
  } finally {
    console.error = originalError;
  }
});

test('OS secure store encrypts settings and refuses writes without native encryption', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-secure-store-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value.split('').reverse().join('')),
    decryptString: value => value.toString().split('').reverse().join('')
  };
  const secureStore = new SecureStore(directory, safeStorage);
  try {
    secureStore.write('oauth', { refreshToken: 'secret-value' });
    assert.deepEqual(secureStore.read('oauth'), { refreshToken: 'secret-value' });
    assert.notEqual(fs.readFileSync(path.join(directory, 'oauth.secure'), 'utf8').includes('secret-value'), true);
    const unavailable = new SecureStore(directory, { ...safeStorage, isEncryptionAvailable: () => false });
    assert.throws(() => unavailable.write('plain', { token: 'secret' }), /unavailable/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('backup migration adds metadata columns once on existing databases', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`CREATE TABLE backup_logs (backup_id INTEGER PRIMARY KEY,oid INTEGER,backup_type TEXT,file_path TEXT,status TEXT,created_at TEXT);
      CREATE TABLE backup_settings (oid INTEGER PRIMARY KEY,google_client_id TEXT,auto_enabled INTEGER,backup_time TEXT,retention TEXT,missed_recovery INTEGER,last_scheduled_date TEXT,last_status TEXT,last_error TEXT,last_backup_at TEXT)`);
    migrateBackupSettings(database);
    migrateBackupSettings(database);
    assert.ok(new Set(database.pragma('table_info(backup_logs)').map(column => column.name)).has('error_message'));
    assert.ok(new Set(database.pragma('table_info(backup_settings)').map(column => column.name)).has('retry_after'));
    assert.equal(database.pragma('user_version', { simple: true }), 2);
  } finally {
    database.close();
  }
});
