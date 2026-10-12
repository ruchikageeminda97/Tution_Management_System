const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { google } = require('googleapis');

const APP_PROPERTY = 'tuitionManagerBackup';
const APP_VALUE = 'v1';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function isTransient(error) {
  const status = error?.response?.status;
  const reasons = error?.response?.data?.error?.errors?.map(item => item.reason) || [];
  return status === 408 || status === 429 || status >= 500 ||
    reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError'].includes(reason)) ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error?.code);
}

function expiredBackups(backups, retention, newestId) {
  if (retention === 'all') return [];
  const keep = Number(retention);
  if (![7, 30].includes(keep)) throw new Error('Backup retention must be 7, 30, or all.');
  return backups.filter(backup => backup.id !== newestId).slice(Math.max(0, keep - 1));
}

function redactTokenError(value, secrets) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  let redacted = serialized || 'Unknown token endpoint error.';
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted
    .replace(/ya29\.[\w.-]+/g, '[redacted]')
    .replace(/1\/\/[\w.-]+/g, '[redacted]')
    .replace(/("(?:access_token|refresh_token|client_secret|code|code_verifier)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/((?:access_token|refresh_token|client_secret|code|code_verifier)=)[^&\s]+/gi, '$1[redacted]');
}

function tokenExchangeErrorMessage(responseBody, error, clientSecret) {
  const errorCode = responseBody?.error;
  const description = String(responseBody?.error_description || '').split(clientSecret || '\0').join('[redacted]');
  if (errorCode === 'invalid_client') {
    return 'Google rejected the OAuth client credentials. Check that the Client ID and Client Secret belong to the same Desktop app client.';
  }
  if (errorCode === 'invalid_grant') {
    return 'Google rejected the authorization code. Start Connect Google Drive again and finish sign-in promptly.';
  }
  if (errorCode === 'unauthorized_client') {
    return 'Google has not authorized this OAuth client for the requested sign-in. Check the Google Cloud OAuth configuration.';
  }
  if (description) return `Google token exchange failed: ${redactTokenError(description, [clientSecret])}`;
  return `Google token exchange failed${errorCode ? ` (${errorCode})` : ''}. Check your network and the Google Cloud OAuth client configuration, then try again.`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function retry(operation, attempts = 3, wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransient(error) || attempt + 1 >= attempts) throw error;
      await wait(500 * (2 ** attempt));
    }
  }
}

class GoogleDriveService {
  constructor({ getSettings, secureStore, shell, googleApi = google, onConnectionChanged = () => {} }) {
    this.getSettings = getSettings;
    this.secureStore = secureStore;
    this.shell = shell;
    this.googleApi = googleApi;
    this.onConnectionChanged = onConnectionChanged;
  }

  fileKey(oid) {
    return `google-tokens-${oid}`;
  }

  passphraseKey(oid) {
    return `backup-passphrase-${oid}`;
  }

  clientSecretKey(oid) {
    return `google-oauth-client-secret-${oid}`;
  }

  getConnection(oid) {
    return this.secureStore.read(this.fileKey(oid));
  }

  getPassphrase(oid) {
    return this.secureStore.read(this.passphraseKey(oid))?.value || null;
  }

  getClientSecret(oid) {
    return this.secureStore.read(this.clientSecretKey(oid))?.value || null;
  }

  saveClientSecret(oid, value) {
    this.secureStore.write(this.clientSecretKey(oid), { value });
  }

  savePassphrase(oid, value) {
    this.secureStore.write(this.passphraseKey(oid), { value });
  }

  saveTokens(oid, tokens, email) {
    const previous = this.getConnection(oid) || {};
    this.secureStore.write(this.fileKey(oid), {
      tokens: { ...previous.tokens, ...tokens },
      email: email || previous.email || ''
    });
  }

  transferLocalSecrets(fromOid, toOid) {
    if (fromOid === toOid) return;
    const tokens = this.secureStore.read(this.fileKey(fromOid));
    const passphrase = this.secureStore.read(this.passphraseKey(fromOid));
    const clientSecret = this.secureStore.read(this.clientSecretKey(fromOid));
    if (tokens) this.secureStore.write(this.fileKey(toOid), tokens);
    if (passphrase) this.secureStore.write(this.passphraseKey(toOid), passphrase);
    if (clientSecret) this.secureStore.write(this.clientSecretKey(toOid), clientSecret);
  }

  async connect(oid) {
    const settings = this.getSettings(oid);
    if (!settings.google_client_id) throw new Error('Enter the Google OAuth Client ID in Backup settings first.');
    const clientSecret = this.getClientSecret(oid);
    if (!clientSecret) throw new Error('Save the Google OAuth Client Secret in Backup settings first.');
    if (!this.getPassphrase(oid)) throw new Error('Save a recovery passphrase in Backup settings before connecting Google Drive.');
    const session = await this.authorize(settings.google_client_id, clientSecret);
    const existing = this.getConnection(oid);
    const existingTokens = session.email && existing?.email === session.email ? existing.tokens : {};
    this.secureStore.write(this.fileKey(oid), {
      tokens: { ...existingTokens, ...session.tokens },
      email: session.email
    });
    this.onConnectionChanged();
    return { connected: true, email: session.email };
  }

  async authorize(clientId, clientSecret) {
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
    const auth = new this.googleApi.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { codeVerifier, codeChallenge } = await auth.generateCodeVerifierAsync();
    const state = crypto.randomBytes(24).toString('hex');
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE, 'openid', 'email'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    const callback = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google sign-in timed out. Try connecting again.')), 180_000);
      timer.unref?.();
      server.on('request', async (request, response) => {
        const url = new URL(request.url, redirectUri);
        if (url.pathname !== '/oauth2callback') {
          response.writeHead(404).end();
          return;
        }
        if (url.searchParams.get('state') !== state) {
          response.writeHead(400).end('Sign-in state validation failed. Return to Tuition Manager and try again.');
          clearTimeout(timer);
          reject(new Error('Google sign-in could not be verified. Try connecting again.'));
          return;
        }
        const providerError = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (providerError || !code) {
          response.writeHead(400).end('Google sign-in was cancelled or denied. You can close this page.');
          clearTimeout(timer);
          reject(new Error(providerError === 'access_denied' ? 'Google Drive access was denied.' : 'Google sign-in did not return an authorization code.'));
          return;
        }
        let tokens;
        try {
          ({ tokens } = await auth.getToken({ code, codeVerifier }));
        } catch (error) {
          const responseBody = error?.response?.data;
          if (responseBody !== undefined) {
            console.error('Google OAuth token exchange failed:', redactTokenError(responseBody, [clientSecret, code, codeVerifier]));
          } else {
            console.error('Google OAuth token exchange failed:', redactTokenError(error?.message, [clientSecret, code, codeVerifier]));
          }
          const message = tokenExchangeErrorMessage(responseBody, error, clientSecret);
          response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
            .end(`<!doctype html><title>Tuition Manager</title><p>${escapeHtml(message)} Return to Tuition Manager.</p>`);
          clearTimeout(timer);
          reject(new Error(message));
          return;
        }
        try {
          auth.setCredentials(tokens);
          const account = await this.googleApi.oauth2({ version: 'v2', auth }).userinfo.get();
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end('<!doctype html><title>Tuition Manager</title><p>Google Drive is connected. You may return to Tuition Manager.</p>');
          clearTimeout(timer);
          resolve({ tokens, email: account.data.email || '' });
        } catch {
          response.writeHead(500).end('Google sign-in could not finish loading the account. Return to Tuition Manager and try again.');
          clearTimeout(timer);
          reject(new Error('Google authorized the sign-in, but account details could not be loaded. Check your connection and try again.'));
        }
      });
    });
    try {
      const [, session] = await Promise.all([this.shell.openExternal(authUrl), callback]);
      return session;
    } finally {
      server.close();
    }
  }

  async disconnect(oid) {
    this.clearConnection(oid);
    this.onConnectionChanged();
    return { disconnected: true };
  }

  clearConnection(oid) {
    this.secureStore.remove(this.fileKey(oid));
  }

  forgetOrganization(oid) {
    this.secureStore.remove(this.fileKey(oid));
    this.secureStore.remove(this.passphraseKey(oid));
    this.secureStore.remove(this.clientSecretKey(oid));
  }

  status(oid) {
    const connection = this.getConnection(oid);
    return {
      connected: Boolean(connection?.tokens?.refresh_token || connection?.tokens?.access_token),
      email: connection?.email || ''
    };
  }

  async authorizedDrive(oid) {
    const connection = this.getConnection(oid);
    if (!connection?.tokens) throw new Error('Connect a Google account before using Drive backups.');
    const { google_client_id: clientId } = this.getSettings(oid);
    if (!clientId) throw new Error('Enter the Google OAuth Client ID in Backup settings.');
    const clientSecret = this.getClientSecret(oid);
    if (!clientSecret) throw new Error('Enter the Google OAuth Client Secret in Backup settings.');
    const auth = new this.googleApi.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials(connection.tokens);
    auth.on('tokens', tokens => this.saveTokens(oid, tokens));
    const drive = this.googleApi.drive({ version: 'v3', auth });
    return {
      drive,
      run: async operation => {
        try {
          return await retry(operation);
        } catch (error) {
          if (error?.response?.status === 401 || error?.response?.data?.error === 'invalid_grant') {
            this.secureStore.remove(this.fileKey(oid));
            this.onConnectionChanged();
            throw new Error('Google Drive access expired or was revoked. Connect the Google account again.');
          }
          throw error;
        }
      }
    };
  }

  async findFolder(drive, run) {
    const response = await run(() => drive.files.list({
      q: "name='Tuition Manager Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id,name)',
      pageSize: 100,
      spaces: 'drive'
    }));
    const folder = response.data.files?.[0];
    if (folder) return folder.id;
    const generated = await run(() => drive.files.generateIds({ count: 1, space: 'drive', type: 'files' }));
    const folderId = generated.data.ids?.[0];
    if (!folderId) throw new Error('Google Drive could not allocate a backup folder ID.');
    try {
      await run(() => drive.files.create({
        requestBody: {
          id: folderId,
          name: 'Tuition Manager Backups',
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { [APP_PROPERTY]: APP_VALUE }
        },
        fields: 'id'
      }));
    } catch (error) {
      if (error?.response?.status !== 409) throw error;
    }
    return folderId;
  }

  async uploadBackup(filePath, type, oid, organizationKey, scheduledDate) {
    const { drive, run } = await this.authorizedDrive(oid);
    const folderId = await this.findFolder(drive, run);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `tuition-backup-${stamp}${type === 'google-manual' ? `-${crypto.randomBytes(2).toString('hex')}` : ''}.db.enc`;
    const expectedSize = fs.statSync(filePath).size;
    const generated = await run(() => drive.files.generateIds({ count: 1, space: 'drive', type: 'files' }));
    const fileId = generated.data.ids?.[0];
    if (!fileId) throw new Error('Google Drive could not allocate a backup file ID.');
    let creationError = null;
    try {
      await run(() => drive.files.create({
        requestBody: {
          id: fileId,
          name: filename,
          parents: [folderId],
          appProperties: {
            [APP_PROPERTY]: APP_VALUE,
            backupType: type,
            organizationKey,
            expectedSize: String(expectedSize),
            ...(scheduledDate ? { scheduledDate } : {})
          }
        },
        media: { mimeType: 'application/octet-stream', body: fs.createReadStream(filePath) },
        fields: 'id,name,size,createdTime,modifiedTime'
      }));
    } catch (error) {
      if (error?.response?.status !== 409 && !isTransient(error)) throw error;
      creationError = error;
    }
    try {
      const verified = await run(() => drive.files.get({
        fileId,
        fields: 'id,name,size,createdTime,modifiedTime,appProperties'
      }));
      if (Number(verified.data.size) !== expectedSize || verified.data.appProperties?.[APP_PROPERTY] !== APP_VALUE ||
        verified.data.appProperties?.organizationKey !== organizationKey) {
        throw new Error('Google Drive upload could not be verified; the uploaded file was incomplete or mismatched.');
      }
      return { ...verified.data, folderId };
    } catch (error) {
      if (creationError && error?.response?.status === 404) {
        throw new Error(`${creationError.message} Google Drive did not contain the uploaded backup after the interrupted request.`);
      }
      try {
        await run(() => drive.files.delete({ fileId }));
      } catch (cleanupError) {
        throw new Error(`${error.message} The incomplete Drive file could not be removed: ${cleanupError.message}`);
      }
      if (creationError) {
        throw new Error(`${creationError.message} Google Drive could not verify that this backup was uploaded: ${error.message}`);
      }
      throw error;
    }
  }

  async listBackups(oid, organizationKey) {
    const { drive, run } = await this.authorizedDrive(oid);
    const folderId = await this.findFolder(drive, run);
    const files = [];
    let pageToken;
    do {
      const response = await run(() => drive.files.list({
        q: `'${folderId}' in parents and trashed=false and appProperties has { key='${APP_PROPERTY}' and value='${APP_VALUE}' }`,
        fields: 'nextPageToken,files(id,name,size,createdTime,modifiedTime,appProperties)',
        orderBy: 'createdTime desc',
        pageSize: 1000,
        pageToken
      }));
      files.push(...(response.data.files || []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    return files
      .filter(file => file.name?.endsWith('.db.enc') && file.id &&
        file.appProperties?.organizationKey === organizationKey)
      .map(file => ({
        id: file.id,
        name: file.name,
        size: Number(file.size) || 0,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        status: 'success',
          type: file.appProperties?.backupType || 'google-manual',
          scheduledDate: file.appProperties?.scheduledDate || null,
          expectedSize: Number(file.appProperties?.expectedSize) || 0
        }));
  }

  async findScheduledBackup(oid, organizationKey, scheduledDate) {
    const backups = await this.listBackups(oid, organizationKey);
    return backups.find(backup =>
        backup.type === 'google-scheduled' &&
        backup.scheduledDate === scheduledDate &&
        backup.expectedSize > 0 &&
        backup.expectedSize === backup.size
    ) || null;
  }

  async downloadBackup(oid, fileId, organizationKey) {
    if (typeof fileId !== 'string' || !/^[\w-]{10,}$/.test(fileId)) throw new Error('Choose a valid Google Drive backup.');
    const { drive, run } = await this.authorizedDrive(oid);
    const metadata = await run(() => drive.files.get({ fileId, fields: 'id,name,appProperties' }));
    if (!metadata?.data || metadata.data.appProperties?.[APP_PROPERTY] !== APP_VALUE ||
      metadata.data.appProperties?.organizationKey !== organizationKey ||
      !metadata.data.name?.endsWith('.db.enc')) {
      throw new Error('The selected file was not created by Tuition Manager.');
    }
    const response = await run(() => drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    ));
    return Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  }

  async prune(oid, retention, newestId, organizationKey) {
    if (retention === 'all') return { deleted: 0, errors: [] };
    const backups = await this.listBackups(oid, organizationKey);
    const removable = expiredBackups(backups, retention, newestId);
    const { drive, run } = await this.authorizedDrive(oid);
    const errors = [];
    for (const backup of removable) {
      try {
        await run(() => drive.files.delete({ fileId: backup.id }));
      } catch (error) {
        errors.push(error.message);
      }
    }
    return { deleted: removable.length - errors.length, errors };
  }

  async retentionForSettings(oid, retention, newestId, organizationKey) {
    return this.prune(oid, retention, newestId, organizationKey);
  }
}

module.exports = { APP_PROPERTY, GoogleDriveService, expiredBackups, isTransient, retry };
