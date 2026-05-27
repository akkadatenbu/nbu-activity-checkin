// migrate_targets_complete.js
// Safe/idempotent — รันซ้ำกี่ครั้งก็ได้
// ตรวจสอบและเพิ่ม/แก้ไข columns ใน nbu_activity_targets ให้ครบ:
//   - international VARCHAR(50)
//   - campus       VARCHAR(100)
//   - program      (rename จาก study_plan ถ้ายังไม่ได้ rename)
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

        // 1. เพิ่ม international (ถ้ายังไม่มี)
        await client.query(`
            ALTER TABLE nbu_activity_targets
            ADD COLUMN IF NOT EXISTS international VARCHAR(50)
        `);

        // 2. เพิ่ม campus (ถ้ายังไม่มี)
        await client.query(`
            ALTER TABLE nbu_activity_targets
            ADD COLUMN IF NOT EXISTS campus VARCHAR(100)
        `);

        // 3. rename study_plan → program
        //    ทำแบบ conditional: ถ้า study_plan อยู่ และ program ยังไม่มี → rename
        //    ถ้า program มีอยู่แล้ว → ข้ามไป (ไม่ error)
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'nbu_activity_targets'
                      AND column_name = 'study_plan'
                ) AND NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'nbu_activity_targets'
                      AND column_name = 'program'
                ) THEN
                    ALTER TABLE nbu_activity_targets RENAME COLUMN study_plan TO program;
                    RAISE NOTICE 'renamed study_plan → program';
                ELSE
                    RAISE NOTICE 'program column already exists or study_plan not found — skipped rename';
                END IF;
            END
            $$
        `);

        await client.query('COMMIT');

        console.log('✅ migrate_targets_complete สำเร็จ');
        console.log('   - international VARCHAR(50) → ok');
        console.log('   - campus        VARCHAR(100) → ok');
        console.log('   - study_plan → program (ถ้าจำเป็น) → ok');
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
