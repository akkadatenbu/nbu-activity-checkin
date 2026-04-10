# ระบบบันทึกการเข้าร่วมกิจกรรม — NBU Activity Checkin

**มหาวิทยาลัยนอร์ทกรุงเทพ (North Bangkok University)**  
URL หลัก: `https://activity.northbkk.ac.th`

---

## 1. ภาพรวมระบบ

ระบบบันทึกการเข้าร่วมกิจกรรมของนักศึกษา ใช้ QR Code บนบัตรนักศึกษาสแกนเช็คชื่อหน้าประตู แสดงผลทันทีบน iPad และนักศึกษาดูประวัติตัวเองผ่าน LINE OA ของมหาวิทยาลัย

### ผู้ใช้งาน

| กลุ่ม | บทบาท |
|-------|-------|
| **Superadmin / Admin** | จัดการกิจกรรม, จัดการผู้ใช้, import นักศึกษา, ดู report ทั้งหมด |
| **Staff (อาจารย์)** | เปิด/ปิด session เช็คชื่อ, สแกน QR, ดู report เฉพาะกิจกรรมที่รับผิดชอบ |
| **นักศึกษา** | ดูประวัติการเข้าร่วมกิจกรรมตัวเองผ่าน LINE OA |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Framework | Express.js (ES Modules) |
| Primary DB | PostgreSQL (`nbu-actmenu` database) |
| Cache | Redis Cloud (SSL) |
| Auth | JWT + bcrypt |
| Process Manager | PM2 (root, id: 19) |
| Web Server | Nginx reverse proxy + SSL (Let's Encrypt) |
| LINE Integration | LINE Messaging API + LIFF 2.0 |
| Image Processing | sharp (resize thumbnail 120×120) |
| Report | ExcelJS (Excel export) |
| Alert UI | SweetAlert2 |
| Port | 5533 |

---

## 3. โครงสร้างไฟล์

```
nbu-activity-checkin/
├── server.js                        ← Entry point (Express app)
├── .env                             ← Environment variables
│
├── src/
│   ├── api/
│   │   ├── db.js                    ← PostgreSQL connection pool (pg)
│   │   ├── redis.js                 ← Redis client + getStudent/setStudent
│   │   ├── middleware/
│   │   │   └── auth.js              ← JWT verify middleware
│   │   ├── utils/
│   │   │   └── qr.js                ← QR HMAC verify (format|timestamp|hash)
│   │   └── routes/
│   │       ├── auth.js              ← POST /login, /logout
│   │       ├── activities.js        ← CRUD กิจกรรม + session open/close
│   │       ├── attendance.js        ← QR scan, manual checkin, ดูรายชื่อ
│   │       ├── students.js          ← ค้นหานักศึกษา
│   │       ├── import.js            ← Upload CSV → PostgreSQL + Redis
│   │       ├── reports.js           ← Excel export + dashboard stats
│   │       ├── users.js             ← CRUD ผู้ใช้งาน (admin/staff)
│   │       └── liff.js              ← API สำหรับ LINE LIFF app
│   │
│   ├── admin/
│   │   ├── index.html               ← Admin Panel (SPA: dashboard, กิจกรรม, รายงาน, ผู้ใช้)
│   │   └── import.html              ← หน้า import นักศึกษาจาก CSV
│   │
│   ├── scanner/
│   │   └── index.html               ← Scanner App (iPad) สแกน QR + manual checkin
│   │
│   ├── liff/
│   │   └── index.html               ← LINE LIFF: นักศึกษาดูประวัติกิจกรรมตัวเอง
│   │
│   └── line-oa/
│       └── webhook.js               ← LINE Messaging API webhook (รับข้อความ)
│
├── database/
│   ├── schema.sql                   ← DDL ตารางทั้งหมด
│   ├── migrate.js                   ← Migration v1
│   ├── migrate_v2.js                ← Migration v2 (เพิ่ม columns, drop year)
│   └── migrate_v3.js                ← Migration v3 (FK, indexes, views, triggers)
│
├── scripts/
│   ├── create_admin.mjs             ← สร้าง superadmin user
│   ├── deploy.py                    ← Deploy script (paramiko SSH)
│   └── import_students.py           ← Import CSV ผ่าน Python (legacy)
│
└── docs/
    ├── nginx.conf                   ← Nginx config ตัวอย่าง
    └── SYSTEM.md                    ← ไฟล์นี้
```

---

## 4. Database Schema

ตารางทั้งหมดใช้ prefix `nbu_` เพื่อป้องกัน conflict กับระบบ CRM เดิมใน database `nbu-actmenu`

### ตาราง nbu_students
```
student_id      VARCHAR PK     รหัสนักศึกษา (เช่น 671280108)
full_name       VARCHAR        ชื่อ-นามสกุล
faculty         VARCHAR        คณะ
major           VARCHAR        สาขา
level           VARCHAR        ระดับ (ปริญญาตรี, ปวส. ฯลฯ)
study_duration  VARCHAR        ระยะเวลาเรียน
study_period    VARCHAR        ช่วงเวลาเรียน
study_plan      VARCHAR        แผนการเรียน
loan_status     VARCHAR        สถานะกู้ยืม
photo_url       VARCHAR        path thumbnail (/thumbnails/รหัส.jpg)
updated_at      TIMESTAMP
```

### ตาราง nbu_activities
```
id              UUID PK
title           VARCHAR        ชื่อกิจกรรม
description     TEXT
location        VARCHAR        สถานที่
activity_type   VARCHAR        ประเภท (general ฯลฯ)
start_datetime  TIMESTAMP
end_datetime    TIMESTAMP
max_participants INT           จำนวนสูงสุด (0 = ไม่จำกัด)
created_by      UUID → users
is_active       BOOLEAN
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### ตาราง nbu_activity_staff
```
activity_id     UUID → nbu_activities (CASCADE)
user_id         UUID → users (CASCADE)
assigned_at     TIMESTAMP
```

### ตาราง nbu_sessions
```
id              UUID PK
activity_id     UUID → nbu_activities (CASCADE)
opened_by       UUID → users
opened_at       TIMESTAMP
closed_at       TIMESTAMP
closed_by       UUID → users
status          VARCHAR  'open' | 'closed'
```

### ตาราง nbu_attendance
```
id              UUID PK
activity_id     UUID → nbu_activities (CASCADE)
session_id      UUID → nbu_sessions (SET NULL)
student_id      VARCHAR → nbu_students (CASCADE)
checked_at      TIMESTAMP
checked_by      UUID → users
method          VARCHAR  'qr_scan' | 'manual'
note            TEXT
UNIQUE(activity_id, student_id)
```

### ตาราง users (ไม่มี prefix — ใช้ร่วมกับระบบอื่น)
```
id              UUID PK
username        VARCHAR UNIQUE
password_hash   VARCHAR
full_name       VARCHAR
role            VARCHAR  'superadmin' | 'admin' | 'staff'
is_active       BOOLEAN
created_at      TIMESTAMP
```

### ตาราง line_student_links (ของระบบ CRM เดิม)
```
line_user_id    VARCHAR        LINE userId
student_id      VARCHAR        รหัสนักศึกษา
```

### Views
| View | ใช้งาน |
|------|--------|
| `nbu_v_activity_summary` | ดึงกิจกรรม + จำนวนผู้เข้าร่วม + ชื่อผู้สร้าง |
| `nbu_v_attendance_detail` | ดึง attendance + ข้อมูลนักศึกษาครบทุก field |

### Redis Schema
```
KEY: student:{student_id}   TYPE: Hash
FIELDS: student_id, full_name, faculty, major, photo_url
```
ใช้สำหรับ QR scan เพื่อความเร็ว < 5ms

---

## 5. URL Endpoints

### Web Pages
| URL | หน้า |
|-----|------|
| `/admin` | Admin Panel (login + dashboard) |
| `/admin/import` | นำเข้านักศึกษาจาก CSV |
| `/scanner` | Scanner App สำหรับ iPad |
| `/liff` | LINE LIFF ประวัติกิจกรรมนักศึกษา |
| `/thumbnails/:รหัส.jpg` | รูปนักศึกษา (Nginx serve โดยตรง) |

### API `/api/v1`
| Method | Path | คำอธิบาย |
|--------|------|---------|
| POST | `/auth/login` | เข้าสู่ระบบ → JWT |
| POST | `/auth/logout` | ออกจากระบบ |
| GET | `/activities` | ดึงกิจกรรมทั้งหมด |
| POST | `/activities` | สร้างกิจกรรม |
| GET | `/activities/:id` | ดึงกิจกรรม + session ปัจจุบัน |
| PUT | `/activities/:id` | แก้ไขกิจกรรม |
| DELETE | `/activities/:id` | ลบกิจกรรม (CASCADE ลบ attendance ด้วย) |
| POST | `/activities/:id/session/open` | เปิด session เช็คชื่อ |
| POST | `/activities/:id/session/close` | ปิด session เช็คชื่อ |
| GET | `/activities/:id/sessions` | ดูประวัติ sessions |
| POST | `/attendance/scan` | บันทึกเช็คชื่อ QR |
| POST | `/attendance/manual` | บันทึกเช็คชื่อ manual |
| GET | `/attendance/:activityId` | รายชื่อผู้เข้าร่วม |
| DELETE | `/attendance/:id` | ลบรายการเช็คชื่อ |
| GET | `/students/search?q=` | ค้นหานักศึกษา |
| GET | `/reports/:activityId/excel` | Export Excel |
| GET | `/reports/dashboard` | สถิติ dashboard |
| POST | `/import/upload` | อัปโหลด CSV |
| POST | `/import/start` | เริ่ม import |
| GET | `/import/progress/:jobId` | ติดตาม progress (SSE) |
| GET | `/users` | รายชื่อ users |
| POST | `/users` | สร้าง user |
| PUT | `/users/:id` | แก้ไข user |
| DELETE | `/users/:id` | ลบ user |
| GET | `/liff/me` | ข้อมูลนักศึกษา (LINE token) |
| GET | `/liff/attendance` | ประวัติกิจกรรม (LINE token) |

### LINE Webhook
| Path | คำอธิบาย |
|------|---------|
| `/line/webhook` | รับ event จาก LINE OA |

---

## 6. Flow การทำงาน

### 6.1 QR Scan Flow (หลักของระบบ)

```
นักศึกษา           เครื่องสแกน        iPad (Scanner App)      Server              Redis / DB
    │                   │                    │                    │                    │
    │── ยื่นบัตร ──────►│                    │                    │                    │
    │                   │── ส่ง QR raw ──────►│                    │                    │
    │                   │  "671280108|       │                    │                    │
    │                   │   1775716100|      │                    │                    │
    │                   │   6dd426b0ff"      │                    │                    │
    │                   │                    │── POST /attendance/scan ───────────────►│
    │                   │                    │   {qr_raw, activity_id, session_id}    │
    │                   │                    │                    │── verifyQR() ──────│
    │                   │                    │                    │   (HMAC + expiry)  │
    │                   │                    │                    │── HGETALL ─────────►│ Redis
    │                   │                    │                    │◄── student data ───│ (< 5ms)
    │                   │                    │                    │── check session ───►│ DB
    │                   │                    │                    │── check duplicate ─►│ DB
    │                   │                    │                    │── INSERT attendance►│ DB (async)
    │                   │                    │◄── 200 + student ──│                    │
    │                   │                    │── แสดงรูป+ชื่อ ───►│                    │
    │                   │                    │   (สีเขียว 5s)     │                    │
    │                   │                    │── beep ────────────►│                    │
```

### 6.2 Import นักศึกษา Flow

```
Admin
  │
  ├─► อัปโหลด CSV (/admin/import)
  │       │
  │       ├─► parse CSV (รองรับ BOM + Thai + quoted fields)
  │       ├─► preview 5 แถวแรก + mapping columns
  │       └─► POST /import/start
  │               │
  │               ├─► Phase 1: ดาวน์โหลดรูปนักศึกษา (concurrent 10)
  │               │   URL: {PHOTO_BASE_URL}/{id[0:2]}/{id}.jpg
  │               │   resize → 120×120 JPEG → /public/thumbnails/{id}.jpg
  │               │
  │               ├─► Phase 2: INSERT INTO nbu_students (batch 200)
  │               │   ON CONFLICT DO UPDATE (upsert)
  │               │
  │               └─► Phase 3: Redis HSET student:{id} (batch 200)
  │                   fields: student_id, full_name, faculty, major, photo_url
  │
  └─► SSE progress stream → แสดง progress bar แบบ real-time
```

### 6.3 Session Management Flow

```
Staff/Admin
  │
  ├─► เลือกกิจกรรม (Scanner App)
  ├─► กด "เปิด Session" → POST /activities/:id/session/open
  │       └─► INSERT nbu_sessions (status='open')
  │
  ├─► [นักศึกษาเช็คชื่อได้] ─────────────────────────────── (ดู 6.1)
  │
  └─► กด "ปิด Session" → POST /activities/:id/session/close
          └─► UPDATE nbu_sessions SET status='closed'
              (หลังปิดแล้ว scan จะ error "session ปิดแล้ว")
```

### 6.4 LINE OA Flow

```
นักศึกษา (LINE)                LINE Platform              Server
    │                               │                        │
    │── พิมพ์ "กิจกรรม" ──────────►│                        │
    │                               │── POST /line/webhook ─►│
    │                               │                        │── verify HMAC signature
    │                               │                        │── หา student จาก line_student_links
    │                               │                        │── query nbu_attendance + nbu_activities
    │                               │                        │── สร้าง Flex Message
    │                               │◄── reply message ──────│
    │◄── แสดง Flex Message ─────────│                        │
    │   (ประวัติกิจกรรม carousel)   │                        │
```

### 6.5 LIFF Flow (LINE In-App Browser)

```
นักศึกษา (LINE App)                    Server
    │                                      │
    │── เปิด LIFF URL ─────────────────────│
    │── liff.init() + liff.login() ────────│
    │── liff.getAccessToken() ─────────────│
    │── GET /api/v1/liff/me?token=... ─────►│
    │                                      │── verify token กับ LINE Profile API
    │                                      │── JOIN nbu_students + line_student_links
    │◄── student info + stats ─────────────│
    │── แสดงหน้าประวัติกิจกรรม ────────────│
    │── GET /api/v1/liff/attendance ────────►│
    │◄── รายการกิจกรรม (page 20) ───────────│
```

---

## 7. Permission Matrix

| Feature | superadmin | admin | staff |
|---------|:---------:|:-----:|:-----:|
| สร้าง/แก้ไข/ลบกิจกรรม | ✅ | ✅ | ❌ |
| มอบหมาย staff | ✅ | ✅ | ❌ |
| เปิด/ปิด session | ✅ | ✅ | ✅ (เฉพาะที่รับผิดชอบ) |
| สแกน QR / manual | ✅ | ✅ | ✅ |
| ดูรายชื่อผู้เข้าร่วม | ✅ | ✅ | ✅ (เฉพาะที่รับผิดชอบ) |
| Export Excel | ✅ | ✅ | ✅ (เฉพาะที่รับผิดชอบ) |
| Import นักศึกษา | ✅ | ✅ | ❌ |
| จัดการ users | ✅ | ✅ | ❌ |
| ดู dashboard ทุกกิจกรรม | ✅ | ✅ | ❌ |

---

## 8. Infrastructure

```
Internet
    │
    ▼
Nginx (443/SSL)  activity.northbkk.ac.th
    │
    ├── /thumbnails/ ──► /var/www/app/nbu-activity-checkin/public/thumbnails/
    │                    (Nginx serve static โดยตรง, expires 7d)
    │
    └── / ─────────────► proxy_pass http://127.0.0.1:5533
                              │
                              ▼
                         Node.js Express (PM2 id:19, root)
                              │
                         ┌────┴────────────────────┐
                         ▼                         ▼
                   PostgreSQL                  Redis Cloud
                  (nbu-actmenu)               (ap-southeast-1)
                  147.50.10.29:5432           SSL port 10109
```

### Environment Variables สำคัญ
```env
DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
REDIS_HOST / REDIS_PORT / REDIS_PASSWORD
JWT_SECRET / JWT_EXPIRES_IN=8h
LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET
QR_SECRET                      ← ใช้ verify HMAC ของ QR บัตรนักศึกษา
PHOTO_BASE_URL                 ← https://reg.northbkk.ac.th/studentimg
THUMBNAIL_DIR                  ← /var/www/app/nbu-activity-checkin/public/thumbnails
```

---

## 9. QR Code Format

QR บนบัตรนักศึกษาของ NBU มีรูปแบบ:
```
{student_id}|{unix_timestamp}|{hmac_hex}
ตัวอย่าง: 671280108|1775716100|6dd426b0ff3fcf28
```

- `student_id` — รหัสนักศึกษา
- `unix_timestamp` — เวลาที่ QR ถูกสร้าง (ใช้ตรวจ expiry)
- `hmac_hex` — HMAC-SHA256 ของ `{student_id}|{timestamp}` ด้วย `QR_SECRET`

Server ตรวจสอบ: format ถูกต้อง → HMAC ตรง → ไม่หมดอายุ → เช็คชื่อได้

---

## 10. Student Photo URL

```
รหัสนักศึกษา: 671280108
URL ต้นทาง:   https://reg.northbkk.ac.th/studentimg/67/671280108.jpg
Pattern:      {PHOTO_BASE_URL}/{student_id[0:2]}/{student_id}.jpg

Thumbnail:    resize 120×120 JPEG
เก็บที่:      /var/www/app/nbu-activity-checkin/public/thumbnails/671280108.jpg
Serve URL:    https://activity.northbkk.ac.th/thumbnails/671280108.jpg
```
