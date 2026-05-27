// migrate_campus_target.js — เพิ่ม campus ใน nbu_activity_targets
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
        await client.query('BEGIN');

        // เพิ่ม campus ใน nbu_activity_targets (เงื่อนไขกลุ่มเป้าหมาย)
        // NULL = ไม่กรองวิทยาเขต (ทั้งหมด), มีค่า = กรองตามวิทยาเขต
        await client.query(`
            ALTER TABLE nbu_activity_targets
            ADD COLUMN IF NOT EXISTS campus VARCHAR(100)
        `);

        await client.query('COMMIT');
        console.log('✅ migrate_campus_target สำเร็จ');
        console.log('   - เพิ่ม campus (VARCHAR(100) nullable) ใน nbu_activity_targets');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ migration ล้มเหลว:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
