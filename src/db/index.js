const Database = require('better-sqlite3');
const path = require('path');

const dbFile = path.join(__dirname, 'yoklama.db');
const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lectures (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  lecture_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  UNIQUE(lecture_id, student_id),
  FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  lecture_id INTEGER NOT NULL,
  week INTEGER NOT NULL CHECK(week BETWEEN 1 AND 14),
  code TEXT NOT NULL UNIQUE, -- short code to embed in QR
  created_at TEXT NOT NULL,
  expires_at TEXT, -- nullable; optional expiration
  UNIQUE(lecture_id, week),
  FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  present INTEGER NOT NULL DEFAULT 1,
  recorded_at TEXT NOT NULL,
  UNIQUE(session_id, student_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
`);

// Helpers
const helpers = {
  upsertStudent: db.prepare(`INSERT INTO students (student_id, name) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET name=excluded.name RETURNING *`),
  getStudentByStudentId: db.prepare(`SELECT * FROM students WHERE student_id = ?`),
  insertLecture: db.prepare(`INSERT INTO lectures (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING RETURNING *`),
  getLectureByName: db.prepare(`SELECT * FROM lectures WHERE name = ?`),
  upsertEnrollment: db.prepare(`INSERT INTO enrollments (lecture_id, student_id) VALUES (?, ?) ON CONFLICT(lecture_id, student_id) DO NOTHING`),
  upsertSession: db.prepare(`INSERT INTO sessions (lecture_id, week, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lecture_id, week) DO UPDATE SET code=excluded.code, created_at=excluded.created_at, expires_at=excluded.expires_at RETURNING *`),
  getSessionByCode: db.prepare(`SELECT * FROM sessions WHERE code = ?`),
  getSessionByLectureWeek: db.prepare(`SELECT * FROM sessions WHERE lecture_id = ? AND week = ?`),
  markAttendance: db.prepare(`INSERT INTO attendance (session_id, student_id, present, recorded_at) VALUES (?, ?, 1, ?) ON CONFLICT(session_id, student_id) DO UPDATE SET present=1`),
  getAttendanceMatrix: db.prepare(`
    SELECT s.student_id, s.name,
           se.week, a.present
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN lectures l ON l.id = e.lecture_id
    LEFT JOIN sessions se ON se.lecture_id = l.id
    LEFT JOIN attendance a ON a.session_id = se.id AND a.student_id = s.id
    WHERE l.id = ?
    ORDER BY s.student_id ASC, se.week ASC
  `),
  getEnrolledStudents: db.prepare(`
    SELECT s.* FROM students s
    JOIN enrollments e ON e.student_id = s.id
    WHERE e.lecture_id = ?
    ORDER BY s.student_id ASC
  `),
};

module.exports = { db, helpers };
