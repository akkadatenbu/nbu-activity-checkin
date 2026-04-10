// src/api/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
    }

    try {
        const { rows } = await query(
            `SELECT id, username, password_hash, full_name, role, faculty_scope, is_active
             FROM users WHERE username = $1`,
            [username.trim()]
        );

        const user = rows[0];
        if (!user || !user.is_active) {
            return res.status(401).json({ success: false, message: 'ไม่พบผู้ใช้หรือถูกระงับการใช้งาน' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, full_name: user.full_name, faculty_scope: user.faculty_scope || null },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        return res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, faculty_scope: user.faculty_scope || null },
        });

    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// POST /api/v1/auth/logout (stateless JWT — client ลบ token เอง)
router.post('/logout', (req, res) => {
    res.json({ success: true, message: 'logout สำเร็จ' });
});

export default router;
