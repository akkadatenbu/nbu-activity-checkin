// src/api/routes/students.js
import { Router } from 'express';
import { query } from '../db.js';
import { verifyJWT } from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

// ─── GET /api/v1/students/meta ────────────────────────────────────────────────
// ดึง distinct faculties, levels, cohorts จาก nbu_students สำหรับ dropdown
router.get('/meta', async (_req, res) => {
    try {
        const [facRes, lvlRes, cohRes, statusRes, majorRes, planRes, intlRes, campRes, facMajRes] = await Promise.all([
            query(`SELECT DISTINCT faculty        FROM nbu_students WHERE faculty        IS NOT NULL AND faculty        != '' ORDER BY faculty`),
            query(`SELECT DISTINCT level          FROM nbu_students WHERE level          IS NOT NULL AND level          != '' ORDER BY level`),
            query(`SELECT DISTINCT SUBSTRING(student_id,1,2) AS cohort FROM nbu_students WHERE student_id IS NOT NULL ORDER BY cohort DESC`),
            // student_status เป็น INTEGER แล้ว — ใช้ IS NOT NULL เท่านั้น
            query(`SELECT DISTINCT student_status FROM nbu_students WHERE student_status IS NOT NULL ORDER BY student_status`),
            query(`SELECT DISTINCT major           FROM nbu_students WHERE major          IS NOT NULL AND major          != '' ORDER BY major`),
            query(`SELECT DISTINCT program         FROM nbu_students WHERE program        IS NOT NULL AND program        != '' ORDER BY program`),
            // international เป็น VARCHAR — ดึงค่าที่มีจริงในฐานข้อมูล
            query(`SELECT DISTINCT international  FROM nbu_students WHERE international  IS NOT NULL AND international  != '' ORDER BY international`),
            // campus — ดึงวิทยาเขตที่มีจริงในฐานข้อมูล
            query(`SELECT DISTINCT campus         FROM nbu_students WHERE campus         IS NOT NULL AND campus         != '' ORDER BY campus`),
            // faculty → majors mapping สำหรับ multi-select filter
            query(`SELECT DISTINCT faculty, major FROM nbu_students WHERE faculty IS NOT NULL AND faculty != '' AND major IS NOT NULL AND major != '' ORDER BY faculty, major`),
        ]);

        // สร้าง map: { คณะ: [สาขา1, สาขา2, ...] }
        const faculty_majors = facMajRes.rows.reduce((map, r) => {
            if (!map[r.faculty]) map[r.faculty] = [];
            map[r.faculty].push(r.major);
            return map;
        }, {});

        return res.json({
            success: true,
            data: {
                faculties:        facRes.rows.map(r => r.faculty),
                levels:           lvlRes.rows.map(r => r.level),
                cohorts:          cohRes.rows.map(r => r.cohort),
                student_statuses: statusRes.rows.map(r => r.student_status),
                majors:           majorRes.rows.map(r => r.major),
                programs:         planRes.rows.map(r => r.program),
                internationals:   intlRes.rows.map(r => r.international),
                campuses:         campRes.rows.map(r => r.campus),
                faculty_majors,
            },
        });
    } catch (err) {
        console.error('Student meta error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/students/search?q=&faculty=&year= ───────────────────────────
// Fallback ค้นหานักศึกษากรณีสแกน QR ไม่ได้ หรือ manual entry
router.get('/search', async (req, res) => {
    const { q, faculty } = req.query;

    if (!q || q.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกคำค้นหาอย่างน้อย 2 ตัวอักษร' });
    }

    try {
        const params = [];
        const conditions = [];

        // ค้นหาตามรหัสนักศึกษา หรือ ชื่อ (full text search)
        const term = q.trim();
        if (/^\d+$/.test(term)) {
            // เป็นตัวเลข → ค้นหา student_id แบบ prefix
            params.push(`${term}%`);
            conditions.push(`s.student_id LIKE $${params.length}`);
        } else {
            // ชื่อ → full text + ILIKE fallback
            params.push(`%${term}%`);
            conditions.push(`s.full_name ILIKE $${params.length}`);
        }

        if (faculty) {
            params.push(faculty);
            conditions.push(`s.faculty = $${params.length}`);
        }

        const sql = `
            SELECT student_id, full_name, faculty, major, photo_url
            FROM nbu_students s
            WHERE ${conditions.join(' AND ')}
            ORDER BY student_id
            LIMIT 20
        `;

        const { rows } = await query(sql, params);
        return res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        console.error('Student search error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/students/:studentId ─────────────────────────────────────────
router.get('/:studentId', async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT student_id, full_name, faculty, major, photo_url FROM nbu_students WHERE student_id = $1',
            [req.params.studentId]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'ไม่พบนักศึกษา' });
        }
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/students/faculties (list คณะ) ───────────────────────────────
router.get('/meta/faculties', async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT DISTINCT faculty FROM nbu_students WHERE faculty IS NOT NULL AND faculty != \'\' ORDER BY faculty'
        );
        return res.json({ success: true, data: rows.map(r => r.faculty) });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
