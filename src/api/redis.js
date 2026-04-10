// src/api/redis.js — Redis Cloud connection
import { createClient } from 'redis';

// TLS: เปิดเฉพาะเมื่อ REDIS_TLS=true หรือ REDIS_URL ขึ้นต้นด้วย rediss://
const useTLS = process.env.REDIS_TLS === 'true' ||
               (process.env.REDIS_URL || '').startsWith('rediss://');

const client = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379'),
        tls:  useTLS,
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
    password: process.env.REDIS_PASSWORD,
});

client.on('error', (err) => console.error('Redis error:', err));
client.on('connect', ()  => console.log('✅ Redis connected'));
client.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));

await client.connect();

/**
 * ดึงข้อมูลนักศึกษาจาก Redis
 * @param {string} studentId
 * @returns {Object|null}
 */
export const getStudent = async (studentId) => {
    const data = await client.hGetAll(`student:${studentId}`);
    if (!data || Object.keys(data).length === 0) return null;
    return data;
};

/**
 * บันทึกข้อมูลนักศึกษาลง Redis
 * @param {Object} student
 */
export const setStudent = async (student) => {
    const key = `student:${student.student_id}`;
    await client.hSet(key, {
        student_id: student.student_id,
        full_name:  student.full_name,
        faculty:    student.faculty  || '',
        major:      student.major    || '',
        year:       String(student.year || ''),
        photo_url:  student.photo_url || '',
    });
};

export default client;
