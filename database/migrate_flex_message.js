// database/migrate_flex_message.js
// เพิ่ม flex_message_json JSONB ใน nbu_activities
// รันซ้ำได้ (idempotent) — ใช้ ADD COLUMN IF NOT EXISTS

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query(`
            ALTER TABLE nbu_activities
            ADD COLUMN IF NOT EXISTS flex_message_json JSONB DEFAULT NULL
        `);
        console.log('✅ เพิ่ม flex_message_json ใน nbu_activities สำเร็จ');
    } catch (err) {
        console.error('❌ migration ล้มเหลว:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
