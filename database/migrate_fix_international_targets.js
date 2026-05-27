// migrate_fix_international_targets.js
// แก้ปัญหา: international column ใน nbu_activity_targets อาจเป็น BOOLEAN
// ทำให้ INSERT string เช่น "หลักสูตรไทย" → error 500
// Script นี้ force convert BOOLEAN → VARCHAR(50) ถ้าจำเป็น
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
        // ตรวจสอบ data_type ปัจจุบันของ column international ก่อน
        const { rows: colInfo } = await client.query(`
            SELECT data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'nbu_activity_targets'
              AND column_name = 'international'
        `);

        if (colInfo.length === 0) {
            console.log('ℹ️  ไม่พบ column international ใน nbu_activity_targets — จะสร้างใหม่');
        } else {
            console.log(`ℹ️  international column ปัจจุบัน: type=${colInfo[0].data_type}, max_length=${colInfo[0].character_maximum_length}`);
        }

        await client.query('BEGIN');

        await client.query(`
            DO $$
            DECLARE
                col_type TEXT;
            BEGIN
                -- ดึง data_type ปัจจุบัน
                SELECT data_type INTO col_type
                FROM information_schema.columns
                WHERE table_name = 'nbu_activity_targets'
                  AND column_name = 'international';

                IF col_type IS NULL THEN
                    -- ยังไม่มี column → ADD ใหม่
                    ALTER TABLE nbu_activity_targets
                        ADD COLUMN international VARCHAR(50);
                    RAISE NOTICE 'เพิ่ม international VARCHAR(50) ใหม่';

                ELSIF col_type = 'boolean' THEN
                    -- เป็น BOOLEAN → convert เป็น VARCHAR(50)
                    ALTER TABLE nbu_activity_targets
                        ALTER COLUMN international TYPE VARCHAR(50)
                        USING CASE
                            WHEN international IS NULL  THEN NULL
                            WHEN international = true   THEN 'หลักสูตรนานาชาติ'
                            ELSE ''
                        END;
                    RAISE NOTICE 'แปลง international BOOLEAN → VARCHAR(50) สำเร็จ';

                ELSIF col_type IN ('character varying', 'text') THEN
                    RAISE NOTICE 'international เป็น % อยู่แล้ว — ไม่ต้องแก้ไข', col_type;

                ELSE
                    -- type อื่น (เช่น integer) → force convert ด้วย CAST
                    ALTER TABLE nbu_activity_targets
                        ALTER COLUMN international TYPE VARCHAR(50)
                        USING international::VARCHAR(50);
                    RAISE NOTICE 'แปลง international % → VARCHAR(50) สำเร็จ', col_type;
                END IF;
            END
            $$
        `);

        await client.query('COMMIT');

        // ตรวจสอบ type หลัง migrate
        const { rows: after } = await client.query(`
            SELECT data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'nbu_activity_targets'
              AND column_name = 'international'
        `);
        if (after.length > 0) {
            console.log(`✅ หลัง migrate: international = ${after[0].data_type}(${after[0].character_maximum_length})`);
        }
        console.log('✅ migrate_fix_international_targets สำเร็จ');

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
