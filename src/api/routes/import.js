// src/api/routes/import.js
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { query } from '../db.js';
import redisClient from '../redis.js';
import { verifyJWT } from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }
    next();
};

const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(csv|txt)$/i)) {
            return cb(new Error('รองรับเฉพาะไฟล์ .csv เท่านั้น'));
        }
        cb(null, true);
    },
});

// ─── CSV Parser (รองรับ BOM + quoted fields + Thai) ───────────────────────────
function parseCSV(buffer) {
    let content = buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const parseRow = (line) => {
        const fields = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
            } else if (ch === ',' && !inQ) {
                fields.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        fields.push(cur.trim());
        return fields;
    };

    if (!lines[0]?.trim()) throw new Error('ไฟล์ว่างเปล่า');
    const headers = parseRow(lines[0]).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = parseRow(lines[i]);
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
        rows.push(obj);
    }
    return { headers, rows };
}

// In-memory stores (single process fork mode)
const uploadStore = new Map(); // uploadId → { rows, headers, filePath }
const jobStore    = new Map(); // jobId   → job state

// ─── POST /api/v1/import/upload ───────────────────────────────────────────────
router.post('/upload', requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'ไม่มีไฟล์' });

    try {
        const buf = fs.readFileSync(req.file.path);
        const { headers, rows } = parseCSV(buf);

        if (rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'ไฟล์ไม่มีข้อมูล' });
        }

        const uploadId = crypto.randomUUID();
        uploadStore.set(uploadId, { rows, headers, filePath: req.file.path });

        // ลบ temp file หลัง 30 นาที
        setTimeout(() => {
            const s = uploadStore.get(uploadId);
            if (s) { try { fs.unlinkSync(s.filePath); } catch {} uploadStore.delete(uploadId); }
        }, 30 * 60 * 1000);

        return res.json({
            success: true,
            data: { uploadId, total: rows.length, headers, preview: rows.slice(0, 5) },
        });
    } catch (err) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ success: false, message: `อ่าน CSV ไม่ได้: ${err.message}` });
    }
});

// ─── POST /api/v1/import/start ────────────────────────────────────────────────
router.post('/start', requireAdmin, (req, res) => {
    const {
        uploadId,
        colId, colName, colFaculty, colMajor,
        colLevel, colStudyDuration, colStudyPeriod, colStudyPlan, colLoanStatus,
        colStudentStatus, colInternational, colCampus,
        skipPhotos,
    } = req.body;

    const stored = uploadStore.get(uploadId);
    if (!stored) return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลที่อัปโหลด หรือหมดอายุแล้ว' });

    const jobId = crypto.randomUUID();
    const job = {
        status: 'running',
        phase: 'photos',
        total: stored.rows.length,
        done: 0,
        photoOk: 0,
        photoFail: 0,
    };
    jobStore.set(jobId, job);
    res.json({ success: true, data: { jobId } });

    runImport(jobId, stored.rows, {
        colId, colName, colFaculty, colMajor,
        colLevel, colStudyDuration, colStudyPeriod, colStudyPlan, colLoanStatus,
        colStudentStatus, colInternational, colCampus,
        skipPhotos: skipPhotos === 'true' || skipPhotos === true,
    }).catch(err => {
        const j = jobStore.get(jobId);
        if (j) { j.status = 'error'; j.errorMsg = err.message; }
    });

    uploadStore.delete(uploadId);
    try { fs.unlinkSync(stored.filePath); } catch {}
});

// ─── GET /api/v1/import/progress/:jobId  (SSE) ────────────────────────────────
router.get('/progress/:jobId', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

    const iv = setInterval(() => {
        const job = jobStore.get(req.params.jobId);
        if (!job) { send({ status: 'not_found' }); clearInterval(iv); res.end(); return; }
        send(job);
        if (job.status === 'done' || job.status === 'error') {
            clearInterval(iv);
            setTimeout(() => { res.end(); jobStore.delete(req.params.jobId); }, 600);
        }
    }, 600);

    req.on('close', () => clearInterval(iv));
});

// ─── Import Logic ─────────────────────────────────────────────────────────────
async function downloadThumb(studentId, thumbDir) {
    const baseUrl = process.env.PHOTO_BASE_URL || 'https://reg.northbkk.ac.th/studentimg';
    const local   = path.join(thumbDir, `${studentId}.jpg`);
    const serve   = `/thumbnails/${studentId}.jpg`;
    if (fs.existsSync(local)) return serve;
    try {
        const r = await fetch(`${baseUrl}/${studentId.slice(0, 2)}/${studentId}.jpg`, {
            headers: { 'User-Agent': 'NBU-ImportBot/1.0' },
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return '';
        const buf = Buffer.from(await r.arrayBuffer());
        await sharp(buf)
            .resize(120, 120, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: 80 })
            .toFile(local);
        return serve;
    } catch { return ''; }
}

async function runImport(jobId, rows, {
    colId, colName, colFaculty, colMajor,
    colLevel, colStudyDuration, colStudyPeriod, colStudyPlan, colLoanStatus,
    colStudentStatus, colInternational, colCampus,
    skipPhotos,
}) {
    const job = jobStore.get(jobId);
    const thumbDir = process.env.THUMBNAIL_DIR || '/var/www/app/nbu-activity-checkin/public/thumbnails';
    fs.mkdirSync(thumbDir, { recursive: true });

    const col = (r, key) => (key && r[key] ? String(r[key]).trim() : '');

    const students = rows
        .map(r => ({
            student_id:     col(r, colId),
            full_name:      col(r, colName),
            faculty:        col(r, colFaculty),
            major:          col(r, colMajor),
            level:          col(r, colLevel),
            study_duration: col(r, colStudyDuration),
            study_period:   col(r, colStudyPeriod),
            program:        col(r, colStudyPlan),
            loan_status:    col(r, colLoanStatus),
            student_status: col(r, colStudentStatus),
            international:  col(r, colInternational),
            campus:         col(r, colCampus),
            photo_url:      '',
        }))
        .filter(s => s.student_id);

    job.total = students.length;

    // Phase 1: รูปภาพ
    if (!skipPhotos) {
        job.phase = 'photos';
        job.done  = 0;
        const C = 10;
        for (let i = 0; i < students.length; i += C) {
            const batch = students.slice(i, i + C);
            const urls  = await Promise.all(batch.map(s => downloadThumb(s.student_id, thumbDir)));
            urls.forEach((url, idx) => {
                batch[idx].photo_url = url;
                if (url) job.photoOk++; else job.photoFail++;
            });
            job.done = Math.min(i + C, students.length);
        }
    } else {
        students.forEach(s => {
            const local = path.join(thumbDir, `${s.student_id}.jpg`);
            s.photo_url = fs.existsSync(local) ? `/thumbnails/${s.student_id}.jpg` : '';
        });
    }

    // Phase 2: PostgreSQL (13 fields)
    job.phase = 'db';
    job.done  = 0;
    const BATCH = 200;
    const N = 13; // จำนวน parameter ต่อแถว
    for (let i = 0; i < students.length; i += BATCH) {
        const batch  = students.slice(i, i + BATCH);
        const vals   = batch.map((_, j) =>
            `($${j*N+1},$${j*N+2},$${j*N+3},$${j*N+4},$${j*N+5},$${j*N+6},$${j*N+7},$${j*N+8},$${j*N+9},$${j*N+10},$${j*N+11},$${j*N+12},$${j*N+13})`
        ).join(',');
        const params = batch.flatMap(s => [
            s.student_id, s.full_name, s.faculty, s.major,
            s.level, s.study_duration, s.study_period, s.program,
            s.loan_status, s.student_status, s.international, s.campus, s.photo_url,
        ]);
        await query(`
            INSERT INTO nbu_students
                (student_id, full_name, faculty, major,
                 level, study_duration, study_period, program,
                 loan_status, student_status, international, campus, photo_url)
            VALUES ${vals}
            ON CONFLICT (student_id) DO UPDATE SET
                full_name      = EXCLUDED.full_name,
                faculty        = EXCLUDED.faculty,
                major          = EXCLUDED.major,
                level          = EXCLUDED.level,
                study_duration = EXCLUDED.study_duration,
                study_period   = EXCLUDED.study_period,
                program        = EXCLUDED.program,
                loan_status    = EXCLUDED.loan_status,
                student_status = EXCLUDED.student_status,
                international  = EXCLUDED.international,
                campus         = EXCLUDED.campus,
                photo_url      = CASE WHEN EXCLUDED.photo_url != ''
                                      THEN EXCLUDED.photo_url
                                      ELSE nbu_students.photo_url END,
                updated_at     = NOW()
        `, params);
        job.done = Math.min(i + BATCH, students.length);
    }

    // Phase 3: Redis — เก็บเฉพาะฟิลด์ที่ใช้ตอนสแกน QR
    job.phase = 'redis';
    job.done  = 0;
    for (let i = 0; i < students.length; i += BATCH) {
        const batch = students.slice(i, i + BATCH);
        const pipe  = redisClient.multi();
        batch.forEach(s => pipe.hSet(`student:${s.student_id}`, {
            student_id: s.student_id,
            full_name:  s.full_name,
            faculty:    s.faculty,
            major:      s.major,
            photo_url:  s.photo_url,
        }));
        await pipe.exec();
        job.done = Math.min(i + BATCH, students.length);
    }

    job.status = 'done';
    job.phase  = 'done';
    job.done   = students.length;
}

export default router;
