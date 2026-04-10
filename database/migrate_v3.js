// database/migrate_v3.js
// เพิ่ม FK constraints, indexes, views, triggers สำหรับตาราง nbu_* ที่ถูก rename มา
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      false,
});

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ─── 1. FK constraints on nbu_activities ─────────────────────────────
        await client.query(`
            ALTER TABLE nbu_activities
                DROP CONSTRAINT IF EXISTS nbu_activities_created_by_fkey
        `);
        await client.query(`
            ALTER TABLE nbu_activities
                ADD CONSTRAINT nbu_activities_created_by_fkey
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        `);
        console.log('✅ FK: nbu_activities → users');

        // ─── 2. FK constraints on nbu_activity_staff ─────────────────────────
        await client.query(`
            ALTER TABLE nbu_activity_staff
                DROP CONSTRAINT IF EXISTS nbu_activity_staff_activity_id_fkey,
                DROP CONSTRAINT IF EXISTS nbu_activity_staff_user_id_fkey
        `);
        await client.query(`
            ALTER TABLE nbu_activity_staff
                ADD CONSTRAINT nbu_activity_staff_activity_id_fkey
                    FOREIGN KEY (activity_id) REFERENCES nbu_activities(id) ON DELETE CASCADE,
                ADD CONSTRAINT nbu_activity_staff_user_id_fkey
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        `);
        console.log('✅ FK: nbu_activity_staff → nbu_activities, users');

        // ─── 3. FK constraints on nbu_sessions ───────────────────────────────
        await client.query(`
            ALTER TABLE nbu_sessions
                DROP CONSTRAINT IF EXISTS nbu_sessions_activity_id_fkey,
                DROP CONSTRAINT IF EXISTS nbu_sessions_opened_by_fkey,
                DROP CONSTRAINT IF EXISTS nbu_sessions_closed_by_fkey
        `);
        await client.query(`
            ALTER TABLE nbu_sessions
                ADD CONSTRAINT nbu_sessions_activity_id_fkey
                    FOREIGN KEY (activity_id) REFERENCES nbu_activities(id) ON DELETE CASCADE,
                ADD CONSTRAINT nbu_sessions_opened_by_fkey
                    FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL,
                ADD CONSTRAINT nbu_sessions_closed_by_fkey
                    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
        `);
        console.log('✅ FK: nbu_sessions → nbu_activities, users');

        // ─── 4. FK constraints on nbu_attendance ─────────────────────────────
        await client.query(`
            ALTER TABLE nbu_attendance
                DROP CONSTRAINT IF EXISTS nbu_attendance_activity_id_fkey,
                DROP CONSTRAINT IF EXISTS nbu_attendance_session_id_fkey,
                DROP CONSTRAINT IF EXISTS nbu_attendance_student_id_fkey,
                DROP CONSTRAINT IF EXISTS nbu_attendance_checked_by_fkey
        `);
        await client.query(`
            ALTER TABLE nbu_attendance
                ADD CONSTRAINT nbu_attendance_activity_id_fkey
                    FOREIGN KEY (activity_id) REFERENCES nbu_activities(id) ON DELETE CASCADE,
                ADD CONSTRAINT nbu_attendance_session_id_fkey
                    FOREIGN KEY (session_id) REFERENCES nbu_sessions(id) ON DELETE SET NULL,
                ADD CONSTRAINT nbu_attendance_student_id_fkey
                    FOREIGN KEY (student_id) REFERENCES nbu_students(student_id) ON DELETE CASCADE,
                ADD CONSTRAINT nbu_attendance_checked_by_fkey
                    FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL
        `);
        console.log('✅ FK: nbu_attendance → nbu_activities, nbu_sessions, nbu_students, users');

        // ─── 5. Indexes ───────────────────────────────────────────────────────
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_attendance_activity   ON nbu_attendance(activity_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_attendance_student    ON nbu_attendance(student_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_attendance_session    ON nbu_attendance(session_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_sessions_activity     ON nbu_sessions(activity_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_activity_staff_act    ON nbu_activity_staff(activity_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_activity_staff_user   ON nbu_activity_staff(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nbu_students_faculty      ON nbu_students(faculty)`);
        console.log('✅ Indexes created');

        // ─── 6. updated_at trigger for nbu_activities ────────────────────────
        await client.query(`
            CREATE OR REPLACE FUNCTION fn_set_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
            $$ LANGUAGE plpgsql
        `);

        await client.query(`DROP TRIGGER IF EXISTS trg_nbu_activities_updated_at ON nbu_activities`);
        await client.query(`
            CREATE TRIGGER trg_nbu_activities_updated_at
            BEFORE UPDATE ON nbu_activities
            FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()
        `);

        await client.query(`DROP TRIGGER IF EXISTS trg_nbu_students_updated_at ON nbu_students`);
        await client.query(`
            CREATE TRIGGER trg_nbu_students_updated_at
            BEFORE UPDATE ON nbu_students
            FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()
        `);
        console.log('✅ updated_at triggers created');

        // ─── 7. View: nbu_v_activity_summary ─────────────────────────────────
        await client.query(`DROP VIEW IF EXISTS nbu_v_activity_summary`);
        await client.query(`
            CREATE VIEW nbu_v_activity_summary AS
            SELECT
                a.id,
                a.title,
                a.start_datetime,
                a.end_datetime,
                a.location,
                a.activity_type,
                a.max_participants,
                a.is_active,
                COUNT(DISTINCT att.student_id) AS total_attended,
                u.full_name AS created_by_name
            FROM nbu_activities a
            LEFT JOIN nbu_attendance att ON att.activity_id = a.id
            LEFT JOIN users u ON u.id = a.created_by
            GROUP BY a.id, u.full_name
        `);
        console.log('✅ View: nbu_v_activity_summary');

        // ─── 8. View: nbu_v_attendance_detail ────────────────────────────────
        await client.query(`DROP VIEW IF EXISTS nbu_v_attendance_detail`);
        await client.query(`
            CREATE VIEW nbu_v_attendance_detail AS
            SELECT
                att.id,
                att.activity_id,
                att.session_id,
                att.student_id,
                att.checked_at,
                att.method,
                att.note,
                s.full_name    AS student_name,
                s.faculty,
                s.major,
                s.level,
                s.study_duration,
                s.study_period,
                s.study_plan,
                s.loan_status,
                s.photo_url,
                u.full_name    AS checked_by_name,
                a.title        AS activity_title
            FROM nbu_attendance att
            JOIN nbu_students s   ON s.student_id   = att.student_id
            JOIN nbu_activities a ON a.id           = att.activity_id
            LEFT JOIN users u     ON u.id           = att.checked_by
        `);
        console.log('✅ View: nbu_v_attendance_detail');

        await client.query('COMMIT');
        console.log('\n✅ migrate_v3 completed successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
