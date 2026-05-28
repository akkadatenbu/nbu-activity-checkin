// database/migrate_targets_multiselect.js
// เปลี่ยน 8 columns ใน nbu_activity_targets จาก TEXT/VARCHAR → TEXT[]
// เพื่อรองรับ multi-select กลุ่มเป้าหมาย
// รันซ้ำได้ (idempotent) — ตรวจสอบ data_type ก่อนแปลงเสมอ

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

const COLUMNS = ['faculty', 'year', 'level', 'major', 'program', 'student_status', 'international', 'campus'];

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const col of COLUMNS) {
            // ตรวจสอบ type ปัจจุบัน
            const { rows } = await client.query(`
                SELECT data_type, udt_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name   = 'nbu_activity_targets'
                  AND column_name  = $1
            `, [col]);

            if (!rows.length) {
                console.log(`⚠️  column "${col}" ไม่พบใน nbu_activity_targets — ข้าม`);
                continue;
            }

            const { data_type } = rows[0];

            if (data_type === 'ARRAY') {
                console.log(`✅ "${col}" เป็น TEXT[] อยู่แล้ว — ข้าม`);
                continue;
            }

            // แปลงเป็น TEXT[] โดย wrap ค่าเดิมไว้ใน array (หรือ NULL ถ้าว่าง)
            await client.query(`
                ALTER TABLE nbu_activity_targets
                ALTER COLUMN ${col} TYPE TEXT[]
                USING CASE
                    WHEN ${col} IS NULL           THEN NULL
                    WHEN ${col}::text = ''        THEN NULL
                    ELSE ARRAY[${col}::text]
                END
            `);
            console.log(`🔄 แปลง "${col}" ${data_type} → TEXT[] สำเร็จ`);
        }

        await client.query('COMMIT');
        console.log('\n✅ migrate_targets_multiselect เสร็จสิ้น');
        console.log('   nbu_activity_targets ทุก column เป็น TEXT[] แล้ว');
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
