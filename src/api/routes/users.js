// src/api/routes/users.js
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { verifyJWT } from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

const isAdmin = (role) => role === 'superadmin' || role === 'admin';

// ─── GET /api/v1/users ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    if (!isAdmin(req.user.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }
    try {
        const { rows } = await query(
            `SELECT id, username, full_name, role, faculty_scope, is_active, created_at
             FROM users ORDER BY created_at DESC`
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('GET users error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/users/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    if (!isAdmin(req.user.role) && req.user.id !== req.params.id) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }
    try {
        const { rows } = await query(
            'SELECT id, username, full_name, role, faculty_scope, is_active, created_at FROM users WHERE id = $1',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/users ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    if (!isAdmin(req.user.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }

    const { username, password, full_name, role, faculty_scope } = req.body;
    if (!username || !password || !full_name) {
        return res.status(400).json({ success: false, message: 'กรุณากรอก username, password, full_name' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    }
    // superadmin สร้างได้ทุก role, admin สร้างได้แค่ staff/dean
    if (req.user.role === 'admin' && role === 'superadmin') {
        return res.status(403).json({ success: false, message: 'admin ไม่สามารถสร้าง superadmin ได้' });
    }
    if (role === 'dean' && !faculty_scope) {
        return res.status(400).json({ success: false, message: 'Dean ต้องระบุ faculty_scope' });
    }

    try {
        const password_hash = await bcrypt.hash(password, 12);
        const { rows } = await query(
            `INSERT INTO users (username, password_hash, full_name, role, faculty_scope)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, full_name, role, faculty_scope, is_active, created_at`,
            [username.trim(), password_hash, full_name.trim(), role || 'staff', faculty_scope || null]
        );
        return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, message: 'Username นี้ถูกใช้งานแล้ว' });
        }
        console.error('POST user error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── PUT /api/v1/users/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    const isSelf = req.user.id === req.params.id;
    if (!isAdmin(req.user.role) && !isSelf) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }

    const { full_name, password, role, is_active, faculty_scope } = req.body;

    try {
        let password_hash;
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
            }
            password_hash = await bcrypt.hash(password, 12);
        }

        // staff แก้ได้แค่ชื่อและรหัสผ่านตัวเอง
        const updates = [];
        const params  = [];

        if (full_name) { params.push(full_name.trim()); updates.push(`full_name = $${params.length}`); }
        if (password_hash) { params.push(password_hash); updates.push(`password_hash = $${params.length}`); }
        if (isAdmin(req.user.role)) {
            if (role !== undefined)         { params.push(role);          updates.push(`role = $${params.length}`); }
            if (is_active !== undefined)    { params.push(is_active);     updates.push(`is_active = $${params.length}`); }
            if (faculty_scope !== undefined){ params.push(faculty_scope || null); updates.push(`faculty_scope = $${params.length}`); }
        }

        if (!updates.length) {
            return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });
        }

        params.push(req.params.id);
        const { rows } = await query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
             RETURNING id, username, full_name, role, is_active`,
            params
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('PUT user error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── DELETE /api/v1/users/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    if (!isAdmin(req.user.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }
    if (req.user.id === req.params.id) {
        return res.status(400).json({ success: false, message: 'ไม่สามารถลบตัวเองได้' });
    }
    try {
        const { rowCount } = await query('DELETE FROM users WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
        return res.json({ success: true, message: 'ลบผู้ใช้สำเร็จ' });
    } catch (err) {
        console.error('DELETE user error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
