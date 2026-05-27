// migrate_academic_year.js
// เพิ่ม academic_year และ semester ใน nbu_activities
// Safe/idempotent — รันซ้ำได้
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

        // 1. เพิ่ม academic_year (พ.ศ. เช่น 2567)
        await client.query(`
            ALTER TABLE nbu_activities
            ADD COLUMN IF NOT EXISTS academic_year SMALLINT
        `);

        // 2. เพิ่ม semester (1=ภาค1, 2=ภาค2, 3=ภาคฤดูร้อน)
        await client.query(`
            ALTER TABLE nbu_activities
            ADD COLUMN IF NOT EXISTS semester SMALLINT
        `);

        // 3. สร้าง index เพื่อเพิ่มความเร็วการกรองตามปี/เทอม
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_nbu_activities_academic
            ON nbu_activities(academic_year, semester)
        `);

        await client.query('COMMIT');
        console.log('✅ migrate_academic_year สำเร็จ');
        console.log('   - academic_year SMALLINT → ok');
        console.log('   - semester SMALLINT → ok');
        console.log('   - index idx_nbu_activities_academic → ok');
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
