#!/usr/bin/env python3
"""
NBU Student Import Script
CSV → Download thumbnail → PostgreSQL + Redis

URL Pattern: https://reg.northbkk.ac.th/studentimg/{2หลักแรก}/{student_id}.jpg
Example:     https://reg.northbkk.ac.th/studentimg/67/671280108.jpg

Usage:
    python import_students.py students.csv
    python import_students.py students.csv --skip-photos   # ข้ามถ้ามีรูปแล้ว
    python import_students.py students.csv --dry-run       # ทดสอบไม่บันทึกจริง
"""

import csv, os, sys, time, logging, argparse
import requests, redis, psycopg2, psycopg2.extras
from PIL import Image
from io import BytesIO
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("import_students.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ─── Config (อ่านจาก .env) ────────────────────────────────────────────────────
CFG = {
    # PostgreSQL
    "pg_host":     os.getenv("DB_HOST", "nbc.northbkk.ac.th"),
    "pg_port":     int(os.getenv("DB_PORT", "5432")),
    "pg_dbname":   os.getenv("DB_NAME", "nbu-actmenu"),
    "pg_user":     os.getenv("DB_USER", "postgres"),
    "pg_password": os.getenv("DB_PASSWORD", ""),

    # Redis
    "redis_host":     os.getenv("REDIS_HOST", ""),
    "redis_port":     int(os.getenv("REDIS_PORT", "6379")),
    "redis_password": os.getenv("REDIS_PASSWORD", ""),

    # Photo URL pattern
    "photo_base_url": os.getenv("PHOTO_BASE_URL", "https://reg.northbkk.ac.th/studentimg"),

    # Thumbnail local storage
    "thumb_dir":     os.getenv("THUMBNAIL_DIR", "/var/www/app/nbu-activity-checkin/public/thumbnails"),
    "thumb_url":     os.getenv("THUMBNAIL_BASE_URL", "/thumbnails"),
    "thumb_size":    (int(os.getenv("THUMBNAIL_SIZE", "120")),) * 2,
    "thumb_quality": int(os.getenv("THUMBNAIL_QUALITY", "80")),

    # CSV column names — แก้ให้ตรงกับ header ใน CSV
    "col_id":      "student_id",
    "col_name":    "full_name",
    "col_faculty": "faculty",
    "col_major":   "major",
    "col_year":    "year",

    # Performance
    "batch_size":  500,
    "max_workers": 10,
    "timeout":     10,
    "encoding":    "utf-8-sig",   # รองรับ BOM จาก Excel
}


# ─── Photo helpers ────────────────────────────────────────────────────────────
def build_photo_url(student_id: str) -> str:
    """671280108 → https://reg.northbkk.ac.th/studentimg/67/671280108.jpg"""
    prefix = student_id[:2]
    return f"{CFG['photo_base_url']}/{prefix}/{student_id}.jpg"


def thumb_paths(student_id: str) -> tuple[str, str]:
    """คืน (local_path, serve_url)"""
    fname = f"{student_id}.jpg"
    return os.path.join(CFG["thumb_dir"], fname), f"{CFG['thumb_url']}/{fname}"


def download_thumb(student_id: str) -> str:
    """Download + center-crop + resize → คืน serve_url หรือ ''"""
    local, serve = thumb_paths(student_id)
    if os.path.exists(local):
        return serve   # มีอยู่แล้ว ข้าม

    try:
        r = requests.get(
            build_photo_url(student_id),
            timeout=CFG["timeout"],
            headers={"User-Agent": "NBU-ImportBot/1.0"},
            stream=True,
        )
        r.raise_for_status()
        img = Image.open(BytesIO(r.content)).convert("RGB")

        # Center-crop เป็นสี่เหลี่ยมจัตุรัส
        w, h = img.size
        m = min(w, h)
        img = img.crop(((w - m) // 2, (h - m) // 2,
                         (w + m) // 2, (h + m) // 2))
        img = img.resize(CFG["thumb_size"], Image.LANCZOS)
        img.save(local, "JPEG", quality=CFG["thumb_quality"], optimize=True)
        return serve

    except requests.HTTPError as e:
        if e.response.status_code != 404:
            log.warning(f"[{student_id}] HTTP {e.response.status_code}")
        return ""
    except Exception as e:
        log.warning(f"[{student_id}] error: {e}")
        return ""


# ─── PostgreSQL ───────────────────────────────────────────────────────────────
def pg_connect():
    return psycopg2.connect(
        host=CFG["pg_host"], port=CFG["pg_port"],
        dbname=CFG["pg_dbname"], user=CFG["pg_user"],
        password=CFG["pg_password"],
        options="-c client_encoding=UTF8",
    )


def pg_upsert(conn, batch: list[dict]):
    sql = """
        INSERT INTO students (student_id, full_name, faculty, major, year, photo_url)
        VALUES %(student_id)s, %(full_name)s, %(faculty)s, %(major)s, %(year)s, %(photo_url)s)
        ON CONFLICT (student_id) DO UPDATE SET
            full_name  = EXCLUDED.full_name,
            faculty    = EXCLUDED.faculty,
            major      = EXCLUDED.major,
            year       = EXCLUDED.year,
            photo_url  = EXCLUDED.photo_url,
            updated_at = NOW()
    """
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO students (student_id, full_name, faculty, major, year, photo_url)
            VALUES (%(student_id)s, %(full_name)s, %(faculty)s, %(major)s, %(year)s, %(photo_url)s)
            ON CONFLICT (student_id) DO UPDATE SET
                full_name  = EXCLUDED.full_name,
                faculty    = EXCLUDED.faculty,
                major      = EXCLUDED.major,
                year       = EXCLUDED.year,
                photo_url  = EXCLUDED.photo_url,
                updated_at = NOW()
        """, batch, page_size=CFG["batch_size"])
    conn.commit()


# ─── Redis ────────────────────────────────────────────────────────────────────
def redis_connect():
    return redis.Redis(
        host=CFG["redis_host"], port=CFG["redis_port"],
        password=CFG["redis_password"],
        ssl=True, decode_responses=True,
        socket_connect_timeout=10,
    )


def redis_upsert(r: redis.Redis, batch: list[dict]):
    pipe = r.pipeline(transaction=False)
    for s in batch:
        pipe.hset(f"student:{s['student_id']}", mapping={
            "student_id": s["student_id"],
            "full_name":  s["full_name"],
            "faculty":    s["faculty"],
            "major":      s["major"],
            "year":       str(s["year"]),
            "photo_url":  s["photo_url"],
        })
    pipe.execute()


# ─── Main ─────────────────────────────────────────────────────────────────────
def main(csv_path: str, skip_photos: bool = False, dry_run: bool = False):
    log.info("=" * 55)
    log.info("NBU Student Import")
    log.info(f"ไฟล์  : {csv_path}")
    log.info(f"เวลา  : {datetime.now():%Y-%m-%d %H:%M:%S}")
    log.info(f"dry-run: {dry_run}")
    log.info("=" * 55)
    t0 = time.time()

    # สร้างโฟลเดอร์ thumbnail
    Path(CFG["thumb_dir"]).mkdir(parents=True, exist_ok=True)

    # อ่าน CSV
    with open(csv_path, encoding=CFG["encoding"]) as f:
        raw = list(csv.DictReader(f))
    total = len(raw)
    log.info(f"อ่าน CSV: {total:,} แถว")

    students = [
        {
            "student_id": r[CFG["col_id"]].strip(),
            "full_name":  r[CFG["col_name"]].strip(),
            "faculty":    r[CFG["col_faculty"]].strip(),
            "major":      r[CFG["col_major"]].strip(),
            "year":       r[CFG["col_year"]].strip(),
            "photo_url":  "",
        }
        for r in raw
    ]
    id_map = {s["student_id"]: s for s in students}

    # Step 1: Download thumbnails
    if not skip_photos:
        log.info(f"\n[Step 1] Download thumbnails ({CFG['max_workers']} threads)...")
        ok = fail = 0
        with ThreadPoolExecutor(max_workers=CFG["max_workers"]) as ex:
            futures = {ex.submit(download_thumb, sid): sid for sid in id_map}
            for i, fut in enumerate(as_completed(futures), 1):
                sid  = futures[fut]
                url  = fut.result()
                id_map[sid]["photo_url"] = url
                if url: ok += 1
                else:   fail += 1
                if i % 500 == 0 or i == total:
                    log.info(f"  {i:,}/{total:,}  ✓{ok}  ✗{fail}")
        log.info(f"  สรุปรูป: ✓{ok:,}  ✗{fail:,}")
    else:
        log.info("\n[Step 1] ข้าม download รูป")
        for s in students:
            local, url = thumb_paths(s["student_id"])
            s["photo_url"] = url if os.path.exists(local) else ""

    if dry_run:
        log.info("\n⚠️  dry-run mode — ไม่บันทึกข้อมูล")
        log.info(f"ตัวอย่าง: {students[0]}")
        return

    # Step 2: PostgreSQL
    log.info("\n[Step 2] Import PostgreSQL...")
    conn = pg_connect()
    for i in range(0, total, CFG["batch_size"]):
        batch = students[i : i + CFG["batch_size"]]
        pg_upsert(conn, batch)
        log.info(f"  PG: {min(i + CFG['batch_size'], total):,}/{total:,}")
    conn.close()

    # Step 3: Redis
    log.info("\n[Step 3] Import Redis...")
    r = redis_connect()
    for i in range(0, total, CFG["batch_size"]):
        batch = students[i : i + CFG["batch_size"]]
        redis_upsert(r, batch)
        log.info(f"  Redis: {min(i + CFG['batch_size'], total):,}/{total:,}")

    elapsed = time.time() - t0
    log.info(f"\n{'='*55}")
    log.info(f"✅ Import เสร็จสมบูรณ์")
    log.info(f"   นักศึกษา : {total:,} คน")
    log.info(f"   เวลา     : {elapsed:.1f} วินาที")
    log.info(f"{'='*55}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NBU Student Import")
    parser.add_argument("csv_file", help="path ของไฟล์ CSV")
    parser.add_argument("--skip-photos", action="store_true", help="ข้าม download รูป")
    parser.add_argument("--dry-run",     action="store_true", help="ทดสอบโดยไม่บันทึก")
    args = parser.parse_args()

    if not os.path.exists(args.csv_file):
        log.error(f"ไม่พบไฟล์: {args.csv_file}")
        sys.exit(1)

    main(args.csv_file, skip_photos=args.skip_photos, dry_run=args.dry_run)
