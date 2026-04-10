// database/migrate.js — รัน schema.sql สร้างตาราง
import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

try {
    await pool.query(sql);
    console.log('✅ Migration สำเร็จ — ตาราง/views/triggers พร้อมแล้ว');
} catch (err) {
    console.error('❌ Migration error:', err.message);
} finally {
    await pool.end();
}
