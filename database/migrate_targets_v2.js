// database/migrate_targets_v2.js
// 1. เพิ่ม level column ใน nbu_activity_targets
// 2. สร้างตาราง nbu_activity_target_students (import รายชื่อเฉพาะกิจกรรม)
import { query } from '../src/api/db.js';

async function migrate() {
    console.log('Running migrate_targets_v2...');

    // เพิ่ม level column (ถ้ายังไม่มี)
    await query(`
        ALTER TABLE nbu_activity_targets
        ADD COLUMN IF NOT EXISTS level VARCHAR(50) DEFAULT NULL
    `);
    console.log('✅ level column added to nbu_activity_targets');

    // ปรับ UNIQUE constraint ให้รวม level ด้วย
    await query(`ALTER TABLE nbu_activity_targets DROP CONSTRAINT IF EXISTS nbu_activity_targets_activity_id_faculty_year_key`);
    await query(`
        ALTER TABLE nbu_activity_targets
        ADD CONSTRAINT nbu_activity_targets_unique
        UNIQUE (activity_id, faculty, year, level)
    `);
    console.log('✅ UNIQUE constraint updated');

    // ตาราง import รายชื่อนักศึกษาเป้าหมาย
    await query(`
        CREATE TABLE IF NOT EXISTS nbu_activity_target_students (
            id          SERIAL PRIMARY KEY,
            activity_id UUID         NOT NULL,
            student_id  VARCHAR(20)  NOT NULL,
            imported_at TIMESTAMPTZ  DEFAULT NOW(),
            UNIQUE (activity_id, student_id)
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_act_tgt_stu ON nbu_activity_target_students(activity_id)`);
    console.log('✅ nbu_activity_target_students created');

    process.exit(0);
}

migrate().catch(err => { console.error(err.message); process.exit(1); });
