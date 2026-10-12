function localDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function backupIsDue(settings, now = new Date()) {
  if (!settings || !settings.auto_enabled) return false;
  if (settings.retry_after && now < new Date(settings.retry_after)) return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(settings.backup_time || '');
  if (!match) return false;
  const scheduled = new Date(now);
  scheduled.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return now >= scheduled && settings.last_scheduled_date !== localDate(now);
}

function createBackupScheduler({ getSettings, runScheduled, intervalMs = 60_000, now = () => new Date(), onError = () => {} }) {
  let timer;
  let running = false;
  let missedBackupBlockedDate = null;

  async function check() {
    if (running) return false;
    const settings = getSettings();
    const current = now();
    if (missedBackupBlockedDate === localDate(current) || !backupIsDue(settings, current)) return false;
    running = true;
    try {
      await runScheduled(localDate(now()));
      return true;
    } finally {
      running = false;
    }
  }

  return {
    checkStartup() {
      const settings = getSettings();
      const current = now();
      if (settings && !settings.missed_recovery && backupIsDue(settings, current)) {
        missedBackupBlockedDate = localDate(current);
      }
      return check();
    },
    start() {
      if (timer) return;
      void this.checkStartup().catch(onError);
      timer = setInterval(() => {
        void check().catch(onError);
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    check,
    isRunning: () => running
  };
}

module.exports = { backupIsDue, createBackupScheduler, localDate };
