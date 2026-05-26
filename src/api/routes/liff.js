// src/api/routes/liff.js — API สำหรับ LIFF App (ไม่ต้อง JWT)
import { Router } from 'express';
import { query, queryAvs } from '../db.js';

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

        // หา student_id — ลอง AVS_DB ก่อน ถ้าไม่เจอ fallback ไป line_student_links
        let studentId = null;

        const { rows: avsRows } = await queryAvs(
            `SELECT studentcode FROM nbc_line_map
             WHERE line_uuid = $1 AND is_active = true
             LIMIT 1`,
            [profile.userId]
        );
        if (avsRows.length && avsRows[0].studentcode) {
            studentId = avsRows[0].studentcode;
        } else {
            const { rows: localRows } = await query(
                `SELECT student_id FROM line_student_links WHERE line_user_id = $1 LIMIT 1`,
                [profile.userId]
            );
            if (localRows.length) studentId = localRows[0].student_id;
        }

        if (!studentId) {
            return res.json({
                success: true,
                data: { linked: false, lineDisplayName: profile.displayName },
            });
        }

        // ดึงข้อมูลนักศึกษาจาก main DB
        const { rows } = await query(
            `SELECT student_id, full_name, faculty, major, level, study_period, photo_url
             FROM nbu_students
             WHERE student_id = $1`,
            [studentId]
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

        // หา student_id — ลอง AVS_DB ก่อน ถ้าไม่เจอ fallback ไป line_student_links
        let studentId = null;

        const { rows: avsRows } = await queryAvs(
            `SELECT studentcode FROM nbc_line_map
             WHERE line_uuid = $1 AND is_active = true
             LIMIT 1`,
            [profile.userId]
        );
        if (avsRows.length && avsRows[0].studentcode) {
            studentId = avsRows[0].studentcode;
        } else {
            const { rows: localRows } = await query(
                `SELECT student_id FROM line_student_links WHERE line_user_id = $1 LIMIT 1`,
                [profile.userId]
            );
            if (localRows.length) studentId = localRows[0].student_id;
        }

        if (!studentId) {
            return res.json({ success: true, data: [] });
        }
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
