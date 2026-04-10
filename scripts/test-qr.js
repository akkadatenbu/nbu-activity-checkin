#!/usr/bin/env node
// scripts/test-qr.js — ทดสอบ QR generate + verify
// รัน: node scripts/test-qr.js
// หรือ: QR_SECRET=mysecret node scripts/test-qr.js

import crypto from 'crypto';

const SECRET = process.env.QR_SECRET || 'test-secret-key';

// ── copy logic จาก qr.js (standalone ไม่ต้องมี .env) ──────────────────────
const makeHmac = (payload, secret) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);

const generateQR = (studentId, secret, ttlSec = 300) => {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const payload = `${studentId}|${exp}`;
    return `${payload}|${makeHmac(payload, secret)}`;
};

const verifyQR = (raw, secret) => {
    const parts = (raw || '').trim().split('|');
    if (parts.length !== 3) return { valid: false, error: 'format ไม่ถูกต้อง' };

    const [studentId, expStr, hmacReceived] = parts;
    const exp = parseInt(expStr, 10);
    if (isNaN(exp)) return { valid: false, error: 'timestamp ไม่ถูกต้อง' };

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > exp) return { valid: false, student_id: studentId, error: 'QR หมดอายุแล้ว' };

    const hmacExpected = makeHmac(`${studentId}|${expStr}`, secret);
    const a = Buffer.from(hmacReceived.padEnd(32, '0'));
    const b = Buffer.from(hmacExpected.padEnd(32, '0'));
    if (!crypto.timingSafeEqual(a, b)) return { valid: false, error: 'HMAC ไม่ตรง' };

    return { valid: true, student_id: studentId };
};

// ── Tests ──────────────────────────────────────────────────────────────────
console.log('='.repeat(50));
console.log('NBU QR Code Test');
console.log(`Secret: ${SECRET}`);
console.log('='.repeat(50));

// Test 1: Generate + Verify ปกติ
const qr1 = generateQR('691111523', SECRET);
console.log('\n✅ Test 1: Generate + Verify ปกติ');
console.log(`  QR payload : ${qr1}`);
const r1 = verifyQR(qr1, SECRET);
console.log(`  Result     : valid=${r1.valid} student_id=${r1.student_id}`);

// Test 2: ทดสอบ QR ตัวอย่างจาก spec (จะ expired แล้ว)
const qrSample = '691111523|1775716100|6dd426b0ff3fcf28';
console.log('\n⚠️  Test 2: QR ตัวอย่างจาก spec (expired แล้ว)');
console.log(`  QR payload : ${qrSample}`);
const r2 = verifyQR(qrSample, SECRET);
console.log(`  Result     : valid=${r2.valid} error="${r2.error}"`);

// Test 3: HMAC ถูกแก้ไข
const qrTampered = qr1.slice(0, -4) + 'ffff';
console.log('\n❌ Test 3: HMAC ถูกแก้ไข');
console.log(`  QR payload : ${qrTampered}`);
const r3 = verifyQR(qrTampered, SECRET);
console.log(`  Result     : valid=${r3.valid} error="${r3.error}"`);

// Test 4: QR หมดอายุ (exp ในอดีต)
const qrExpired = generateQR('691111523', SECRET, -10);
console.log('\n❌ Test 4: QR หมดอายุ (exp ในอดีต)');
const r4 = verifyQR(qrExpired, SECRET);
console.log(`  Result     : valid=${r4.valid} error="${r4.error}"`);

// Test 5: Format ผิด
console.log('\n❌ Test 5: Format ผิด');
const r5 = verifyQR('691111523', SECRET);
console.log(`  Result     : valid=${r5.valid} error="${r5.error}"`);

// Test 6: ทดสอบ secret ต่างกัน
const qrWrongSecret = generateQR('691111523', 'wrong-secret');
console.log('\n❌ Test 6: Secret ต่างกัน');
const r6 = verifyQR(qrWrongSecret, SECRET);
console.log(`  Result     : valid=${r6.valid} error="${r6.error}"`);

console.log('\n' + '='.repeat(50));
console.log('ถ้า Test 1 valid=true และ Test 3-6 valid=false = ทำงานถูกต้อง ✅');
console.log('='.repeat(50));
