const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const Database = require('better-sqlite3');
const { overlaps, slotIsAvailable, validateSlots } = require('../main/scheduling');
const { dueDateForMonth, overduePaymentMonths } = require('../main/payment-due');
const { buildAttendanceReportHtml } = require('../main/attendance-report');
const { buildDailySummaryReportHtml } = require('../main/daily-summary-report');
const { buildClassPaymentReportHtml } = require('../main/class-payment-report');
const { openDatabase, resetDatabase } = require('../main/database');
const { recordPaymentReceipt, listRecentPaymentReceipts } = require('../main/payment-receipt');
const { buildPaymentReceiptHtml, buildCode39Svg } = require('../main/payment-receipt-report');
const { completeOngoingSession, endExpiredSessions } = require('../main/session-lifecycle');
const { recoverExistingAdmin } = require('../main/account-recovery');
const {
  changeImageDirectory,
  migrateLegacyStudentPhotos,
  readStudentImage
} = require('../main/student-images');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'main', 'schema.sql'), 'utf8'));
  return db;
}

function seed(db) {
  const organization = db.prepare('INSERT INTO organizations (name) VALUES (?)').run('Bright Academy').lastInsertRowid;
  const teacher = db.prepare('INSERT INTO teachers (oid,name) VALUES (?,?)').run(organization, 'Alex Teacher').lastInsertRowid;
  const student = db.prepare('INSERT INTO students (oid,name,contact1) VALUES (?,?,?)').run(organization, 'Jamie Student', '555-0100').lastInsertRowid;
  const classId = db.prepare('INSERT INTO classes (oid,class_name,tid,fee,teacher_commission_percentage) VALUES (?,?,?,?,?)').run(organization, 'Maths', teacher, 1000, 80).lastInsertRowid;
  const enrollment = db.prepare('INSERT INTO class_enrollments (class_id,stid,discount_percentage) VALUES (?,?,?)').run(classId, student, 50).lastInsertRowid;
  return { organization, teacher, student, classId, enrollment };
}

test('database reset clears all application records and allows fresh setup', () => {
  const db = createDatabase();
  try {
    const records = seed(db);
    db.prepare('INSERT INTO users (oid,username,password_hash,role) VALUES (?,?,?,?)')
      .run(records.organization, 'admin', 'hash', 'admin');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

    resetDatabase(db);

    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    for (const table of ['organizations', 'users', 'students', 'teachers', 'classes', 'payments', 'attendance']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count, 0, `${table} should be empty`);
    }
    assert.equal(db.prepare('INSERT INTO organizations (name) VALUES (?)').run('Fresh Academy').lastInsertRowid, 1);
  } finally {
    db.close();
  }
});

test('account recovery verifies workspace contact and replaces administrator credentials', () => {
  const db = createDatabase();
  try {
    const oid = db.prepare('INSERT INTO organizations (name,contact) VALUES (?,?)')
      .run('Bright Academy', '555-0100').lastInsertRowid;
    const userId = db.prepare('INSERT INTO users (oid,username,password_hash,role) VALUES (?,?,?,?)')
      .run(oid, 'old-admin', 'old-hash', 'admin').lastInsertRowid;
    const hashPassword = (password) => ({ salt: 'test-salt', hash: `hash-${password}` });

    assert.throws(() => recoverExistingAdmin(db, {
      organization: 'Bright Academy',
      contact: '555-9999',
      username: 'new-admin',
      password: 'new-password'
    }, hashPassword), /could not verify/);
    assert.equal(db.prepare('SELECT username FROM users WHERE user_id=?').get(userId).username, 'old-admin');

    const recovered = recoverExistingAdmin(db, {
      organization: ' bright academy ',
      contact: '555-0100',
      username: 'new-admin',
      password: 'new-password'
    }, hashPassword);
    assert.deepEqual(recovered, {
      user_id: userId,
      oid,
      username: 'new-admin',
      organization: 'Bright Academy',
      role: 'admin'
    });
    assert.equal(
      db.prepare('SELECT password_hash FROM users WHERE user_id=?').get(userId).password_hash,
      'test-salt:hash-new-password'
    );
  } finally {
    db.close();
  }
});

test('account recovery still works when no workspace contact was saved', () => {
  const db = createDatabase();
  try {
    const oid = db.prepare('INSERT INTO organizations (name) VALUES (?)')
      .run('Local Academy').lastInsertRowid;
    db.prepare('INSERT INTO users (oid,username,password_hash,role) VALUES (?,?,?,?)')
      .run(oid, 'old-admin', 'old-hash', 'admin');

    const recovered = recoverExistingAdmin(db, {
      organization: 'Local Academy',
      contact: '',
      username: 'new-admin',
      password: 'new-password'
    }, (password) => ({ salt: 'test-salt', hash: `hash-${password}` }));
    assert.equal(recovered.username, 'new-admin');
    assert.equal(recovered.oid, oid);
  } finally {
    db.close();
  }
});

test('schema creates the full tenant-scoped tuition management data model', () => {
  const db = createDatabase();
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of ['organizations', 'users', 'students', 'teachers', 'halls', 'hall_availability', 'classes', 'class_schedules', 'class_enrollments', 'sessions', 'attendance', 'payment_receipts', 'payments', 'teacher_payouts', 'teacher_payout_details', 'backup_logs']) {
      assert.ok(tables.has(table), `missing ${table}`);
    }
    const paymentColumns = new Set(db.pragma('table_info(payments)').map(column => column.name));
    assert.ok(paymentColumns.has('receipt_id'));
    const organizationColumns = new Set(db.pragma('table_info(organizations)').map(column => column.name));
    assert.ok(organizationColumns.has('payment_due_day'));
    assert.ok(organizationColumns.has('image_directory'));
    const studentColumns = new Set(db.pragma('table_info(students)').map(column => column.name));
    assert.ok(studentColumns.has('photo_path'));
    assert.ok(!studentColumns.has('photo_data'));
    const sessionColumns = new Set(db.pragma('table_info(sessions)').map(column => column.name));
    assert.ok(sessionColumns.has('hall_id'));
    assert.ok(sessionColumns.has('is_special'));
    assert.ok(sessionColumns.has('register_opened_at'));
    assert.ok(sessionColumns.has('class_started_at'));
    assert.ok(sessionColumns.has('ended_at'));
    assert.ok(sessionColumns.has('ended_automatically'));
    const attendanceColumns = new Set(db.pragma('table_info(attendance)').map(column => column.name));
    assert.ok(attendanceColumns.has('present_at'));
  } finally {
    db.close();
  }
});

test('opening an existing database migrates session timing and attendance punch fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-schema-migration-'));
  const filePath = path.join(directory, 'legacy.db');
  const legacy = new Database(filePath);
  legacy.exec(`CREATE TABLE sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, session_date, start_time)
  );
  CREATE TABLE organizations (
    oid INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE students (
    stid INTEGER PRIMARY KEY AUTOINCREMENT,
    oid INTEGER NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE classes (
    class_id INTEGER PRIMARY KEY,
    oid INTEGER NOT NULL
  );
  CREATE TABLE class_enrollments (
    enrollment_id INTEGER PRIMARY KEY,
    class_id INTEGER NOT NULL,
    stid INTEGER NOT NULL,
    status TEXT NOT NULL,
    enrolled_date TEXT NOT NULL,
    discount_percentage REAL NOT NULL
  );
  CREATE TABLE attendance (
    attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    stid INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_marked',
    marked_at TEXT
  );
  CREATE TABLE payments (
    payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    for_month TEXT NOT NULL,
    amount_paid REAL NOT NULL,
    payment_date TEXT NOT NULL,
    payment_time TEXT NOT NULL,
    recorded_by INTEGER
  );
  INSERT INTO classes (class_id,oid) VALUES (1,1);
  INSERT INTO class_enrollments (enrollment_id,class_id,stid,status,enrolled_date,discount_percentage)
    VALUES (1,1,1,'active','2026-09-01',0);
  INSERT INTO payments (enrollment_id,for_month,amount_paid,payment_date,payment_time)
    VALUES (1,'2026-09',1000,'2026-09-15','09:30:00');
  CREATE TABLE payment_due_dates (
    due_date_id INTEGER PRIMARY KEY AUTOINCREMENT,
    oid INTEGER NOT NULL REFERENCES organizations(oid),
    for_month TEXT NOT NULL,
    due_date TEXT NOT NULL,
    UNIQUE (oid, for_month)
  );
  INSERT INTO organizations (oid,name) VALUES (1,'Legacy Academy');
  INSERT INTO payment_due_dates (oid,for_month,due_date) VALUES
    (1,strftime('%Y-%m','now'),strftime('%Y-%m','now') || '-15')`);
  legacy.close();
  try {
    const upgraded = openDatabase(filePath);
    try {
      const columns = new Set(upgraded.pragma('table_info(sessions)').map(column => column.name));
      assert.ok(columns.has('hall_id'));
      assert.ok(columns.has('is_special'));
      assert.ok(columns.has('register_opened_at'));
      assert.ok(columns.has('class_started_at'));
      assert.ok(columns.has('ended_at'));
      assert.ok(columns.has('ended_automatically'));
      assert.equal(upgraded.prepare('SELECT payment_due_day FROM organizations WHERE oid=1').get().payment_due_day, 15);
      assert.ok(new Set(upgraded.pragma('table_info(students)').map(column => column.name)).has('photo_path'));
      assert.ok(new Set(upgraded.pragma('table_info(organizations)').map(column => column.name)).has('image_directory'));
      assert.ok(new Set(upgraded.pragma('table_info(attendance)').map(column => column.name)).has('present_at'));
      assert.ok(new Set(upgraded.pragma('table_info(payments)').map(column => column.name)).has('receipt_id'));
      assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payment_receipts'").get());
      assert.equal(upgraded.prepare('SELECT receipt_id FROM payments WHERE payment_id=1').get().receipt_id, 1);
      assert.equal(upgraded.prepare('SELECT receipt_code FROM payment_receipts WHERE receipt_id=1').get().receipt_code, '00000001');
    } finally {
      upgraded.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy student photos migrate out of SQLite and change folders without losing files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcms-student-images-'));
  const db = createDatabase();
  const pngData = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
  try {
    const oldDirectory = path.join(directory, 'old-photos');
    const newDirectory = path.join(directory, 'new-photos');
    fs.mkdirSync(oldDirectory);
    db.exec('ALTER TABLE students ADD COLUMN photo_data TEXT');
    const oid = db.prepare('INSERT INTO organizations (name,image_directory) VALUES (?,?)').run('Photo Academy', oldDirectory).lastInsertRowid;
    const stid = db.prepare('INSERT INTO students (oid,name,contact1,photo_data) VALUES (?,?,?,?)')
      .run(oid, 'Taylor Student', '555-0100', pngData).lastInsertRowid;

    migrateLegacyStudentPhotos(db, path.join(directory, 'default-photos'));

    const migrated = db.prepare('SELECT photo_path FROM students WHERE stid=?').get(stid);
    assert.equal(readStudentImage(migrated.photo_path), pngData);
    assert.ok(!new Set(db.pragma('table_info(students)').map(column => column.name)).has('photo_data'));
    assert.equal(db.prepare('SELECT image_directory FROM organizations WHERE oid=?').get(oid).image_directory, oldDirectory);

    const relocated = changeImageDirectory(db, oid, newDirectory);
    assert.equal(relocated, newDirectory);
    const moved = db.prepare('SELECT photo_path FROM students WHERE stid=?').get(stid);
    assert.equal(path.dirname(moved.photo_path), newDirectory);
    assert.equal(readStudentImage(moved.photo_path), pngData);
    assert.equal(fs.existsSync(migrated.photo_path), false);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('hall availability must cover a class timeslot and reject overlapping bookings', () => {
  const availability = [
    { day_of_week: 'monday', start_time: '09:00', end_time: '12:00' },
    { day_of_week: 'wednesday', start_time: '13:00', end_time: '16:00' }
  ];
  assert.equal(slotIsAvailable({ day_of_week: 'monday', start_time: '10:00', end_time: '11:00' }, availability), true);
  assert.equal(slotIsAvailable({ day_of_week: 'monday', start_time: '11:30', end_time: '12:30' }, availability), false);
  assert.equal(slotIsAvailable({ day_of_week: 'tuesday', start_time: '10:00', end_time: '11:00' }, availability), false);
  assert.equal(overlaps('09:00', '10:30', '10:00', '11:00'), true);
  assert.equal(overlaps('09:00', '10:00', '10:00', '11:00'), false);
  assert.throws(() => validateSlots([
    { day_of_week: 'friday', start_time: '09:00', end_time: '10:00' },
    { day_of_week: 'friday', start_time: '09:30', end_time: '11:00' }
  ], 'Hall availability'), /overlapping times/);
});

test('editing a hall cannot remove an assigned class time from its availability', () => {
  const db = createDatabase();
  try {
    const { organization, classId } = seed(db);
    const hallId = db.prepare('INSERT INTO halls (oid,name) VALUES (?,?)').run(organization, 'Room A').lastInsertRowid;
    db.prepare('INSERT INTO classes (class_id,oid,class_name,tid,fee,hall_id) VALUES (?,?,?,?,?,?)')
      .run(classId + 1, organization, 'Science', db.prepare('SELECT tid FROM classes WHERE class_id=?').get(classId).tid, 1000, hallId);
    db.prepare('INSERT INTO class_schedules (class_id,day_of_week,start_time,end_time) VALUES (?,?,?,?)')
      .run(classId + 1, 'monday', '10:00', '11:00');
    const assignedTimes = db.prepare(`SELECT s.day_of_week,s.start_time,s.end_time
      FROM classes c JOIN class_schedules s ON s.class_id=c.class_id WHERE c.hall_id=?`).all(hallId);
    assert.equal(assignedTimes.length, 1);
    assert.equal(slotIsAvailable(assignedTimes[0], [{ day_of_week: 'monday', start_time: '09:00', end_time: '11:00' }]), true);
    assert.equal(slotIsAvailable(assignedTimes[0], [{ day_of_week: 'monday', start_time: '09:00', end_time: '10:30' }]), false);
  } finally {
    db.close();
  }
});

test('enrolments upsert discounts and monthly payments use the discounted fee only once', () => {
  const db = createDatabase();
  try {
    const { organization, classId, student } = seed(db);
    const upsert = db.prepare(`INSERT INTO class_enrollments (class_id,stid,discount_percentage)
      SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM students WHERE stid=? AND oid=?)
      ON CONFLICT(class_id,stid) DO UPDATE SET discount_percentage=excluded.discount_percentage,status='active'`);
    upsert.run(classId, student, 50, student, organization);
    const enrollment = db.prepare('SELECT enrollment_id,discount_percentage FROM class_enrollments WHERE class_id=? AND stid=?').get(classId, student);
    assert.equal(enrollment.discount_percentage, 50);

    const amount = db.prepare('SELECT ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS due FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id WHERE e.enrollment_id=?').get(enrollment.enrollment_id).due;
    assert.equal(amount, 500);
    const addPayment = db.prepare('INSERT INTO payments (enrollment_id,for_month,amount_paid,payment_date,payment_time) VALUES (?,?,?,?,?)');
    addPayment.run(enrollment.enrollment_id, '2026-09', amount, '2026-09-01', '09:30:00');
    assert.throws(() => addPayment.run(enrollment.enrollment_id, '2026-09', amount, '2026-09-02', '10:00:00'), /UNIQUE constraint failed/);
    assert.equal(db.prepare('SELECT SUM(amount_paid) AS total FROM payments WHERE for_month=?').get('2026-09').total, 500);
  } finally {
    db.close();
  }
});

test('payment batches receive one unique 8-digit receipt and roll back atomically', () => {
  const db = createDatabase();
  try {
    const { organization, enrollment, classId } = seed(db);
    const first = recordPaymentReceipt(db, organization, [
      { enrollment_id: enrollment, for_month: '2026-08', amount: 500 },
      { enrollment_id: enrollment, for_month: '2026-09', amount: 500 }
    ], { date: '2026-10-02', time: '09:30:00', userId: null });
    assert.equal(first.receipt_code, '00000001');
    assert.equal(first.receipt_code.length, 8);
    assert.deepEqual(db.prepare('SELECT DISTINCT receipt_id,payment_date,payment_time FROM payments').all(), [{
      receipt_id: first.receipt_id,
      payment_date: '2026-10-02',
      payment_time: '09:30:00'
    }]);
    const secondStudent = db.prepare('INSERT INTO students (oid,name,contact1) VALUES (?,?,?)')
      .run(organization, 'Second Student', '555-0101').lastInsertRowid;
    const secondEnrollment = db.prepare('INSERT INTO class_enrollments (class_id,stid) VALUES (?,?)')
      .run(classId, secondStudent).lastInsertRowid;
    assert.throws(() => recordPaymentReceipt(db, organization, [
      { enrollment_id: secondEnrollment, for_month: '2026-10', amount: 1000 },
      { enrollment_id: enrollment, for_month: '2026-08', amount: 500 }
    ], { date: '2026-10-02', time: '09:31:00', userId: null }), /UNIQUE constraint failed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payment_receipts').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payments').get().count, 2);
    const recent = listRecentPaymentReceipts(db, organization);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].receipt_code, first.receipt_code);
    assert.equal(recent[0].class_count, 2);
    assert.equal(recent[0].total, 1000);
    assert.equal(recent[0].student_names, 'Jamie Student');
    let latestReceipt;
    for (let index = 0; index < 5; index += 1) {
      latestReceipt = recordPaymentReceipt(db, organization, [{
        enrollment_id: enrollment,
        for_month: `2026-${String(index + 1).padStart(2, '0')}`,
        amount: 500
      }], {
        date: `2026-10-${String(index + 3).padStart(2, '0')}`,
        time: '10:00:00',
        userId: null
      });
    }
    const latestFour = listRecentPaymentReceipts(db, organization);
    assert.equal(latestFour.length, 4);
    assert.equal(latestFour[0].receipt_code, latestReceipt.receipt_code);
    assert.equal(latestFour[0].total, 500);
  } finally {
    db.close();
  }
});

test('payment receipt report includes the receipt number, line items, and total safely', () => {
  const barcode = buildCode39Svg('00000042');
  assert.match(barcode, /<svg/);
  assert.match(barcode, /<rect/);
  assert.match(barcode, /aria-label="Code 39 barcode for receipt 00000042"/);
  const html = buildPaymentReceiptHtml({
    organization: 'Bright <Academy>',
    receipt: { receipt_code: '00000042', payment_date: '2026-10-02', payment_time: '09:30:00' },
    rows: [{
      student_name: 'Jamie & Morgan',
      class_name: 'Maths <A>',
      for_month: '2026-09',
      amount_paid: 500
    }],
    total: 500
  });
  assert.match(html, /00000042/);
  assert.match(html, /class="receipt-barcode"/);
  assert.doesNotMatch(html, /Receipt \/ barcode number/);
  assert.match(html, /height:9mm/);
  assert.match(html, /Jamie &amp; Morgan/);
  assert.match(html, /Maths &lt;A&gt;/);
  assert.match(html, /Total paid/);
  assert.match(html, />500\.00</);
});

test('tenant-scoped lookups cannot select another organization’s student', () => {
  const db = createDatabase();
  try {
    const first = seed(db);
    const otherOrg = db.prepare('INSERT INTO organizations (name) VALUES (?)').run('Other Academy').lastInsertRowid;
    const otherStudent = db.prepare('INSERT INTO students (oid,name,contact1,rfid) VALUES (?,?,?,?)').run(otherOrg, 'Private Student', '555-0101', 'CARD-1').lastInsertRowid;
    assert.equal(db.prepare('SELECT stid FROM students WHERE rfid=? AND oid=?').get('CARD-1', first.organization), undefined);
    assert.equal(db.prepare('SELECT stid FROM students WHERE rfid=? AND oid=?').get('CARD-1', otherOrg).stid, otherStudent);
    assert.throws(() => db.prepare('UPDATE students SET rfid=? WHERE stid=?').run('CARD-1', first.student), /UNIQUE constraint failed/);
  } finally {
    db.close();
  }
});

test('sessions generate attendance rows and preserve absent/present register states', () => {
  const db = createDatabase();
  try {
    const { classId, student } = seed(db);
    const sessionId = db.prepare('INSERT INTO sessions (class_id,session_date,start_time) VALUES (?,?,?)').run(classId, '2026-09-26', '09:00').lastInsertRowid;
    db.prepare('INSERT INTO attendance (session_id,stid) VALUES (?,?)').run(sessionId, student);
    db.prepare("UPDATE attendance SET status='present' WHERE session_id=? AND stid=?").run(sessionId, student);
    assert.equal(db.prepare('SELECT status FROM attendance WHERE session_id=? AND stid=?').get(sessionId, student).status, 'present');
    assert.throws(() => db.prepare('INSERT INTO attendance (session_id,stid) VALUES (?,?)').run(sessionId, student), /UNIQUE constraint failed/);
  } finally {
    db.close();
  }
});

test('expired ongoing sessions are completed and unmarked attendance becomes absent', () => {
  const db = createDatabase();
  try {
    const { classId, student } = seed(db);
    const expiredSession = db.prepare(`INSERT INTO sessions (class_id,session_date,status)
      VALUES (?,?,'ongoing')`).run(classId, '2026-09-30').lastInsertRowid;
    const todaySession = db.prepare(`INSERT INTO sessions (class_id,session_date,status)
      VALUES (?,?,'ongoing')`).run(classId, '2026-10-01').lastInsertRowid;
    const alreadyEndedSession = db.prepare(`INSERT INTO sessions (class_id,session_date,status)
      VALUES (?,?,'completed')`).run(classId, '2026-09-29').lastInsertRowid;
    const addAttendance = db.prepare('INSERT INTO attendance (session_id,stid,status) VALUES (?,?,?)');
    addAttendance.run(expiredSession, student, 'not_marked');
    addAttendance.run(todaySession, student, 'not_marked');
    addAttendance.run(alreadyEndedSession, student, 'not_marked');

    assert.equal(endExpiredSessions(db, '2026-10-01'), 1);
    assert.deepEqual(db.prepare('SELECT status,ended_automatically FROM sessions WHERE session_id=?').get(expiredSession), {
      status: 'completed',
      ended_automatically: 1
    });
    assert.equal(db.prepare('SELECT status FROM attendance WHERE session_id=?').get(expiredSession).status, 'absent');
    assert.equal(db.prepare('SELECT status FROM sessions WHERE session_id=?').get(todaySession).status, 'ongoing');
    assert.equal(db.prepare('SELECT status FROM attendance WHERE session_id=?').get(todaySession).status, 'not_marked');
    assert.equal(db.prepare('SELECT status FROM attendance WHERE session_id=?').get(alreadyEndedSession).status, 'not_marked');
    assert.equal(completeOngoingSession(db, todaySession), true);
    assert.equal(db.prepare('SELECT ended_automatically FROM sessions WHERE session_id=?').get(todaySession).ended_automatically, 0);
    assert.equal(db.prepare('SELECT status FROM attendance WHERE session_id=?').get(todaySession).status, 'absent');
  } finally {
    db.close();
  }
});

test('session report filters by date range and teacher with present and enrollment counts', () => {
  const db = createDatabase();
  try {
    const first = seed(db);
    const otherTeacher = db.prepare('INSERT INTO teachers (oid,name) VALUES (?,?)')
      .run(first.organization, 'Taylor Teacher').lastInsertRowid;
    const otherClass = db.prepare(`INSERT INTO classes
      (oid,class_name,tid,fee,teacher_commission_percentage) VALUES (?,?,?,?,?)`)
      .run(first.organization, 'Science', otherTeacher, 1000, 80).lastInsertRowid;
    const secondStudent = db.prepare('INSERT INTO students (oid,name,contact1) VALUES (?,?,?)')
      .run(first.organization, 'Morgan Student', '555-0102').lastInsertRowid;
    db.prepare('INSERT INTO class_enrollments (class_id,stid) VALUES (?,?)').run(first.classId, secondStudent);
    db.prepare('INSERT INTO class_enrollments (class_id,stid) VALUES (?,?)').run(otherClass, secondStudent);
    db.prepare("UPDATE class_enrollments SET enrolled_date='2026-09-01' WHERE class_id IN (?,?)")
      .run(first.classId, otherClass);
    const firstSession = db.prepare(`INSERT INTO sessions (class_id,session_date,start_time,end_time,status)
      VALUES (?,?,'09:00','10:00','completed')`).run(first.classId, '2026-09-30').lastInsertRowid;
    const secondSession = db.prepare(`INSERT INTO sessions (class_id,session_date,start_time,end_time,status)
      VALUES (?,?,'11:00','12:00','completed')`).run(otherClass, '2026-10-01').lastInsertRowid;
    db.prepare("INSERT INTO attendance (session_id,stid,status) VALUES (?,?,'present')").run(firstSession, first.student);
    db.prepare("INSERT INTO attendance (session_id,stid,status) VALUES (?,?,'present')").run(secondSession, secondStudent);
    const queryReport = (teacherId) => db.prepare(`SELECT se.session_id,se.session_date,c.class_name,t.tid,t.name AS teacher_name,
        (SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id=c.class_id AND e.status='active'
          AND substr(e.enrolled_date,1,10)<=se.session_date) AS enrolled_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id=se.session_id AND a.status='present') AS present_count
      FROM sessions se JOIN classes c ON c.class_id=se.class_id JOIN teachers t ON t.tid=c.tid
      WHERE c.oid=? AND se.session_date BETWEEN ? AND ? AND se.status!='cancelled'
      ${teacherId ? 'AND t.tid=?' : ''} ORDER BY se.session_date DESC,se.start_time`)
      .all(...(teacherId
        ? [first.organization, '2026-09-30', '2026-10-01', teacherId]
        : [first.organization, '2026-09-30', '2026-10-01']));
    const allSessions = queryReport();
    assert.equal(allSessions.length, 2);
    const laterSession = allSessions.find((row) => row.session_id === secondSession);
    assert.equal(laterSession.present_count, 1);
    assert.equal(laterSession.enrolled_count, 1);
    const teacherSessions = queryReport(first.teacher);
    assert.equal(teacherSessions.length, 1);
    assert.equal(teacherSessions[0].session_id, firstSession);
  } finally {
    db.close();
  }
});

test('full-discount enrollments are free and do not accrue pending tuition', () => {
  const db = createDatabase();
  try {
    const { organization, classId, student, enrollment } = seed(db);
    db.prepare('UPDATE class_enrollments SET discount_percentage=100 WHERE enrollment_id=?').run(enrollment);
    const row = db.prepare(`SELECT e.discount_percentage,
        ROUND(c.fee*(1-e.discount_percentage/100.0),2) AS due_amount,
        CASE WHEN e.discount_percentage>=100 THEN 1 ELSE 0 END AS free_access
      FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id
      WHERE e.enrollment_id=?`).get(enrollment);
    assert.equal(row.due_amount, 0);
    assert.equal(row.free_access, 1);
    const pending = db.prepare(`SELECT COUNT(*) AS count FROM class_enrollments e
      JOIN classes c ON c.class_id=e.class_id
      LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
      WHERE c.oid=? AND e.stid=? AND e.discount_percentage<100 AND p.payment_id IS NULL`)
      .get('2026-10', organization, student);
    assert.equal(pending.count, 0);
  } finally {
    db.close();
  }
});

test('low attendance counts absences in the two most recent eligible completed sessions', () => {
  const db = createDatabase();
  try {
    const { classId, student, enrollment } = seed(db);
    db.prepare('UPDATE class_enrollments SET enrolled_date=? WHERE enrollment_id=?').run('2026-01-01', enrollment);
    const addSession = db.prepare(`INSERT INTO sessions (class_id,session_date,start_time,status)
      VALUES (?,?,'09:00','completed')`);
    const past = [
      addSession.run(classId, '2026-09-01').lastInsertRowid,
      addSession.run(classId, '2026-09-08').lastInsertRowid,
      addSession.run(classId, '2026-09-15').lastInsertRowid
    ];
    const current = db.prepare(`INSERT INTO sessions (class_id,session_date,start_time,status)
      VALUES (?,?,'09:00','ongoing')`).run(classId, '2026-09-22').lastInsertRowid;
    const mark = db.prepare('INSERT INTO attendance (session_id,stid,status) VALUES (?,?,?)');
    mark.run(past[0], student, 'present');
    mark.run(past[1], student, 'absent');
    mark.run(past[2], student, 'absent');
    mark.run(current, student, 'not_marked');
    const recentAbsences = (sessionId) => db.prepare(`SELECT
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
      LIMIT 2) recent_sessions WHERE recent_sessions.status!='present') AS recent_absence_count
      FROM attendance a JOIN sessions se ON se.session_id=a.session_id
      WHERE a.session_id=? AND a.stid=?`).get(sessionId, student).recent_absence_count;
    assert.equal(recentAbsences(current), 2);
    db.prepare("UPDATE attendance SET status='present' WHERE session_id=? AND stid=?").run(past[2], student);
    assert.equal(recentAbsences(current), 1);
  } finally {
    db.close();
  }
});

test('attendance records student punch time and computes lateness from class start', () => {
  const db = createDatabase();
  try {
    const { classId, student } = seed(db);
    const sessionId = db.prepare(`INSERT INTO sessions (class_id,session_date,status,class_started_at)
      VALUES (?,?,'ongoing',?)`).run(classId, '2026-09-26', '2026-09-26 09:00:00').lastInsertRowid;
    db.prepare(`INSERT INTO attendance (session_id,stid,status,present_at)
      VALUES (?,?,'present',?)`).run(sessionId, student, '2026-09-26 09:13:30');
    const arrival = db.prepare(`SELECT present_at,
      MAX(0,CAST((julianday(a.present_at)-julianday(s.class_started_at))*1440 AS INTEGER)) AS late_minutes
      FROM attendance a JOIN sessions s ON s.session_id=a.session_id WHERE a.session_id=? AND a.stid=?`)
      .get(sessionId, student);
    assert.equal(arrival.present_at, '2026-09-26 09:13:30');
    assert.equal(arrival.late_minutes, 13);
  } finally {
    db.close();
  }
});

test('attendance PDF report includes session details, roster counts and escaped attendance lists', () => {
  const html = buildAttendanceReportHtml({
    organization: 'Bright & Best <Academy>',
    session: {
      class_name: 'Grade 6 Maths',
      teacher_name: 'Alex Teacher',
      session_date: '2026-09-15',
      start_time: '17:00',
      end_time: '19:00',
      register_opened_at: '2026-09-15 11:50:00',
      class_started_at: '2026-09-15 12:00:00',
      ended_at: '2026-09-15 13:00:00'
    },
    students: [
      { name: 'Jamie Present', status: 'present', present_at: '2026-09-15 12:12:00', late_minutes: 12 },
      { name: 'Taylor Absent', status: 'absent', marked_at: '2026-09-15 13:00:00' },
      { name: '<Unmarked Student>', status: 'not_marked' }
    ],
    generatedOn: '2026-09-30'
  });
  assert.match(html, /Bright &amp; Best &lt;Academy&gt;/);
  assert.match(html, /Grade 6 Maths/);
  assert.match(html, /Alex Teacher/);
  assert.match(html, /Enrolled students<\/span><\/div>/);
  assert.match(html, /<b>3<\/b>/);
  assert.match(html, /Present \(1\)/);
  assert.match(html, /Jamie Present/);
  assert.match(html, /Absent \(1\)/);
  assert.match(html, /Taylor Absent/);
  assert.match(html, /12 minutes late/);
  assert.match(html, /li\.late-arrival,li\.late-arrival small\{color:#b42318!important/);
  assert.match(html, /<li class="late-arrival">Jamie Present<small>Arrived .* · 12 minutes late<\/small><\/li>/);
  assert.match(html, /Arrived late/);
  assert.match(html, /Register opened/);
  assert.match(html, /Class started/);
  assert.match(html, /Session ended/);
  assert.match(html, /Marked absent/);
  assert.match(html, /&lt;Unmarked Student&gt;/);
  assert.match(html, /Not marked \(1\)/);
});

test('daily summary PDF includes financial, student and session totals with colored report styling', () => {
  const html = buildDailySummaryReportHtml({
    organization: 'Bright & Best <Academy>',
    date: '2026-09-30',
    activeStudentCount: 24,
    totalReceived: 12500,
    totalTeacherPayouts: 4500,
    classPayments: [
      { class_name: 'Grade 6 Maths', teacher_name: 'Alex Teacher', student_count: 5, amount_received: 7500 }
    ],
    teacherPayouts: [{ teacher_name: 'Alex Teacher', amount: 4500 }],
    sessions: [{
      class_name: 'Grade 6 Maths',
      teacher_name: 'Alex Teacher',
      start_time: '17:00',
      end_time: '19:00',
      enrolled_count: 8,
      present_count: 6,
      absent_count: 1,
      not_marked_count: 1,
      status: 'ongoing'
    }],
    generatedOn: '2026-09-30'
  });
  assert.match(html, /Bright &amp; Best &lt;Academy&gt;/);
  assert.match(html, /Daily Summary Report/);
  assert.match(html, /12,500\.00/);
  assert.match(html, /4,500\.00/);
  assert.match(html, /Students enrolled in sessions/);
  assert.match(html, /Present \/ absent/);
  assert.match(html, /Grade 6 Maths/);
  assert.match(html, /Alex Teacher/);
  assert.match(html, /Class payments received/);
  assert.match(html, /Teacher payouts/);
  assert.match(html, /Sessions and attendance/);
  assert.match(html, /print-color-adjust:exact/);
});

test('class payment PDF has class and teacher headers, 12 month columns, and ruled student rows', () => {
  const html = buildClassPaymentReportHtml({
    organization: 'Bright & Best <Academy>',
    year: '2026',
    classes: [{
      class_name: 'Grade 6 Maths',
      teacher_name: 'Alex Teacher',
      students: [{ name: 'Jamie Student' }, { name: 'Taylor Student' }]
    }],
    generatedOn: '2026-10-01'
  });
  assert.match(html, /A4 portrait/);
  assert.match(html, /height:7mm/);
  assert.match(html, /Class:<\/b> Grade 6 Maths/);
  assert.match(html, /Teacher:<\/b> Alex Teacher/);
  assert.match(html, /Student name/);
  for (const month of ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']) {
    assert.match(html, new RegExp(`<th>${month}<\\/th>`));
  }
  assert.match(html, /<tr><th scope="row">Jamie Student<\/th><td><\/td>/);
  assert.match(html, /<tr><th scope="row">Taylor Student<\/th><td><\/td>/);
  assert.match(html, /border:1px solid #697386/);
  assert.match(html, /Bright &amp; Best &lt;Academy&gt;/);
});

test('monthly due day repeats, clamps to month end, and warns only after it passes unpaid', () => {
  assert.equal(dueDateForMonth('2026-09', 10), '2026-09-10');
  assert.equal(dueDateForMonth('2026-02', 31), '2026-02-28');
  assert.equal(dueDateForMonth('2028-02', 31), '2028-02-29');
  assert.throws(() => dueDateForMonth('2026-09', 0), /between 1 and 31/);
  assert.throws(() => dueDateForMonth('2026-09', 32), /between 1 and 31/);
  assert.deepEqual(overduePaymentMonths('2026-09-01', [], 10, '2026-09-09'), []);
  assert.deepEqual(overduePaymentMonths('2026-09-01', [], 10, '2026-09-10'), [
    { month: '2026-09', due_date: '2026-09-10' }
  ]);
  assert.deepEqual(
    overduePaymentMonths('2026-01-01', ['2026-09'], 31, '2026-10-31'),
    [
      { month: '2026-01', due_date: '2026-01-31' },
      { month: '2026-02', due_date: '2026-02-28' },
      { month: '2026-03', due_date: '2026-03-31' },
      { month: '2026-04', due_date: '2026-04-30' },
      { month: '2026-05', due_date: '2026-05-31' },
      { month: '2026-06', due_date: '2026-06-30' },
      { month: '2026-07', due_date: '2026-07-31' },
      { month: '2026-08', due_date: '2026-08-31' },
      { month: '2026-10', due_date: '2026-10-31' }
    ]
  );
});

test('special sessions persist as one-time records with optional hall assignments', () => {
  const db = createDatabase();
  try {
    const { organization, classId } = seed(db);
    const hallId = db.prepare('INSERT INTO halls (oid,name) VALUES (?,?)').run(organization, 'Room A').lastInsertRowid;
    const addSession = db.prepare(`INSERT INTO sessions
      (class_id,session_date,start_time,end_time,hall_id,is_special) VALUES (?,?,?,?,?,1)`);
    addSession.run(classId, '2026-09-15', '17:00', '19:00', hallId);
    addSession.run(classId, '2026-09-20', '18:00', '20:00', null);
    const sessions = db.prepare('SELECT session_date,start_time,end_time,hall_id,is_special FROM sessions ORDER BY session_date').all();
    assert.deepEqual(sessions, [
      { session_date: '2026-09-15', start_time: '17:00', end_time: '19:00', hall_id: hallId, is_special: 1 },
      { session_date: '2026-09-20', start_time: '18:00', end_time: '20:00', hall_id: null, is_special: 1 }
    ]);
  } finally {
    db.close();
  }
});

test('teacher balances include current-month payouts separately from lifetime payouts', () => {
  const db = createDatabase();
  try {
    const { organization, teacher } = seed(db);
    db.prepare('INSERT INTO teacher_payouts (tid,amount,payout_date) VALUES (?,?,?)')
      .run(teacher, 250, '2026-10-01');
    db.prepare('INSERT INTO teacher_payouts (tid,amount,payout_date) VALUES (?,?,?)')
      .run(teacher, 100, '2026-09-30');
    const balance = db.prepare(`SELECT
      COALESCE((SELECT SUM(p.amount) FROM teacher_payouts p WHERE p.tid=t.tid),0) AS paid_out,
      COALESCE((SELECT SUM(p.amount) FROM teacher_payouts p
        WHERE p.tid=t.tid AND substr(p.payout_date,1,7)=?),0) AS paid_out_this_month
      FROM teachers t WHERE t.oid=? AND t.tid=?`)
      .get('2026-10', organization, teacher);
    assert.equal(balance.paid_out, 350);
    assert.equal(balance.paid_out_this_month, 250);
  } finally {
    db.close();
  }
});

test('monthly earnings split collected and discounted outstanding fees correctly', () => {
  const db = createDatabase();
  try {
    const { organization, classId, student, enrollment, teacher } = seed(db);
    const secondStudent = db.prepare('INSERT INTO students (oid,name,contact1) VALUES (?,?,?)').run(organization, 'Taylor Student', '555-0102').lastInsertRowid;
    const secondEnrollment = db.prepare('INSERT INTO class_enrollments (class_id,stid,discount_percentage) VALUES (?,?,?)').run(classId, secondStudent, 0).lastInsertRowid;
    db.prepare('INSERT INTO payments (enrollment_id,for_month,amount_paid,payment_date,payment_time) VALUES (?,?,?,?,?)').run(enrollment, '2026-09', 500, '2026-09-01', '09:00:00');

    const result = db.prepare(`SELECT c.class_id,t.tid,COUNT(e.enrollment_id) AS enrolled_count,
      SUM(CASE WHEN p.payment_id IS NOT NULL THEN 1 ELSE 0 END) AS paid_students,
      SUM(CASE WHEN p.payment_id IS NULL THEN 1 ELSE 0 END) AS not_paid_students,
      COALESCE(SUM(p.amount_paid),0) AS collected,
      COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN c.fee*(1-e.discount_percentage/100.0) ELSE 0 END),0) AS pending,
      COALESCE(SUM(p.amount_paid)*c.teacher_commission_percentage/100.0,0) AS teacher_earnings,
      COALESCE(SUM(p.amount_paid)*(100-c.teacher_commission_percentage)/100.0,0) AS org_earnings,
      COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN c.fee*(1-e.discount_percentage/100.0) ELSE 0 END)*c.teacher_commission_percentage/100.0,0) AS pending_teacher,
      COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN c.fee*(1-e.discount_percentage/100.0) ELSE 0 END)*(100-c.teacher_commission_percentage)/100.0,0) AS pending_org
      FROM classes c JOIN teachers t ON t.tid=c.tid
      LEFT JOIN class_enrollments e ON e.class_id=c.class_id AND e.status='active'
      LEFT JOIN payments p ON p.enrollment_id=e.enrollment_id AND p.for_month=?
      WHERE c.class_id=? AND c.oid=? GROUP BY c.class_id`).get('2026-09', classId, organization);

    assert.equal(result.tid, teacher);
    assert.equal(result.enrolled_count, 2);
    assert.equal(result.paid_students, 1);
    assert.equal(result.not_paid_students, 1);
    assert.equal(result.collected, 500);
    assert.equal(result.pending, 1000);
    assert.equal(result.teacher_earnings, 400);
    assert.equal(result.org_earnings, 100);
    assert.equal(result.pending_teacher, 800);
    assert.equal(result.pending_org, 200);
    assert.equal(db.prepare('SELECT enrollment_id FROM class_enrollments WHERE enrollment_id=?').get(secondEnrollment).enrollment_id, secondEnrollment);
  } finally {
    db.close();
  }
});

test('per-student discount editing updates payable tuition and both commission shares', () => {
  const db = createDatabase();
  try {
    const { organization, enrollment } = seed(db);
    const update = db.prepare(`UPDATE class_enrollments SET discount_percentage=?
      WHERE enrollment_id=? AND class_id IN (SELECT class_id FROM classes WHERE oid=?)`);
    assert.equal(update.run(50, enrollment, organization).changes, 1);
    const result = db.prepare(`SELECT c.fee*(1-e.discount_percentage/100.0) AS payable,
      c.fee*(1-e.discount_percentage/100.0)*c.teacher_commission_percentage/100.0 AS teacher_share,
      c.fee*(1-e.discount_percentage/100.0)*(100-c.teacher_commission_percentage)/100.0 AS organization_share
      FROM class_enrollments e JOIN classes c ON c.class_id=e.class_id WHERE e.enrollment_id=?`).get(enrollment);
    assert.deepEqual(result, { payable: 500, teacher_share: 400, organization_share: 100 });
  } finally {
    db.close();
  }
});
