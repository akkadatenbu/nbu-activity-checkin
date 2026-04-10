// src/api/routes/liff.js — API สำหรับ LIFF App (ไม่ต้อง JWT)
import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// ─── ตรวจสิทธิ์ผ่าน LINE Access Token ────────────────────────────────────────
// เรียก LINE Profile API เพื่อยืนยัน accessToken จริงๆ และได้ userId
async function verifyLineToken(accessToken) {
    const res = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json(); // { userId, displayName, pictureUrl }
}

// ─── GET /api/v1/liff/me ──────────────────────────────────────────────────────
// ส่ง LINE access token มา → คืนข้อมูลนักศึกษา + สถิติการเข้าร่วม
router.get('/me', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ success: false, message: 'ไม่มี token' });
    }

    try {
        // ยืนยัน token กับ LINE
        const profile = await verifyLineToken(token);
        if (!profile?.userId) {
            return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
        }

        // หา student จาก line_student_links
        const { rows } = await query(
            `SELECT s.student_id, s.full_name, s.faculty, s.major,
                    s.level, s.study_period, s.photo_url
             FROM nbu_students s
             JOIN line_student_links l ON l.student_id = s.student_id
             WHERE l.line_user_id = $1`,
            [profile.userId]
        );

        if (!rows.length) {
            return res.json({
                success: true,
                data: { linked: false, lineDisplayName: profile.displayName },
            });
        }

        const student = rows[0];

        // นับกิจกรรมที่เข้าร่วม
        const { rows: stats } = await query(
            `SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE att.checked_at >= date_trunc('month', NOW())) AS this_month
             FROM nbu_attendance att
             WHERE att.student_id = $1`,
            [student.student_id]
        );

        return res.json({
            success: true,
            data: {
                linked: true,
                student,
                stats: {
                    total:      parseInt(stats[0].total),
                    this_month: parseInt(stats[0].this_month),
                },
            },
        });
    } catch (err) {
        console.error('LIFF /me error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/liff/attendance ─────────────────────────────────────────────
// ส่ง LINE access token มา → คืนประวัติการเข้าร่วมกิจกรรม
router.get('/attendance', async (req, res) => {
    const { token, page = 1 } = req.query;
    if (!token) {
        return res.status(400).json({ success: false, message: 'ไม่มี token' });
    }

    try {
        const profile = await verifyLineToken(token);
        if (!profile?.userId) {
            return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
        }

        // หา student_id
        const { rows: linkRows } = await query(
            'SELECT s.student_id FROM nbu_students s JOIN line_student_links l ON l.student_id = s.student_id WHERE l.line_user_id = $1',
            [profile.userId]
        );
        if (!linkRows.length) {
            return res.json({ success: true, data: [] });
        }

        const studentId = linkRows[0].student_id;
        const limit  = 20;
        const offset = (parseInt(page) - 1) * limit;

        const { rows } = await query(
            `SELECT a.title, a.location, a.start_datetime, a.end_datetime,
                    att.checked_at, att.method
             FROM nbu_attendance att
             JOIN nbu_activities a ON a.id = att.activity_id
             WHERE att.student_id = $1
             ORDER BY att.checked_at DESC
             LIMIT $2 OFFSET $3`,
            [studentId, limit, offset]
        );

        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('LIFF /attendance error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
