// database/migrate_v2.js
// เพิ่มคอลัมน์ใหม่ในตาราง students + ลบ year
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const migrations = [
    // ลบ view ที่อ้างอิง year ก่อน (จะสร้างใหม่ด้านล่าง)
    `DROP VIEW IF EXISTS v_attendance_detail`,
    `DROP INDEX IF EXISTS idx_students_year`,

    // ลบ year
    `ALTER TABLE students DROP COLUMN IF EXISTS year`,

    // เพิ่มคอลัมน์ใหม่ (ถ้ายังไม่มี)
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS level          VARCHAR(100) DEFAULT ''`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS study_duration VARCHAR(100) DEFAULT ''`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS study_period   VARCHAR(100) DEFAULT ''`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS study_plan     VARCHAR(100) DEFAULT ''`,
    `ALTER TABLE students ADD COLUMN IF NOT EXISTS loan_status    VARCHAR(100) DEFAULT ''`,

    // สร้าง index ใหม่
    `CREATE INDEX IF NOT EXISTS idx_students_level ON students(level)`,

    // สร้าง view ใหม่
    `CREATE OR REPLACE VIEW v_attendance_detail AS
     SELECT att.id, att.activity_id, att.student_id,
            s.full_name      AS student_name,
            s.faculty, s.major, s.level,
            s.study_duration, s.study_period, s.study_plan, s.loan_status,
            s.photo_url,
            att.checked_at, att.method,
            u.full_name      AS checked_by_name
     FROM attendance att
     JOIN students s        ON s.student_id = att.student_id
     LEFT JOIN users u      ON u.id = att.checked_by`,
];

const client = await pool.connect();
try {
    console.log('🔄 Running migrate_v2...');
    for (const sql of migrations) {
        await client.query(sql);
        console.log('  ✅', sql.substring(0, 70));
    }
    console.log('\n✅ migrate_v2 เสร็จสมบูรณ์');
} catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
} finally {
    client.release();
    await pool.end();
}
