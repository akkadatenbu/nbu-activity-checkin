# NBU Activity Attendance System — CLAUDE.md

ไฟล์นี้คือ context หลักของโปรเจกต์ Claude Code จะอ่านไฟล์นี้ก่อนทุก session

---

## ภาพรวมระบบ

ระบบบันทึกการเข้าร่วมกิจกรรมของนักศึกษา มหาวิทยาลัยนอร์ทกรุงเทพ (NBU)
- เครื่องสแกน QR Code หน้าประตูทางเข้า + iPad แสดงข้อมูลทันที
- Admin สร้างกิจกรรม / มอบหมายอาจารย์
- อาจารย์เปิด session เช็คชื่อ / ดู real-time list
- นักศึกษาดูประวัติตัวเองผ่าน LINE OA มหาวิทยาลัย

---

## URLs & Domain

| ส่วน | URL |
|------|-----|
| ระบบหลัก | https://activity.northbkk.ac.th/ |
| Admin panel | https://activity.northbkk.ac.th/admin |
| LINE OA webhook | https://activity.northbkk.ac.th/line/webhook |
| Scanner app | https://activity.northbkk.ac.th/scanner |
| API | https://activity.northbkk.ac.th/api/v1 |
| Thumbnails | https://activity.northbkk.ac.th/thumbnails |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Port | 5533 (3000 ถูกใช้งานแล้ว) |
| Framework | Express.js |
| Primary DB | PostgreSQL (nbu-actmenu) |
| Cache | Redis Cloud (SSL) |
| Auth | JWT + bcrypt |
| LINE | LINE Messaging API + LIFF |
| Image | sharp (resize thumbnail) |
| Report | exceljs (Excel), pdfkit (PDF) |
| Server | Ubuntu + Nginx reverse proxy |

---

## Environment Variables (.env)

```env
# Server
NODE_ENV=production
PORT=3000
BASE_URL=https://activity.northbkk.ac.th

# PostgreSQL
DB_HOST=nbc.northbkk.ac.th
DB_PORT=5432
DB_NAME=nbu-actmenu
DB_USER=postgres
DB_PASSWORD=YOUR_DB_PASSWORD_HERE

# Redis Cloud
REDIS_HOST=YOUR_REDIS_HOST
REDIS_PORT=YOUR_REDIS_PORT
REDIS_PASSWORD=YOUR_REDIS_PASSWORD

# JWT
JWT_SECRET=YOUR_JWT_SECRET_MIN_32_CHARS
JWT_EXPIRES_IN=8h

# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=YOUR_LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET=YOUR_LINE_CHANNEL_SECRET

# ─── QR Code ─────────────────────────────────────────────
QR_SECRET=YOUR_QR_SECRET_KEY          # ดูจาก https://nbc.northbkk.ac.th/admin/config

# Student Photo URL Pattern
# รหัส 671280108 → https://reg.northbkk.ac.th/studentimg/67/671280108.jpg
PHOTO_BASE_URL=https://reg.northbkk.ac.th/studentimg

# Thumbnail storage (local)
THUMBNAIL_DIR=/var/www/activity/public/thumbnails
THUMBNAIL_BASE_URL=/thumbnails
```

---

## โครงสร้างโปรเจกต์

```
nbu-activity/
├── CLAUDE.md                  ← ไฟล์นี้
├── .env                       ← ไม่ commit (gitignore)
├── .env.example               ← template สำหรับ setup
├── package.json
├── server.js                  ← entry point
│
├── src/
│   ├── api/                   ← REST API
│   │   ├── routes/
│   │   │   ├── auth.js        ← login/logout
│   │   │   ├── activities.js  ← CRUD กิจกรรม
│   │   │   ├── attendance.js  ← บันทึก/ดู การเข้าร่วม
│   │   │   ├── students.js    ← ค้นหานักศึกษา
│   │   │   └── reports.js     ← export รายงาน
│   │   ├── middleware/
│   │   │   ├── auth.js        ← JWT verify
│   │   │   └── role.js        ← role-based access
│   │   └── controllers/
│   │
│   ├── admin/                 ← Admin Web UI (HTML/CSS/JS)
│   │   ├── index.html         ← dashboard
│   │   ├── activities.html    ← จัดการกิจกรรม
│   │   ├── users.html         ← จัดการ user
│   │   └── reports.html       ← รายงาน
│   │
│   ├── scanner/               ← Scanner App (iPad)
│   │   └── index.html         ← หน้าสแกน QR + แสดงผล
│   │
│   └── line-oa/               ← LINE OA Integration
│       ├── webhook.js         ← รับ event จาก LINE
│       └── flex-messages.js   ← template Flex Message
│
├── database/
│   ├── schema.sql             ← สร้างตารางทั้งหมด
│   └── seeds.sql              ← ข้อมูลตัวอย่าง
│
└── scripts/
    └── import_students.py     ← import CSV → PostgreSQL + Redis
```

---

## Database Schema (PostgreSQL)

### ตาราง users (admin/staff)
```sql
users: id, username, password_hash, full_name, role, is_active, created_at
role: 'superadmin' | 'admin' | 'staff'
```

### ตาราง activities
```sql
activities: id, title, description, location, start_datetime, end_datetime,
            max_participants, created_by, is_active, created_at
```

### ตาราง activity_staff (อาจารย์ที่รับผิดชอบ)
```sql
activity_staff: activity_id, user_id, assigned_at
```

### ตาราง students (นำเข้าจาก CSV)
```sql
students: student_id (PK), full_name, faculty, major, year,
          photo_url (local thumbnail), line_uuid, imported_at, updated_at
```

### ตาราง attendance (หัวใจหลัก)
```sql
attendance: id, activity_id, student_id, checked_at, checked_by,
            method ('qr_scan' | 'manual'), note
UNIQUE(activity_id, student_id)
```

### ตาราง sessions (เช็คชื่อ)
```sql
sessions: id, activity_id, opened_by, opened_at, closed_at, status
status: 'open' | 'closed'
```

---

## Redis Schema

```
student:{student_id}  →  HASH
  - student_id
  - full_name
  - faculty
  - major
  - year
  - photo_url   ← local thumbnail URL (เร็ว ไม่พึ่ง URL ภายนอก)
```

---

## Student Photo URL Pattern

```
รหัสนักศึกษา: 671280108
URL จริง:     https://reg.northbkk.ac.th/studentimg/67/671280108.jpg
Pattern:      {PHOTO_BASE_URL}/{student_id[0:2]}/{student_id}.jpg
```

Thumbnail เก็บใน server เอง:
```
/var/www/activity/public/thumbnails/671280108.jpg
serve via: https://activity.northbkk.ac.th/thumbnails/671280108.jpg
```

---

## Role & Permission

| Feature | superadmin | admin | staff |
|---------|-----------|-------|-------|
| จัดการ user | ✅ | ✅ | ❌ |
| สร้าง/ลบกิจกรรม | ✅ | ✅ | ❌ |
| เปิด session เช็คชื่อ | ✅ | ✅ | ✅ (เฉพาะที่ได้รับมอบหมาย) |
| สแกน QR | ✅ | ✅ | ✅ |
| ดู dashboard ทุกกิจกรรม | ✅ | ✅ | ❌ |
| ออก report | ✅ | ✅ | ✅ (เฉพาะกิจกรรมตัวเอง) |
| import CSV | ✅ | ✅ | ❌ |

---

## API Endpoints หลัก

```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout

GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/:id
PUT    /api/v1/activities/:id
DELETE /api/v1/activities/:id

POST   /api/v1/activities/:id/session/open
POST   /api/v1/activities/:id/session/close

POST   /api/v1/attendance/scan        ← QR scan (ใช้ Redis)
POST   /api/v1/attendance/manual      ← เพิ่ม manual
GET    /api/v1/attendance/:activityId ← รายชื่อผู้เข้าร่วม
DELETE /api/v1/attendance/:id         ← ลบรายการ

GET    /api/v1/students/search?q=     ← ค้นหา (fallback กรณีสแกนไม่ได้)

GET    /api/v1/reports/:activityId/excel
GET    /api/v1/reports/:activityId/pdf

POST   /line/webhook                  ← LINE OA
```

---

## QR Scan Flow (สำคัญที่สุด)

```
1. เครื่องสแกนอ่าน QR → ได้ student_id (เช่น "671280108")
2. iPad ส่ง POST /api/v1/attendance/scan  { student_id, activity_id, session_id }
3. API → Redis HGETALL student:671280108  (< 5ms)
4. ตรวจสอบ: session เปิดอยู่ไหม / เช็คชื่อซ้ำไหม
5. บันทึก attendance → PostgreSQL (async ไม่บล็อก response)
6. Response → iPad แสดงผล: ชื่อ, คณะ, รูป thumbnail
7. เสียง beep + แสงสีเขียว = เช็คชื่อสำเร็จ
8. แสงสีแดง = เช็คชื่อซ้ำ / ไม่พบข้อมูล
```

---

## LINE OA Integration

ระบบมี LINE OA มหาวิทยาลัยที่ผูก student_id ↔ LINE UUID ไว้แล้ว
ใช้ฟิลด์ `students.line_uuid` เชื่อมข้อมูล

คำสั่งที่นักศึกษาพิมพ์ใน LINE:
- `กิจกรรม` → แสดงประวัติการเข้าร่วมทั้งหมด
- `กิจกรรมล่าสุด` → แสดง 5 รายการล่าสุด

Response เป็น Flex Message แสดง:
- ชื่อกิจกรรม, วันที่, สถานที่
- สถานะ ✅ เข้าร่วม

---

## Development Phases

### Phase 1 — Core (เริ่มก่อน)
- [ ] Database schema + migrations
- [ ] Import script CSV → PostgreSQL + Redis
- [ ] Auth API (login/logout/JWT)
- [ ] Activity CRUD API
- [ ] Scanner app (QR scan + แสดงผล iPad)
- [ ] Attendance API (scan + manual)

### Phase 2 — Management
- [ ] Admin Web UI
- [ ] Session management (open/close)
- [ ] Real-time attendance list
- [ ] User management

### Phase 3 — Reports & LINE
- [ ] Dashboard กราฟสถิติ
- [ ] Export Excel / PDF
- [ ] LINE OA webhook + Flex Message

---

## Coding Conventions

- ภาษา: **Node.js (ES Modules)** — ใช้ `import/export`
- Async: **async/await** ทุกที่ ไม่ใช้ callback
- Error: **try/catch** ทุก async function ใน controller
- DB: ใช้ **pg** (node-postgres) — prepared statements เสมอ ป้องกัน SQL injection
- Response format:
```json
{ "success": true, "data": {...} }
{ "success": false, "message": "..." }
```
- Thai comments: comment ภาษาไทยได้เต็มที่
- Log: `console.log` สำหรับ dev, winston สำหรับ production

---

## การรัน (Development)

```bash
npm install
cp .env.example .env
# แก้ .env ให้ครบ
node database/migrate.js   # สร้างตาราง
python scripts/import_students.py students.csv  # import ข้อมูล
npm run dev
```
