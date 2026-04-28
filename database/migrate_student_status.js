// migrate_student_status.js — เพิ่ม student_status ใน nbu_students และ nbu_activity_targets
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

        // เพิ่ม student_status ใน nbu_students (ตัวเลข เช่น 10=ปกติ, 11, 12)
        await client.query(`
            ALTER TABLE nbu_students
            ADD COLUMN IF NOT EXISTS student_status VARCHAR(20) DEFAULT ''
        `);

        // เพิ่ม student_status ใน nbu_activity_targets (เงื่อนไขกลุ่มเป้าหมาย)
        await client.query(`
            ALTER TABLE nbu_activity_targets
            ADD COLUMN IF NOT EXISTS student_status VARCHAR(20)
        `);

        // index สำหรับ filter ตาม student_status
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_nbu_students_status
            ON nbu_students (student_status)
        `);

        await client.query('COMMIT');
        console.log('✅ migrate_student_status สำเร็จ');
        console.log('   - เพิ่ม student_status ใน nbu_students');
        console.log('   - เพิ่ม student_status ใน nbu_activity_targets');
        console.log('   - สร้าง index idx_nbu_students_status');
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
