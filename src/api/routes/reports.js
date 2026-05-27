// src/api/routes/reports.js
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { verifyJWT } from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

const isAdmin = (role) => role === 'superadmin' || role === 'admin';

// ─── ตรวจสิทธิ์เข้าถึงรายงานกิจกรรม ──────────────────────────────────────────
async function canAccessReport(req, activityId) {
    if (isAdmin(req.user.role)) return true;
    const { rows } = await query(
        'SELECT 1 FROM nbu_activity_staff WHERE activity_id = $1 AND user_id = $2',
        [activityId, req.user.id]
    );
    return rows.length > 0;
}

// ─── ดึงข้อมูลรายงาน ──────────────────────────────────────────────────────────
async function getReportData(activityId) {
    const [actRes, attRes] = await Promise.all([
        query('SELECT * FROM nbu_activities WHERE id = $1', [activityId]),
        query(
            `SELECT att.student_id, att.checked_at, att.method,
                    s.full_name      AS student_name,
                    s.faculty,
                    s.major,
                    s.level,
                    s.study_duration,
                    s.study_period,
                    s.program,
                    s.loan_status,
                    u.full_name      AS checked_by_name
             FROM nbu_attendance att
             JOIN nbu_students s   ON s.student_id = att.student_id
             LEFT JOIN users u ON u.id = att.checked_by
             WHERE att.activity_id = $1
             ORDER BY att.checked_at ASC`,
            [activityId]
        ),
    ]);
    return { activity: actRes.rows[0], records: attRes.rows };
}

// ─── GET /api/v1/reports/:activityId/excel ────────────────────────────────────
router.get('/:activityId/excel', async (req, res) => {
    const { activityId } = req.params;

    if (!(await canAccessReport(req, activityId))) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }

    try {
        const { activity, records } = await getReportData(activityId);
        if (!activity) {
            return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });
        }

        const wb = new ExcelJS.Workbook();
        wb.creator = 'NBU Activity System';
        wb.created = new Date();

        const ws = wb.addWorksheet('รายชื่อผู้เข้าร่วม');

        // ─── Header info ───────────────────────────────────────────────────────
        const TOTAL_COLS = 12;
        const lastCol = String.fromCharCode(64 + TOTAL_COLS); // 'L'

        ws.mergeCells(`A1:${lastCol}1`);
        ws.getCell('A1').value = `รายชื่อผู้เข้าร่วมกิจกรรม: ${activity.title}`;
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.getCell('A1').alignment = { horizontal: 'center' };

        const SEM_LABEL = { 1: 'ภาค 1', 2: 'ภาค 2', 3: 'ภาคฤดูร้อน' };
        ws.mergeCells(`A2:${lastCol}2`);
        ws.getCell('A2').value =
            `สถานที่: ${activity.location || '-'}  |  วันที่: ${new Date(activity.start_datetime).toLocaleString('th-TH')}  |  ผู้เข้าร่วม: ${records.length} คน` +
            (activity.academic_year ? `  |  ปีการศึกษา: ${activity.academic_year}` : '') +
            (activity.semester      ? `  |  ${SEM_LABEL[activity.semester] || `ภาค ${activity.semester}`}` : '');
        ws.getCell('A2').alignment = { horizontal: 'center' };
        ws.getCell('A2').font = { size: 11 };

        ws.addRow([]);

        // ─── Column headers ────────────────────────────────────────────────────
        const HEADERS = [
            'ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล',
            'คณะ', 'สาขา', 'ระดับ',
            'ระยะเวลาเรียน', 'ช่วงเวลาเรียน', 'แผนการเรียน',
            'สถานะกู้ยืม', 'เวลาเช็คชื่อ', 'วิธี',
        ];
        const headerRow = ws.addRow(HEADERS);
        headerRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003B7A' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' }, bottom: { style: 'thin' },
                left: { style: 'thin' }, right: { style: 'thin' },
            };
        });
        headerRow.height = 20;

        // ─── Data rows ─────────────────────────────────────────────────────────
        records.forEach((r, i) => {
            const row = ws.addRow([
                i + 1,
                r.student_id,
                r.student_name        || '-',
                r.faculty             || '-',
                r.major               || '-',
                r.level               || '-',
                r.study_duration      || '-',
                r.study_period        || '-',
                r.program             || '-',
                r.loan_status         || '-',
                new Date(r.checked_at).toLocaleString('th-TH'),
                r.method === 'qr_scan' ? 'QR Scan' : 'Manual',
            ]);
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' }, bottom: { style: 'thin' },
                    left: { style: 'thin' }, right: { style: 'thin' },
                };
                if (i % 2 === 1) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
                }
            });
        });

        // ─── Summary row ───────────────────────────────────────────────────────
        ws.addRow([]);
        const sumRow = ws.addRow([`รวมทั้งหมด: ${records.length} คน`]);
        sumRow.font = { bold: true };

        // ─── Column widths ─────────────────────────────────────────────────────
        ws.columns = [
            { width: 7  },  // ลำดับ
            { width: 16 },  // รหัสนักศึกษา
            { width: 30 },  // ชื่อ-นามสกุล
            { width: 25 },  // คณะ
            { width: 25 },  // สาขา
            { width: 18 },  // ระดับ
            { width: 18 },  // ระยะเวลาเรียน
            { width: 18 },  // ช่วงเวลาเรียน
            { width: 18 },  // แผนการเรียน
            { width: 18 },  // สถานะกู้ยืม
            { width: 22 },  // เวลาเช็คชื่อ
            { width: 12 },  // วิธี
        ];

        const filename = `attendance_${activityId}_${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await wb.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Excel report error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดสร้างรายงาน Excel' });
    }
});

// ─── GET /api/v1/reports/:activityId/csv ─────────────────────────────────────
router.get('/:activityId/csv', async (req, res) => {
    const { activityId } = req.params;

    if (!(await canAccessReport(req, activityId))) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }

    try {
        const { activity, records } = await getReportData(activityId);
        if (!activity) {
            return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });
        }

        const CSV_SEM_LABEL = { 1: 'ภาค 1', 2: 'ภาค 2', 3: 'ภาคฤดูร้อน' };
        const HEADERS = [
            'ลำดับ', 'ชื่อกิจกรรม', 'ปีการศึกษา', 'ภาคการศึกษา', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล',
            'คณะ', 'สาขา', 'ระดับ',
            'ระยะเวลาเรียน', 'ช่วงเวลาเรียน', 'แผนการเรียน',
            'สถานะกู้ยืม', 'เวลาเช็คชื่อ', 'วิธี',
        ];

        const escapeCSV = (val) => {
            const s = String(val ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const rows = [
            HEADERS.map(escapeCSV).join(','),
            ...records.map((r, i) => [
                i + 1,
                activity.title,
                activity.academic_year || '',
                activity.semester ? (CSV_SEM_LABEL[activity.semester] || `ภาค ${activity.semester}`) : '',
                r.student_id,
                r.student_name     || '',
                r.faculty          || '',
                r.major            || '',
                r.level            || '',
                r.study_duration   || '',
                r.study_period     || '',
                r.program          || '',
                r.loan_status      || '',
                new Date(r.checked_at).toLocaleString('th-TH'),
                r.method === 'qr_scan' ? 'QR Scan' : 'Manual',
            ].map(escapeCSV).join(',')),
        ].join('\r\n');

        // UTF-8 BOM เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง
        const BOM = '\uFEFF';
        const filename = `attendance_${activityId}_${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(BOM + rows);
    } catch (err) {
        console.error('CSV report error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดสร้างรายงาน CSV' });
    }
});

// ─── GET /api/v1/reports/dashboard ───────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
    try {
        const [todayRes, studentsRes] = await Promise.all([
            query(`SELECT COUNT(*) FROM nbu_attendance
                   WHERE checked_at >= CURRENT_DATE AND checked_at < CURRENT_DATE + INTERVAL '1 day'`),
            query(`SELECT COUNT(*) FROM nbu_students`),
        ]);
        return res.json({
            success: true,
            data: {
                today_attendance: parseInt(todayRes.rows[0].count),
                total_students:   parseInt(studentsRes.rows[0].count),
            },
        });
    } catch (err) {
        console.error('Dashboard stats error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
