// migrate_fix_types.js — แก้ data type ของ column ที่ผิด
//   1. nbu_students.international  : boolean  → VARCHAR(50)
//   2. nbu_students.student_status : VARCHAR  → INTEGER
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

        // ── 1. international : boolean → VARCHAR(50) ────────────────────────
        // แปลงค่าเดิม: true → 'หลักสูตรนานาชาติ', false/null → ''
        await client.query(`
            ALTER TABLE nbu_students
            ALTER COLUMN international
            TYPE VARCHAR(50)
            USING CASE WHEN international = true THEN 'หลักสูตรนานาชาติ' ELSE '' END
        `);
        // เปลี่ยน DEFAULT จาก false → ''
        await client.query(`
            ALTER TABLE nbu_students
            ALTER COLUMN international SET DEFAULT ''
        `);

        // ── 2. student_status : VARCHAR → INTEGER ───────────────────────────
        // แปลงค่าเดิม: '10','20','40' → 10,20,40 / '' หรือ NULL → NULL
        await client.query(`
            ALTER TABLE nbu_students
            ALTER COLUMN student_status
            TYPE INTEGER
            USING NULLIF(TRIM(student_status), '')::integer
        `);
        // เปลี่ยน DEFAULT จาก '' → NULL (integer ไม่ใช้ empty string)
        await client.query(`
            ALTER TABLE nbu_students
            ALTER COLUMN student_status DROP DEFAULT
        `);

        await client.query('COMMIT');
        console.log('✅ migrate_fix_types สำเร็จ');
        console.log('   - international : boolean  → VARCHAR(50)  (true→\'หลักสูตรนานาชาติ\', false→\'\')');
        console.log('   - student_status: VARCHAR  → INTEGER      (\'\'/NULL → NULL)');
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
