// database/migrate_dean_role.js
// เพิ่ม 'dean' เข้า CHECK constraint ของ users.role
import { query } from '../src/api/db.js';

async function migrate() {
    console.log('Running migrate_dean_role...');
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await query(`ALTER TABLE users ADD CONSTRAINT users_role_check
                 CHECK (role IN ('superadmin','admin','staff','dean'))`);
    console.log('✅ users_role_check updated to include dean');
    process.exit(0);
}

migrate().catch(err => { console.error(err.message); process.exit(1); });
