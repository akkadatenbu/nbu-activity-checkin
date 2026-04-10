-- NBU Activity Attendance System
-- PostgreSQL Schema
-- Database: nbu-actmenu

-- ─────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- users — admin / staff ที่ login เข้าระบบ
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    full_name     VARCHAR(200) NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('superadmin', 'admin', 'staff')),
    is_active     BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

-- ─────────────────────────────────────────────
-- students — นำเข้าจาก CSV (ข้อมูลหลักจาก intranet)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
    student_id     VARCHAR(20)  PRIMARY KEY,
    full_name      VARCHAR(200) NOT NULL,
    faculty        VARCHAR(200) DEFAULT '',
    major          VARCHAR(200) DEFAULT '',
    level          VARCHAR(100) DEFAULT '',   -- ระดับ เช่น ปริญญาตรี, ปริญญาโท
    study_duration VARCHAR(100) DEFAULT '',   -- ระยะเวลาเรียน เช่น 4 ปี
    study_period   VARCHAR(100) DEFAULT '',   -- ช่วงเวลาเรียน เช่น ภาคปกติ, เสาร์-อาทิตย์
    study_plan     VARCHAR(100) DEFAULT '',   -- แผนการเรียน เช่น แผน ก, แผน ข
    loan_status    VARCHAR(100) DEFAULT '',   -- สถานะกู้ยืม เช่น กู้ยืม, ไม่กู้ยืม
    photo_url      VARCHAR(500) DEFAULT '',   -- local thumbnail path
    line_uuid      VARCHAR(100) DEFAULT '',   -- LINE UUID (จากระบบ LINE OA มหาลัย)
    imported_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_faculty    ON students(faculty);
CREATE INDEX IF NOT EXISTS idx_students_level      ON students(level);
CREATE INDEX IF NOT EXISTS idx_students_line_uuid  ON students(line_uuid);
CREATE INDEX IF NOT EXISTS idx_students_name       ON students USING gin(to_tsvector('simple', full_name));

-- ─────────────────────────────────────────────
-- activities — กิจกรรม
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            VARCHAR(300) NOT NULL,
    description      TEXT         DEFAULT '',
    location         VARCHAR(300) DEFAULT '',
    activity_type    VARCHAR(100) DEFAULT 'general',
    start_datetime   TIMESTAMPTZ  NOT NULL,
    end_datetime     TIMESTAMPTZ  NOT NULL,
    max_participants INTEGER      DEFAULT 0,   -- 0 = ไม่จำกัด
    is_active        BOOLEAN      NOT NULL DEFAULT true,
    created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_start    ON activities(start_datetime);
CREATE INDEX IF NOT EXISTS idx_activities_active   ON activities(is_active);
CREATE INDEX IF NOT EXISTS idx_activities_created  ON activities(created_by);

-- ─────────────────────────────────────────────
-- activity_staff — อาจารย์/เจ้าหน้าที่ที่รับผิดชอบกิจกรรม
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_staff (
    activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id)      ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, user_id)
);

-- ─────────────────────────────────────────────
-- sessions — การเปิด/ปิด เช็คชื่อแต่ละครั้ง
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id UUID        NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    opened_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ,
    closed_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closed')),
    note        TEXT        DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(activity_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions(status);

-- ─────────────────────────────────────────────
-- attendance — บันทึกการเข้าร่วมกิจกรรม (หัวใจหลัก)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id  UUID        NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    session_id   UUID        REFERENCES sessions(id) ON DELETE SET NULL,
    student_id   VARCHAR(20) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    method       VARCHAR(20) NOT NULL DEFAULT 'qr_scan'
                 CHECK (method IN ('qr_scan', 'manual')),
    note         TEXT        DEFAULT '',
    UNIQUE (activity_id, student_id)   -- เช็คชื่อซ้ำไม่ได้
);

CREATE INDEX IF NOT EXISTS idx_attendance_activity  ON attendance(activity_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student   ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_checked   ON attendance(checked_at);
CREATE INDEX IF NOT EXISTS idx_attendance_session   ON attendance(session_id);

-- ─────────────────────────────────────────────
-- Views — สำหรับ dashboard / report
-- ─────────────────────────────────────────────

-- สรุปจำนวนผู้เข้าร่วมต่อกิจกรรม
CREATE OR REPLACE VIEW v_activity_summary AS
SELECT
    a.id,
    a.title,
    a.location,
    a.start_datetime,
    a.end_datetime,
    a.max_participants,
    a.is_active,
    COUNT(att.id)  AS total_attended,
    u.full_name    AS created_by_name
FROM activities a
LEFT JOIN attendance att ON att.activity_id = a.id
LEFT JOIN users u        ON u.id = a.created_by
GROUP BY a.id, u.full_name;

-- รายชื่อผู้เข้าร่วมพร้อมข้อมูลนักศึกษา
CREATE OR REPLACE VIEW v_attendance_detail AS
SELECT
    att.id,
    att.activity_id,
    att.student_id,
    s.full_name      AS student_name,
    s.faculty,
    s.major,
    s.level,
    s.study_duration,
    s.study_period,
    s.study_plan,
    s.loan_status,
    s.photo_url,
    att.checked_at,
    att.method,
    u.full_name      AS checked_by_name
FROM attendance att
JOIN students s        ON s.student_id = att.student_id
LEFT JOIN users u      ON u.id = att.checked_by;

-- ─────────────────────────────────────────────
-- Updated_at trigger
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at      ON users;
DROP TRIGGER IF EXISTS trg_students_updated_at   ON students;
DROP TRIGGER IF EXISTS trg_activities_updated_at ON activities;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_activities_updated_at
    BEFORE UPDATE ON activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
