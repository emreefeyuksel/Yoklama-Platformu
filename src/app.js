const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();
const compression = require('compression');
const multer = require('multer');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const dayjs = require('dayjs');
const crypto = require('crypto');
const { db, helpers } = require('./db');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function generateCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, alphabet.length);
    out += alphabet[idx];
  }
  return out;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(cors({
  origin: (origin, cb) => cb(null, true), // allow all origins; tighten later
  credentials: false,
}));
app.use(helmet());
app.use(compression());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.redirect('/instructor');
});

app.get('/instructor', (req, res) => {
  res.render('instructor', { error: null, qrPng: null, qrUrl: null, lectureName: '', week: 1 });
});

// Create session: upload Excel, provide lecture, week
app.post('/instructor/session', upload.single('roster'), async (req, res) => {
  try {
    const lectureName = (req.body.lectureName || '').trim();
    const week = parseInt(req.body.week, 10);
    if (!lectureName || !week || week < 1 || week > 14) {
      return res.status(400).render('instructor', { error: 'Provide lecture name and a valid week (1-14).', qrPng: null, qrUrl: null, lectureName, week });
    }
    if (!req.file) {
      return res.status(400).render('instructor', { error: 'Upload an Excel file (.xlsx/.xls) with columns: student_id, name.', qrPng: null, qrUrl: null, lectureName, week });
    }

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).render('instructor', { error: 'Excel sheet is empty.', qrPng: null, qrUrl: null, lectureName, week });
    }

    const now = dayjs().toISOString();
    // Upsert lecture
    let lecture = helpers.getLectureByName.get(lectureName);
    if (!lecture) {
      lecture = helpers.insertLecture.get(lectureName, now);
      // better-sqlite3 returns undefined with DO NOTHING; fetch again
      if (!lecture) lecture = helpers.getLectureByName.get(lectureName);
    }

    const insert = db.transaction((rows) => {
      for (const row of rows) {
        const studentId = String(row.student_id || row.StudentID || row.id || '').trim();
        const name = String(row.name || row.Name || '').trim();
        if (!studentId || !name) continue;
        const student = helpers.upsertStudent.get(studentId, name);
        helpers.upsertEnrollment.run(lecture.id, student.id);
      }
    });
    insert(rows);

    // Create/refresh session for lecture+week
    const code = generateCode(8);
    const expiresAt = dayjs().add(2, 'hour').toISOString();
    let session = helpers.upsertSession.get(lecture.id, week, code, now, expiresAt);
    if (!session) session = helpers.getSessionByLectureWeek.get(lecture.id, week);

    // Build QR link to student page
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const qrUrl = `${baseUrl}/ogrenci_yoklama?c=${encodeURIComponent(session.code)}`;
    const qrPng = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });

    res.render('qr', { qrPng, qrUrl, lectureName: lecture.name, week });
  } catch (err) {
    console.error(err);
    res.status(500).render('instructor', { error: 'Unexpected error. Ensure Excel has columns: student_id, name.', qrPng: null, qrUrl: null, lectureName: req.body.lectureName || '', week: req.body.week || 1 });
  }
});

// Student page via QR
app.get('/ogrenci_yoklama', (req, res) => {
  const code = (req.query.c || '').trim();
  res.render('student', { code, message: null, error: null });
});

// Record attendance
app.post('/ogrenci_yoklama', (req, res) => {
  const code = (req.body.code || '').trim();
  const studentIdStr = (req.body.student_id || '').trim();
  if (!code || !studentIdStr) {
    return res.status(400).render('student', { code, message: null, error: 'Kod ve Öğrenci No gerekli.' });
  }
  const session = helpers.getSessionByCode.get(code);
  if (!session) {
    return res.status(404).render('student', { code, message: null, error: 'Geçersiz ya da süresi dolmuş kod.' });
  }
  if (session.expires_at && dayjs().isAfter(dayjs(session.expires_at))) {
    return res.status(410).render('student', { code, message: null, error: 'Bu yoklama süresi doldu.' });
  }
  const student = helpers.getStudentByStudentId.get(studentIdStr);
  if (!student) {
    return res.status(404).render('student', { code, message: null, error: 'Öğrenci bulunamadı. Doğru öğrenci no giriniz.' });
  }
  // Ensure enrolled to this lecture
  const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE lecture_id=? AND student_id=?').get(session.lecture_id, student.id);
  if (!enrolled) {
    return res.status(403).render('student', { code, message: null, error: 'Bu derse kayıtlı değilsiniz.' });
  }
  helpers.markAttendance.run(session.id, student.id, dayjs().toISOString());
  return res.render('student', { code, message: 'Yoklamanız alındı.', error: null });
});

// Export attendance matrix (CSV or XLSX)
app.get('/instructor/export', (req, res) => {
  const lectureName = (req.query.lecture || '').trim();
  const format = (req.query.format || 'xlsx').toLowerCase();
  if (!lectureName) return res.status(400).send('lecture query required');
  const lecture = helpers.getLectureByName.get(lectureName);
  if (!lecture) return res.status(404).send('lecture not found');

  const enrolled = helpers.getEnrolledStudents.all(lecture.id);
  const matrixRows = helpers.getAttendanceMatrix.all(lecture.id);
  // Build a map student_id -> { name, week1..week14 }
  const byStudent = new Map();
  for (const s of enrolled) {
    byStudent.set(s.student_id, { student_id: s.student_id, name: s.name, ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`W${i + 1}`, 0])) });
  }
  for (const row of matrixRows) {
    if (!row.week) continue;
    const entry = byStudent.get(row.student_id);
    if (entry) entry[`W${row.week}`] = row.present ? 1 : 0;
  }
  const data = Array.from(byStudent.values());
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${lecture.name}-attendance.csv"`);
    return res.send(csv);
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${lecture.name}-attendance.xlsx"`);
  return res.send(buf);
});

// QR preview route (optional direct)
app.get('/instructor/qr', async (req, res) => {
  const code = (req.query.c || '').trim();
  const session = code ? helpers.getSessionByCode.get(code) : null;
  if (!session) return res.status(404).send('Session not found');
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const qrUrl = `${baseUrl}/ogrenci_yoklama?c=${encodeURIComponent(session.code)}`;
  const qrPng = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });
  const lecture = db.prepare('SELECT name FROM lectures WHERE id = ?').get(session.lecture_id);
  res.render('qr', { qrPng, qrUrl, lectureName: lecture?.name || '', week: session.week });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Yoklama sistemi listening on http://localhost:${PORT}`);
});

