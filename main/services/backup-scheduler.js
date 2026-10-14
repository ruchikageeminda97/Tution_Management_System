function localDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseWeeklySchedule(settings) {
  let schedule = settings?.weekly_schedule;
  if (typeof schedule === 'string') {
    try {
      schedule = JSON.parse(schedule);
    } catch {
      schedule = null;
    }
  }
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    const time = settings?.backup_time;
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time || '')
      ? Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, [time]]))
      : {};
  }
  return schedule;
}

function dueScheduledSlot(settings, now = new Date()) {
  if (!settings || !settings.auto_enabled) return null;
  if (settings.retry_after && now < new Date(settings.retry_after)) return null;
  const day = String(now.getDay());
  const times = parseWeeklySchedule(settings)[day];
  if (!Array.isArray(times)) return null;
  const dueTimes = times
    .filter(time => typeof time === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time))
    .sort();
  const dueTime = dueTimes.filter(time => {
    const [hour, minute] = time.split(':').map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);
    return now >= scheduled;
  }).at(-1);
  if (!dueTime) return null;
  const slot = `${localDate(now)}T${dueTime}`;
  if (!settings.last_scheduled_slot && settings.last_scheduled_date === localDate(now)) return null;
  if (slot <= (settings.last_scheduled_slot || '')) return null;
  return slot;
}

function backupIsDue(settings, now = new Date()) {
  return Boolean(dueScheduledSlot(settings, now));
}

function createBackupScheduler({ getSettings, runScheduled, intervalMs = 60_000, now = () => new Date(), onError = () => {} }) {
  let timer;
  let running = false;
  let startupBlockedSlot = null;

  async function check() {
    if (running) return false;
    const settings = getSettings();
    const current = now();
    const slot = dueScheduledSlot(settings, current);
    if (!slot || slot === startupBlockedSlot) return false;
    running = true;
    try {
      await runScheduled(slot);
      return true;
    } finally {
      running = false;
    }
  }

  return {
    checkStartup() {
      const settings = getSettings();
      const current = now();
      if (settings && !settings.missed_recovery) {
        startupBlockedSlot = dueScheduledSlot(settings, current);
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

module.exports = { backupIsDue, createBackupScheduler, dueScheduledSlot, localDate, parseWeeklySchedule };
