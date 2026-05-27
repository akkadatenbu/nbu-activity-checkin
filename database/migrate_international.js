// migrate_international.js — เพิ่ม international (VARCHAR) และ campus ใน nbu_students + international ใน nbu_activity_targets
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

        // เพิ่ม international ใน nbu_students
        // ค่าที่เก็บ: 'หลักสูตรไทย' | 'หลักสูตรนานาชาติ' | '' (ไม่ระบุ)
        await client.query(`
            ALTER TABLE nbu_students
            ADD COLUMN IF NOT EXISTS international VARCHAR(50) NOT NULL DEFAULT ''
        `);

        // เพิ่ม international ใน nbu_activity_targets (เงื่อนไขกลุ่มเป้าหมาย)
        // ค่าที่เก็บ: 'หลักสูตรไทย' | 'หลักสูตรนานาชาติ' | NULL (ไม่กรอง = ทั้งหมด)
        await client.query(`
            ALTER TABLE nbu_activity_targets
            ADD COLUMN IF NOT EXISTS international VARCHAR(50)
        `);

        // เพิ่ม campus (วิทยาเขต) ใน nbu_students
        // เช่น 'รังสิต', 'โคราช', 'กรุงเทพ' ฯลฯ
        await client.query(`
            ALTER TABLE nbu_students
            ADD COLUMN IF NOT EXISTS campus VARCHAR(100) NOT NULL DEFAULT ''
        `);

        // index เพื่อ filter ตาม international และ campus ได้เร็ว
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_nbu_students_international
            ON nbu_students (international)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_nbu_students_campus
            ON nbu_students (campus)
        `);

        await client.query('COMMIT');
        console.log('✅ migrate_international สำเร็จ');
        console.log('   - เพิ่ม international (VARCHAR(50) DEFAULT \'\') ใน nbu_students');
        console.log('   - เพิ่ม international (VARCHAR(50) nullable) ใน nbu_activity_targets');
        console.log('   - เพิ่ม campus (VARCHAR DEFAULT \'\') ใน nbu_students');
        console.log('   - สร้าง index idx_nbu_students_international');
        console.log('   - สร้าง index idx_nbu_students_campus');
        console.log('');
        console.log('📝 หมายเหตุ: ต้อง update ข้อมูลนักศึกษาต่างชาติด้วยมือหรือผ่าน import script');
        console.log('   ตัวอย่าง: UPDATE nbu_students SET international = true WHERE student_id IN (...)');
        console.log('   ตัวอย่าง: UPDATE nbu_students SET campus = \'รังสิต\' WHERE faculty IN (...)');
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
