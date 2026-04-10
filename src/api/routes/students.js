// src/api/routes/students.js
import { Router } from 'express';
import { query } from '../db.js';
import { verifyJWT } from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

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
