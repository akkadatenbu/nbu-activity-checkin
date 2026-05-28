// src/api/routes/attendance.js
import { Router } from 'express';
import { query }      from '../db.js';
import { getStudent } from '../redis.js';
import { verifyJWT }  from '../middleware/auth.js';
import { verifyQR }   from '../utils/qr.js';
import { pushFlexMessage } from '../../line-oa/line-api.js';

// esc: escape string สำหรับฝัง JSON (ป้องกัน " และ \ ทำลาย JSON structure)
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function sendActivityFlex(activityId, studentId, studentName, checkedAt) {
    try {
        // ดึง flex_message_json + title จาก activity
        const { rows: actRows } = await query(
            'SELECT title, flex_message_json FROM nbu_activities WHERE id = $1',
            [activityId]
        );
        if (!actRows.length || !actRows[0].flex_message_json) return;

        // ดึง LINE user_id จาก line_student_links
        const { rows: linkRows } = await query(
            'SELECT line_user_id FROM line_student_links WHERE student_id = $1 LIMIT 1',
            [studentId]
        );
        if (!linkRows.length || !linkRows[0].line_user_id) return;

        const lineUserId = linkRows[0].line_user_id;
        const actTitle   = actRows[0].title;
        const formattedDate = checkedAt.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short',
        });

        // แทน placeholders ใน JSON string (stringify → replace → parse)
        const jsonStr = JSON.stringify(actRows[0].flex_message_json)
            .replace(/\{\{student_id\}\}/g,      esc(studentId))
            .replace(/\{\{student_name\}\}/g,    esc(studentName))
            .replace(/\{\{activity_title\}\}/g,  esc(actTitle))
            .replace(/\{\{checked_at\}\}/g,      esc(formattedDate));

        await pushFlexMessage(lineUserId, JSON.parse(jsonStr));
    } catch (err) {
        // ไม่ให้ error ของ LINE กระทบระบบหลัก
        console.error('sendActivityFlex error:', err.message);
    }
}

const router = Router();
router.use(verifyJWT);

// ─── POST /api/v1/attendance/scan ─────────────────────────────────────────
// QR scan จาก PC/iPad
// body: { qr_raw, activity_id, session_id }
// qr_raw = ค่าดิบจากเครื่องสแกน "691111523|1775716100|6dd426b0ff3fcf28"
router.post('/scan', async (req, res) => {
    const { qr_raw, activity_id, session_id } = req.body;

    if (!qr_raw || !activity_id || !session_id) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบ' });
    }

    // 1. ตรวจสอบ QR (format + expiry + HMAC) ก่อนทุกอย่าง
    const qr = verifyQR(qr_raw.trim(), process.env.QR_SECRET);
    if (!qr.valid) {
        return res.status(400).json({
            success: false,
            message: qr.error,
        });
    }

    const student_id = qr.student_id;

    try {
        // 2. ดึงข้อมูลนักศึกษาจาก Redis (< 5ms)
        const student = await getStudent(student_id);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบข้อมูลนักศึกษา',
                student_id,
            });
        }

        // 3. ตรวจสอบ session ยังเปิดอยู่ไหม
        const { rows: sessionRows } = await query(
            'SELECT id, status FROM nbu_sessions WHERE id = $1 AND activity_id = $2',
            [session_id, activity_id]
        );
        if (!sessionRows.length || sessionRows[0].status !== 'open') {
            return res.status(400).json({ success: false, message: 'session ปิดแล้ว' });
        }

        // 4. ตรวจสอบเช็คชื่อซ้ำ
        const { rows: existing } = await query(
            'SELECT id FROM nbu_attendance WHERE activity_id = $1 AND student_id = $2',
            [activity_id, student_id]
        );
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'เช็คชื่อซ้ำ',
                student,
                already_checked: true,
            });
        }

        // 5. บันทึก attendance + ส่ง Flex Message (async, ไม่รอ ตอบ client ก่อน)
        const _studentName = student.full_name;
        const _checkedAt   = new Date();
        query(
            'INSERT INTO nbu_attendance (activity_id, session_id, student_id, checked_by, method) VALUES ($1, $2, $3, $4, \'qr_scan\')',
            [activity_id, session_id, student_id, req.user.id]
        ).then(() => sendActivityFlex(activity_id, student_id, _studentName, _checkedAt))
         .catch(err => console.error('Attendance insert error:', err));

        // 6. ตอบกลับทันที
        return res.json({
            success: true,
            message: 'เช็คชื่อสำเร็จ',
            student: {
                student_id: student.student_id,
                full_name:  student.full_name,
                faculty:    student.faculty,
                major:      student.major,
                year:       student.year,
                photo_url:  student.photo_url,
            },
        });

    } catch (err) {
        console.error('Scan error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/attendance/manual ───────────────────────────────────────
router.post('/manual', async (req, res) => {
    const { student_id, activity_id, session_id, note } = req.body;
    try {
        const { rows: studentRows } = await query(
            'SELECT student_id, full_name, faculty, major, photo_url FROM nbu_students WHERE student_id = $1',
            [student_id]
        );
        if (!studentRows.length) {
            return res.status(404).json({ success: false, message: 'ไม่พบรหัสนักศึกษา' });
        }
        const result = await query(
            'INSERT INTO nbu_attendance (activity_id, session_id, student_id, checked_by, method, note) VALUES ($1, $2, $3, $4, \'manual\', $5) ON CONFLICT (activity_id, student_id) DO NOTHING',
            [activity_id, session_id, student_id, req.user.id, note || '']
        );
        // ส่ง Flex Message เฉพาะกรณีที่ INSERT สำเร็จ (ไม่ใช่ duplicate)
        if (result.rowCount > 0) {
            sendActivityFlex(activity_id, student_id, studentRows[0].full_name, new Date());
        }
        return res.json({ success: true, message: 'บันทึกสำเร็จ', student: studentRows[0] });
    } catch (err) {
        console.error('Manual attendance error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/attendance/:activityId ───────────────────────────────────
router.get('/:activityId', async (req, res) => {
    const { activityId } = req.params;
    const { faculty, year, method } = req.query;
    let sql = 'SELECT * FROM nbu_v_attendance_detail WHERE activity_id = $1';
    const params = [activityId];
    if (faculty) { params.push(faculty); sql += ` AND faculty = $${params.length}`; }
    if (year)    { params.push(year);    sql += ` AND year = $${params.length}`; }
    if (method)  { params.push(method);  sql += ` AND method = $${params.length}`; }
    sql += ' ORDER BY checked_at ASC';
    try {
        const { rows } = await query(sql, params);
        return res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── DELETE /api/v1/attendance/:id ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        await query('DELETE FROM nbu_attendance WHERE id = $1', [req.params.id]);
        return res.json({ success: true, message: 'ลบสำเร็จ' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
