// src/api/utils/qr.js
// QR Code verify สำหรับระบบ attendance
//
// Format:  studentcode|exp_unix_timestamp|hmac_sha256_16chars
// Example: 691111523|1775716100|6dd426b0ff3fcf28
// Secret:  ดึงจาก https://nbc.northbkk.ac.th/admin/config → QR Secret Key
// HMAC:    HMAC-SHA256 ของ "studentcode|exp_unix_timestamp" ย่อเหลือ 16 ตัว
// Expiry:  5 นาที

import crypto from 'crypto';

/**
 * สร้าง HMAC-SHA256 ย่อ 16 ตัว
 * @param {string} payload  - "studentcode|exp_unix_timestamp"
 * @param {string} secret   - QR Secret Key
 * @returns {string}        - hex 16 ตัว
 */
const makeHmac = (payload, secret) =>
    crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex')
        .slice(0, 16);

/**
 * ผลลัพธ์ของการ verify QR
 * @typedef {Object} QRResult
 * @property {boolean} valid       - ถูกต้องทุกอย่าง
 * @property {string}  student_id  - รหัสนักศึกษา (ถ้า valid)
 * @property {string}  error       - ข้อความ error (ถ้าไม่ valid)
 */

/**
 * ตรวจสอบ QR Code ที่สแกนได้
 * @param {string} raw    - ค่าจากเครื่องสแกน เช่น "691111523|1775716100|6dd426b0ff3fcf28"
 * @param {string} secret - QR Secret Key
 * @returns {QRResult}
 */
export const verifyQR = (raw, secret) => {
    // 1. แยก parts
    const parts = (raw || '').trim().split('|');
    if (parts.length !== 3) {
        return { valid: false, error: 'QR format ไม่ถูกต้อง' };
    }

    const [studentId, expStr, hmacReceived] = parts;

    // 2. ตรวจ student_id ไม่ว่าง
    if (!studentId) {
        return { valid: false, error: 'ไม่พบรหัสนักศึกษา' };
    }

    // 3. ตรวจ timestamp หมดอายุไหม
    const exp = parseInt(expStr, 10);
    if (isNaN(exp)) {
        return { valid: false, error: 'QR timestamp ไม่ถูกต้อง' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > exp) {
        return { valid: false, student_id: studentId, error: 'QR หมดอายุแล้ว' };
    }

    // 4. ตรวจ HMAC
    const payload      = `${studentId}|${expStr}`;
    const hmacExpected = makeHmac(payload, secret);

    // ใช้ timingSafeEqual ป้องกัน timing attack
    const bufReceived = Buffer.from(hmacReceived.padEnd(32, '0'));
    const bufExpected = Buffer.from(hmacExpected.padEnd(32, '0'));
    const hmacValid   = crypto.timingSafeEqual(bufReceived, bufExpected);

    if (!hmacValid) {
        return { valid: false, error: 'QR ถูกแก้ไขหรือไม่ถูกต้อง' };
    }

    return { valid: true, student_id: studentId };
};

/**
 * สร้าง QR Code payload สำหรับทดสอบ
 * @param {string} studentId  - รหัสนักศึกษา
 * @param {string} secret     - QR Secret Key
 * @param {number} ttlSeconds - อายุ QR (default 300 = 5 นาที)
 * @returns {string}          - payload พร้อม render เป็น QR
 */
export const generateQR = (studentId, secret, ttlSeconds = 300) => {
    const exp     = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${studentId}|${exp}`;
    const hmac    = makeHmac(payload, secret);
    return `${payload}|${hmac}`;
};
