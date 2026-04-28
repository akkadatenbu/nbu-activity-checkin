// migrate_targets_v2.js — เพิ่ม major และ study_plan ใน nbu_activity_targets
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

        await client.query(`
            ALTER TABLE nbu_activity_targets
            ADD COLUMN IF NOT EXISTS major      VARCHAR(200),
            ADD COLUMN IF NOT EXISTS study_plan VARCHAR(100)
        `);

        await client.query('COMMIT');
        console.log('✅ migrate_targets_v2 สำเร็จ');
        console.log('   - เพิ่ม major ใน nbu_activity_targets');
        console.log('   - เพิ่ม study_plan ใน nbu_activity_targets');
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
