# Workplace Planner v2 — Vercel + Vercel Postgres

ย้ายจาก Supabase มาเป็น Vercel ทั้งหมด (ไม่ต้องพึ่ง Supabase อีก) พร้อมนโยบายเก็บข้อมูล
ย้อนหลัง 3 เดือน / วางแผนล่วงหน้าได้ 3 เดือน และลบข้อมูลเก่าอัตโนมัติทุกเดือน

## โครงสร้างไฟล์

```
index.html              หน้าแอปหลัก (เหมือนเดิม แก้แค่จุดต่อ API)
manual.html              คู่มือการใช้งาน
api/rpc/[name].js         API รวมทุกคำสั่ง (แทน Supabase RPC ทั้งหมด)
api/cron/cleanup.js       งานลบข้อมูลเก่ารายเดือน
api/_lib/db.js            เชื่อมต่อ Postgres
api/_lib/auth.js          ตรวจ session / เข้ารหัสรหัสผ่าน
sql/schema.sql            คำสั่งสร้างตาราง + seed แอดมินคนแรก
vercel.json               ตั้งเวลา cron
package.json              dependencies (@vercel/postgres, bcryptjs)
```

## ขั้นตอนตั้งค่า

### 1) ขึ้น GitHub repo ใหม่
push โฟลเดอร์นี้ทั้งหมดขึ้น repo ใหม่ที่จะผูกกับ Vercel

### 2) สร้างโปรเจกต์ใน Vercel
Vercel Dashboard → Add New → Project → เลือก repo นี้ → Deploy
(deploy รอบแรกจะ error เพราะยังไม่มี database ผูกอยู่ — ปกติ ข้ามไปข้อ 3 ก่อน)

### 3) สร้าง Postgres database
โปรเจกต์ใน Vercel → แท็บ **Storage** → **Create Database** → เลือก **Postgres**
(ขับเคลื่อนโดย Neon) → ตั้งชื่อ → **Connect to Project** เลือกโปรเจกต์นี้

ขั้นตอนนี้จะเซ็ต environment variable `POSTGRES_URL` (และตัวแปรที่เกี่ยวข้อง)
ให้อัตโนมัติ — ไม่ต้องกรอกเอง

### 4) รัน schema
ใน Vercel → Storage → เลือก database → แท็บ **Query** (หรือ psql จากเครื่อง
ด้วย connection string ที่ Vercel ให้มา) → วางเนื้อหาทั้งหมดจาก `sql/schema.sql`
แล้วรัน

สคริปต์นี้จะสร้าง user แอดมินให้ 1 คน:
- **username:** `admin`
- ยังไม่มีรหัสผ่าน — ไปตั้งที่หน้า Login แท็บ **"ตั้งรหัสผ่านครั้งแรก"**

### 5) ตั้งค่า CRON_SECRET (กันคนนอกยิง cleanup endpoint เล่น)
Vercel → โปรเจกต์ → Settings → Environment Variables → เพิ่ม
`CRON_SECRET` = ค่าสุ่มอะไรก็ได้ (เช่น `openssl rand -hex 32`)
Vercel จะแนบ header นี้ให้เองตอนยิง cron ตามเวลาใน `vercel.json`

### 6) Redeploy
กลับไปที่แท็บ Deployments → กด Redeploy ล่าสุด (ให้ env vars มีผล)

## นโยบายเก็บข้อมูล (ตามที่ตกลง)

- บันทึกแผนงานได้เฉพาะช่วง **วันนี้ ± 3 เดือน** เท่านั้น (บังคับที่ server
  ใน `app_save_schedule` — ต่อให้แก้ฝั่ง client ก็ยังโดนเช็คซ้ำ)
- **Vercel Cron** ยิง `api/cron/cleanup.js` ทุกวันที่ 1 ของเดือน เวลา 20:00 UTC
  (~03:00 น. เวลาไทย ของวันถัดไป) เพื่อลบ:
  - แถวใน `schedule` ที่วันที่เก่ากว่า 3 เดือน
  - session ที่หมดอายุแล้ว
- ปรับเวลา/ความถี่ cron ได้ที่ `vercel.json` (`schedule` เป็น cron syntax มาตรฐาน)

## เกี่ยวกับ Blob storage

ตอนนี้แอปยังไม่มีการอัปโหลดไฟล์/รูปภาพ จึงยังไม่ได้เปิดใช้ Vercel Blob จริง
ถ้าจะเพิ่มฟีเจอร์แนบไฟล์ในอนาคต ค่อยเพิ่ม `@vercel/blob` และ endpoint
อัปโหลดทีหลังได้ — โครงสร้างตอนนี้รองรับการต่อเพิ่มโดยไม่กระทบของเดิม

## หมายเหตุ

- ผู้ใช้/ตารางงาน/สถานที่/วันหยุดเดิมจาก Supabase project เดิมไม่ได้ถูกย้ายมา
  (ตอนที่ทำ database เดิม connection timeout จากปัญหาโควตาจนดึงข้อมูลไม่ได้)
  ต้องสร้าง user และสถานที่ใหม่ผ่านหน้า Admin หลัง deploy เสร็จ
- ทดสอบในเครื่องได้ด้วย `vercel dev` (ต้องมี Vercel CLI และรัน `vercel link`
  กับโปรเจกต์นี้ก่อน เพื่อดึง env vars ลงมา)
