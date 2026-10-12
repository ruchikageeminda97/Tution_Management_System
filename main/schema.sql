PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  oid INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  payment_due_day INTEGER CHECK (payment_due_day BETWEEN 1 AND 31),
  image_directory TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER NOT NULL REFERENCES organizations(oid) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','staff')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS students (
  stid INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER NOT NULL REFERENCES organizations(oid) ON DELETE CASCADE,
  rfid TEXT UNIQUE,
  name TEXT NOT NULL,
  school TEXT,
  contact1 TEXT NOT NULL,
  contact2 TEXT,
  birthday TEXT,
  address TEXT,
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS teachers (
  tid INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER NOT NULL REFERENCES organizations(oid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact TEXT,
  address TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS halls (
  hall_id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER NOT NULL REFERENCES organizations(oid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER
);
CREATE TABLE IF NOT EXISTS hall_availability (
  availability_id INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id INTEGER NOT NULL REFERENCES halls(hall_id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  CHECK (start_time < end_time)
);
CREATE TABLE IF NOT EXISTS classes (
  class_id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER NOT NULL REFERENCES organizations(oid) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  tid INTEGER NOT NULL REFERENCES teachers(tid),
  subject TEXT,
  fee REAL NOT NULL CHECK (fee >= 0),
  teacher_commission_percentage REAL NOT NULL DEFAULT 0 CHECK (teacher_commission_percentage BETWEEN 0 AND 100),
  hall_id INTEGER REFERENCES halls(hall_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS class_schedules (
  schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS class_enrollments (
  enrollment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  stid INTEGER NOT NULL REFERENCES students(stid) ON DELETE CASCADE,
  discount_percentage REAL NOT NULL DEFAULT 0 CHECK (discount_percentage BETWEEN 0 AND 100),
  enrolled_date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dropped')),
  UNIQUE (class_id, stid)
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  hall_id INTEGER REFERENCES halls(hall_id),
  is_special INTEGER NOT NULL DEFAULT 0 CHECK (is_special IN (0,1)),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','ongoing','completed','cancelled')),
  register_opened_at TEXT,
  class_started_at TEXT,
  ended_at TEXT,
  ended_automatically INTEGER NOT NULL DEFAULT 0 CHECK (ended_automatically IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (class_id, session_date, start_time)
);
CREATE TABLE IF NOT EXISTS attendance (
  attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  stid INTEGER NOT NULL REFERENCES students(stid) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_marked' CHECK (status IN ('present','absent','not_marked')),
  marked_at TEXT,
  present_at TEXT,
  UNIQUE (session_id, stid)
);
CREATE TABLE IF NOT EXISTS payment_receipts (
  receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER NOT NULL REFERENCES organizations(oid) ON DELETE CASCADE,
  receipt_code TEXT UNIQUE CHECK (receipt_code IS NULL OR length(receipt_code) = 8),
  payment_date TEXT NOT NULL,
  payment_time TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(user_id)
);
CREATE TABLE IF NOT EXISTS payments (
  payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES class_enrollments(enrollment_id),
  receipt_id INTEGER REFERENCES payment_receipts(receipt_id),
  for_month TEXT NOT NULL,
  amount_paid REAL NOT NULL CHECK (amount_paid >= 0),
  payment_date TEXT NOT NULL,
  payment_time TEXT NOT NULL,
  session_id INTEGER REFERENCES sessions(session_id),
  recorded_by INTEGER REFERENCES users(user_id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enrollment_id, for_month)
);
CREATE TABLE IF NOT EXISTS teacher_payouts (
  payout_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tid INTEGER NOT NULL REFERENCES teachers(tid),
  amount REAL NOT NULL CHECK (amount > 0),
  payout_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS teacher_payout_details (
  detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_id INTEGER NOT NULL REFERENCES teacher_payouts(payout_id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(class_id),
  amount_for_class REAL NOT NULL CHECK (amount_for_class >= 0),
  for_month TEXT
);
CREATE TABLE IF NOT EXISTS backup_logs (
  backup_id INTEGER PRIMARY KEY AUTOINCREMENT,
  oid INTEGER REFERENCES organizations(oid),
  backup_type TEXT NOT NULL,
  file_path TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS backup_settings (
  oid INTEGER PRIMARY KEY REFERENCES organizations(oid) ON DELETE CASCADE,
  google_client_id TEXT NOT NULL DEFAULT '',
  auto_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_enabled IN (0,1)),
  backup_time TEXT NOT NULL DEFAULT '15:00',
  retention TEXT NOT NULL DEFAULT '30' CHECK (retention IN ('7','30','all')),
  missed_recovery INTEGER NOT NULL DEFAULT 1 CHECK (missed_recovery IN (0,1)),
  last_scheduled_date TEXT,
  retry_after TEXT,
  last_status TEXT,
  last_error TEXT,
  last_backup_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_students_oid_name ON students(oid, name);
CREATE INDEX IF NOT EXISTS idx_classes_oid ON classes(oid);
CREATE INDEX IF NOT EXISTS idx_sessions_class_date ON sessions(class_id, session_date);
CREATE INDEX IF NOT EXISTS idx_payments_month ON payments(for_month);
