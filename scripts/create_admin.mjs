// scripts/create_admin.mjs — สร้าง superadmin user เริ่มต้น
import 'dotenv/config';
import bcrypt from 'bcrypt';
import pg from 'pg';

const pool = new pg.Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

const username  = process.argv[2] || 'admin';
const password  = process.argv[3] || 'Admin@NBU2026';
const full_name = process.argv[4] || 'ผู้ดูแลระบบ';
const role      = process.argv[5] || 'superadmin';

const hash = await bcrypt.hash(password, 12);

await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
     SET password_hash = $2, full_name = $3, role = $4`,
    [username, hash, full_name, role]
);

console.log(`Created user: ${username} / ${password} (${role})`);
await pool.end();
