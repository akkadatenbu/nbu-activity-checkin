// src/api/middleware/auth.js
import jwt from 'jsonwebtoken';

export const verifyJWT = (req, res, next) => {
    // รองรับทั้ง Authorization header และ ?token= query param (สำหรับ file download)
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token หมดอายุหรือไม่ถูกต้อง' });
    }
};
