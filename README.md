# NBU Activity Attendance System

ระบบบันทึกการเข้าร่วมกิจกรรมของนักศึกษา มหาวิทยาลัยนอร์ทกรุงเทพ

---

## สารบัญ

- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [URL และหน้าต่างๆ](#url-และหน้าต่างๆ)
- [การติดตั้ง (Development)](#การติดตั้ง-development)
- [การ Deploy ขึ้น Server](#การ-deploy-ขึ้น-server)
- [คู่มือการใช้งาน Admin](#คู่มือการใช้งาน-admin)
- [คู่มือการใช้งาน Scanner (iPad)](#คู่มือการใช้งาน-scanner-ipad)
- [คู่มือการใช้งาน LINE OA](#คู่มือการใช้งาน-line-oa)
- [การ Import นักศึกษา](#การ-import-นักศึกษา)
- [API Reference](#api-reference)

---

## ภาพรวมระบบ

```
เครื่องสแกน QR ──► iPad (Scanner App) ──► API Server ──► PostgreSQL
                                                    │
                                                    └──► Redis (cache นักศึกษา)
                                                    │
                    Admin Web ◄─────────────────────┘
                    LINE OA   ◄─────────────────────┘
```

**Flow การเช็คชื่อ**

1. นักศึกษาแสดง QR Code จากบัตรนักศึกษา
2. เครื่องสแกนอ่าน QR → ส่งค่าไปยัง iPad
3. iPad ส่ง POST `/api/v1/attendance/scan` พร้อม `qr_raw`
4. Server ตรวจสอบ QR (format + expiry + HMAC) → ดึงข้อมูลจาก Redis (<5ms)
5. บันทึก attendance → PostgreSQL (async)
6. iPad แสดงชื่อ คณะ รูปนักศึกษา + เสียง beep สีเขียว

---

## URL และหน้าต่างๆ

| หน้า | URL |
|------|-----|
| Admin Panel | `https://activity.northbkk.ac.th/admin` |
| Scanner App (iPad) | `https://activity.northbkk.ac.th/scanner` |
| LINE OA Webhook | `https://activity.northbkk.ac.th/line/webhook` |
| API Base | `https://activity.northbkk.ac.th/api/v1` |
| Health Check | `https://activity.northbkk.ac.th/api/health` |

---

## การติดตั้ง (Development)

### ความต้องการ

- Node.js 20+
- Python 3.10+ (สำหรับ import script)
- PostgreSQL 14+
- Redis (หรือ Redis Cloud)

### ขั้นตอน

```bash
# 1. Clone / copy โปรเจกต์
cd /your/path

# 2. ติดตั้ง dependencies
npm install

# 3. ตั้งค่า environment
cp .env.example .env
# แก้ไข .env ให้ครบ (ดูหัวข้อ Environment Variables ด้านล่าง)

# 4. สร้างตาราง database
node database/migrate.js

# 5. สร้าง superadmin user เริ่มต้น
node scripts/create_admin.mjs admin ChangeMe123! ชื่อผู้ดูแล superadmin

# 6. Import นักศึกษา (optional สำหรับ dev)
python scripts/import_students.py students.csv --dry-run

# 7. รัน server
npm run dev
```

### Environment Variables

แก้ไขในไฟล์ `.env`:

```env
# Server
NODE_ENV=production
PORT=5533
BASE_URL=https://activity.northbkk.ac.th

# PostgreSQL
DB_HOST=nbc.northbkk.ac.th
DB_PORT=5432
DB_NAME=nbu_activity_checkin
DB_USER=postgres
DB_PASSWORD=your_db_password

# Redis Cloud
REDIS_HOST=your.redis.host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_TLS=true          # true ถ้า Redis ใช้ SSL

# JWT (ใช้ random string ยาวๆ อย่างน้อย 32 ตัว)
JWT_SECRET=change_this_to_random_secret_min_32_chars
JWT_EXPIRES_IN=8h

# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret

# QR Secret (ดูจาก admin config ของระบบ LINE OA มหาวิทยาลัย)
QR_SECRET=your_qr_secret_key

# รูปนักศึกษา
PHOTO_BASE_URL=https://reg.northbkk.ac.th/studentimg
THUMBNAIL_DIR=/var/www/activity/public/thumbnails
THUMBNAIL_BASE_URL=/thumbnails
```

---

## การ Deploy ขึ้น Server

### อัตโนมัติ (แนะนำ)

```bash
python scripts/deploy.py
```

script จะทำทุกอย่างให้อัตโนมัติ: upload → npm install → PM2 → Nginx

### ด้วยตนเอง

```bash
# บน server
cd /var/www/app/nbu-activity-checkin
npm install --production
node database/migrate.js
node scripts/create_admin.mjs admin YourPassword123!
pm2 start ecosystem.config.cjs
pm2 save
```

### จัดการ Service (PM2)

```bash
pm2 list                          # ดู status
pm2 logs nbu-activity             # ดู log แบบ real-time
pm2 logs nbu-activity --lines 50  # ดู 50 บรรทัดล่าสุด
pm2 restart nbu-activity          # restart
pm2 stop nbu-activity             # หยุด
pm2 reload nbu-activity           # reload (zero-downtime)
```

---

## คู่มือการใช้งาน Admin

### Login

เข้า `https://activity.northbkk.ac.th/admin` แล้วล็อกอินด้วย username/password ที่ได้รับ

| Role | สิทธิ์ |
|------|--------|
| superadmin | ทุกอย่าง รวมถึงสร้าง admin |
| admin | สร้าง/แก้ไขกิจกรรม จัดการ staff |
| staff | เปิด/ปิด session เช็คชื่อ ดู report เฉพาะกิจกรรมตัวเอง |

---

### Dashboard

- ดูสถิติภาพรวม: จำนวนกิจกรรม, การเช็คชื่อ, ผู้ใช้งาน
- ดูกิจกรรมล่าสุด 5 รายการ

---

### จัดการกิจกรรม

**สร้างกิจกรรมใหม่**

1. คลิก **+ สร้างกิจกรรม**
2. กรอกข้อมูล:
   - ชื่อกิจกรรม (จำเป็น)
   - วันที่เริ่ม / สิ้นสุด (จำเป็น)
   - สถานที่
   - ประเภท: ทั่วไป / วิชาการ / กีฬา / วัฒนธรรม / จิตอาสา
   - จำนวนที่รับ (0 = ไม่จำกัด)
   - มอบหมาย Staff (Ctrl+Click เลือกได้หลายคน)
3. คลิก **บันทึก**

**ดูรายชื่อผู้เข้าร่วม**

- คลิก **รายชื่อ** ในแถวกิจกรรม
- สามารถลบรายการเช็คชื่อ หรือ Export Excel/PDF ได้จากหน้านี้

---

### จัดการผู้ใช้ (Admin/Superadmin เท่านั้น)

**เพิ่มผู้ใช้ใหม่**

1. ไปที่เมนู **ผู้ใช้งาน**
2. คลิก **+ เพิ่มผู้ใช้**
3. กรอก ชื่อ-นามสกุล, Username, รหัสผ่าน, Role
4. คลิก **บันทึก**

> รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร

**เปลี่ยนรหัสผ่าน**

1. คลิก **แก้ไข** ในแถวผู้ใช้
2. กรอก **รหัสผ่านใหม่** (เว้นว่างถ้าไม่ต้องการเปลี่ยน)
3. คลิก **บันทึก**

---

### ออกรายงาน

1. ไปที่เมนู **รายงาน**
2. เลือกกิจกรรมจาก dropdown
3. ระบบแสดงสรุปจำนวน (ทั้งหมด / QR / Manual)
4. คลิก **Export Excel** หรือ **Export PDF**

---

## คู่มือการใช้งาน Scanner (iPad)

### การเตรียมการ

1. เปิด browser บน iPad ไปที่ `https://activity.northbkk.ac.th/scanner`
2. ล็อกอินด้วย account staff / admin
3. ต่อเครื่องสแกน Barcode ผ่าน USB หรือ Bluetooth (รองรับ keyboard wedge ทุกรุ่น)

### เปิด Session เช็คชื่อ

1. เลือกกิจกรรมจาก dropdown ด้านบน
2. คลิก **เปิด Session** → badge เปลี่ยนเป็นสีเขียว "Session เปิด ✓"
3. คลิกกล่อง **"คลิกที่นี่ แล้วสแกน QR Code"** เพื่อ focus
4. นักศึกษาแสดง QR → สแกนได้เลย

### ผลลัพธ์การสแกน

| สัญญาณ | ความหมาย |
|--------|----------|
| เสียงสั้น + แสงเขียว | เช็คชื่อสำเร็จ แสดงชื่อ/รูปนักศึกษา |
| เสียงสองครั้ง + แสงแดง | เช็คชื่อซ้ำ หรือ QR หมดอายุ / ไม่ถูกต้อง |

### เช็คชื่อ Manual (กรณีสแกนไม่ได้)

1. พิมพ์ชื่อหรือรหัสนักศึกษาในช่อง **"ค้นหาด้วยชื่อ / รหัสนักศึกษา"**
2. คลิก **ค้นหา**
3. คลิกที่ชื่อนักศึกษาในผลลัพธ์เพื่อเช็คชื่อ

### ปิด Session

1. คลิก **ปิด Session** (ปุ่มสีแดง)
2. ยืนยัน → session ถูกบันทึก ไม่สามารถสแกนเพิ่มได้

> **หมายเหตุ:** ถ้าหน้าจอค้าง ให้คลิกพื้นที่ว่างเพื่อ refocus input ก่อนสแกน

---

## คู่มือการใช้งาน LINE OA

นักศึกษาพิมพ์คำสั่งใน LINE OA ของมหาวิทยาลัย:

| คำสั่ง | ผลลัพธ์ |
|--------|---------|
| `กิจกรรม` | แสดงสรุปและประวัติการเข้าร่วมทั้งหมด (Flex Message) |
| `กิจกรรมล่าสุด` | แสดง 5 กิจกรรมล่าสุด |

> ระบบจับคู่ LINE UUID กับ `students.line_uuid` ในฐานข้อมูล  
> ถ้านักศึกษาพิมพ์แล้วขึ้น "ไม่พบข้อมูล" แสดงว่ายังไม่ได้ผูก LINE UUID

---

## การ Import นักศึกษา

### รูปแบบ CSV

```csv
student_id,full_name,faculty,major,year
671280108,นายสมชาย ใจดี,คณะวิทยาศาสตร์และเทคโนโลยี,วิทยาการคอมพิวเตอร์,2
671280109,นางสาวมานี รักดี,คณะบริหารธุรกิจ,การตลาด,1
```

### รันคำสั่ง

```bash
# Import ปกติ (download รูปด้วย)
python scripts/import_students.py students.csv

# Import ข้าม download รูป (เร็วกว่า)
python scripts/import_students.py students.csv --skip-photos

# ทดสอบโดยไม่บันทึก
python scripts/import_students.py students.csv --dry-run
```

### URL รูปนักศึกษา

ระบบดึงรูปอัตโนมัติจาก pattern:

```
รหัส 671280108 → https://reg.northbkk.ac.th/studentimg/67/671280108.jpg
```

รูปจะถูก resize เป็น 120×120px และเก็บใน `THUMBNAIL_DIR` บน server

---

## API Reference

### Authentication

```
POST /api/v1/auth/login
Body: { "username": "admin", "password": "..." }
Response: { "success": true, "token": "eyJ...", "user": {...} }
```

ทุก request ต้องส่ง header:
```
Authorization: Bearer <token>
```

---

### Activities

| Method | Endpoint | คำอธิบาย |
|--------|----------|---------|
| GET | `/api/v1/activities` | รายการกิจกรรมทั้งหมด |
| POST | `/api/v1/activities` | สร้างกิจกรรมใหม่ |
| GET | `/api/v1/activities/:id` | ดูกิจกรรม + session ล่าสุด |
| PUT | `/api/v1/activities/:id` | แก้ไขกิจกรรม |
| DELETE | `/api/v1/activities/:id` | ลบกิจกรรม |
| POST | `/api/v1/activities/:id/session/open` | เปิด session เช็คชื่อ |
| POST | `/api/v1/activities/:id/session/close` | ปิด session |
| GET | `/api/v1/activities/:id/sessions` | ประวัติ session ทั้งหมด |

**สร้างกิจกรรม:**
```json
POST /api/v1/activities
{
  "title": "กีฬาสี ประจำปี 2567",
  "description": "กิจกรรมกีฬาสีประจำปี",
  "location": "สนามกีฬา อาคาร A",
  "activity_type": "sport",
  "start_datetime": "2026-05-01T08:00:00",
  "end_datetime": "2026-05-01T17:00:00",
  "max_participants": 500,
  "staff_ids": ["uuid-1", "uuid-2"]
}
```

---

### Attendance

| Method | Endpoint | คำอธิบาย |
|--------|----------|---------|
| POST | `/api/v1/attendance/scan` | เช็คชื่อด้วย QR |
| POST | `/api/v1/attendance/manual` | เช็คชื่อ manual |
| GET | `/api/v1/attendance/:activityId` | รายชื่อผู้เข้าร่วม |
| DELETE | `/api/v1/attendance/:id` | ลบรายการเช็คชื่อ |

**QR Scan:**
```json
POST /api/v1/attendance/scan
{
  "qr_raw": "671280108|1775716100|6dd426b0ff3fcf28",
  "activity_id": "uuid-of-activity",
  "session_id": "uuid-of-session"
}
```

**Response สำเร็จ:**
```json
{
  "success": true,
  "message": "เช็คชื่อสำเร็จ",
  "student": {
    "student_id": "671280108",
    "full_name": "นายสมชาย ใจดี",
    "faculty": "คณะวิทยาศาสตร์และเทคโนโลยี",
    "major": "วิทยาการคอมพิวเตอร์",
    "year": "2",
    "photo_url": "/thumbnails/671280108.jpg"
  }
}
```

---

### Students

| Method | Endpoint | คำอธิบาย |
|--------|----------|---------|
| GET | `/api/v1/students/search?q=` | ค้นหานักศึกษา |
| GET | `/api/v1/students/:studentId` | ดูข้อมูลนักศึกษา |
| GET | `/api/v1/students/meta/faculties` | รายการคณะทั้งหมด |

```
GET /api/v1/students/search?q=สมชาย
GET /api/v1/students/search?q=6712&year=2
```

---

### Reports

| Method | Endpoint | คำอธิบาย |
|--------|----------|---------|
| GET | `/api/v1/reports/:activityId/excel` | Export Excel |
| GET | `/api/v1/reports/:activityId/pdf` | Export PDF |

---

### Users (Admin เท่านั้น)

| Method | Endpoint | คำอธิบาย |
|--------|----------|---------|
| GET | `/api/v1/users` | รายการผู้ใช้ทั้งหมด |
| POST | `/api/v1/users` | สร้างผู้ใช้ใหม่ |
| PUT | `/api/v1/users/:id` | แก้ไขผู้ใช้ |
| DELETE | `/api/v1/users/:id` | ลบผู้ใช้ |

---

## โครงสร้างโปรเจกต์

```
nbu-activity-checkin/
├── server.js                     ← entry point (Express)
├── package.json
├── .env                          ← ไม่ commit (gitignore)
├── .env.example                  ← template
├── ecosystem.config.cjs          ← PM2 config
│
├── src/
│   ├── api/
│   │   ├── db.js                 ← PostgreSQL pool
│   │   ├── redis.js              ← Redis client
│   │   ├── middleware/
│   │   │   └── auth.js           ← JWT verify middleware
│   │   ├── routes/
│   │   │   ├── auth.js           ← POST /auth/login
│   │   │   ├── activities.js     ← CRUD + session open/close
│   │   │   ├── attendance.js     ← scan + manual + list
│   │   │   ├── students.js       ← search
│   │   │   ├── users.js          ← CRUD users
│   │   │   └── reports.js        ← Excel + PDF export
│   │   └── utils/
│   │       └── qr.js             ← QR verify/generate (HMAC-SHA256)
│   │
│   ├── admin/
│   │   └── index.html            ← Admin Web UI (SPA)
│   │
│   ├── scanner/
│   │   └── index.html            ← Scanner App (iPad)
│   │
│   └── line-oa/
│       └── webhook.js            ← LINE webhook + Flex Messages
│
├── database/
│   ├── schema.sql                ← DDL ตาราง/view/trigger
│   └── migrate.js                ← รัน schema.sql
│
└── scripts/
    ├── import_students.py        ← CSV → PostgreSQL + Redis
    ├── create_admin.mjs          ← สร้าง user เริ่มต้น
    └── deploy.py                 ← deploy อัตโนมัติ
```

---

## QR Code Format

QR ที่ระบบรองรับใช้ format:

```
{student_id}|{exp_unix_timestamp}|{hmac_sha256_16chars}
```

ตัวอย่าง:
```
671280108|1775716100|6dd426b0ff3fcf28
```

- `student_id` — รหัสนักศึกษา
- `exp` — Unix timestamp หมดอายุ (ปัจจุบัน + 5 นาที)
- `hmac` — HMAC-SHA256 ของ `student_id|exp` ย่อเหลือ 16 ตัว ด้วย `QR_SECRET`

ทดสอบสร้าง QR:
```bash
node scripts/test-qr.js 671280108
```

---

## Troubleshooting

**Redis ต่อไม่ได้**
```bash
# ตรวจสอบ config ใน .env
# REDIS_TLS=true สำหรับ Redis Cloud (rediss://)
# REDIS_TLS=false สำหรับ Redis บน localhost
pm2 restart nbu-activity --update-env
```

**Migration error: column already exists**
```bash
# ตาราง schema เก่าอยู่ใน database — ใช้ database ใหม่แยกต่างหาก
# แก้ DB_NAME ใน .env แล้วรัน migrate ใหม่
```

**QR หมดอายุเร็วเกินไป**
```bash
# QR มีอายุ 5 นาที ถ้าเวลา server/client ไม่ตรงกัน ให้ sync NTP
timedatectl status
```

**export PDF ภาษาไทยแสดงไม่ถูก**

> PDF ใช้ pdfkit ซึ่งไม่รองรับฟอนต์ไทย by default — ชื่อภาษาไทยจะไม่แสดงใน PDF  
> แนะนำให้ใช้ **Export Excel** แทน หรือติดตั้งฟอนต์ THSarabunNew เพิ่มเติม

---

## License

สงวนสิทธิ์ มหาวิทยาลัยนอร์ทกรุงเทพ © 2026
