// database/migrate_stats.js
// เพิ่ม faculty_scope ให้ตาราง users สำหรับ role 'dean'
import { query } from '../src/api/db.js';

async function migrate() {
    console.log('Running migrate_stats...');

    await query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS faculty_scope VARCHAR(100)
    `);
    console.log('✅ Added faculty_scope column to users');

    console.log('✅ migrate_stats complete');
    process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
