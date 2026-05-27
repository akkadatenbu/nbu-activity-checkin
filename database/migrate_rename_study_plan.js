// migrate_rename_study_plan.js — เปลี่ยนชื่อ column study_plan → program
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

        await client.query(`ALTER TABLE nbu_students         RENAME COLUMN study_plan TO program`);
        await client.query(`ALTER TABLE nbu_activity_targets RENAME COLUMN study_plan TO program`);

        await client.query('COMMIT');
        console.log('✅ migrate_rename_study_plan สำเร็จ');
        console.log('   - nbu_students.study_plan         → program');
        console.log('   - nbu_activity_targets.study_plan → program');
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
