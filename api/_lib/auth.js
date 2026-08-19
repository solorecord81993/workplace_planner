const bcrypt = require('bcryptjs');
const { sql } = require('./db');

class AppError extends Error {}

// Resolve a session token to its user row. Throws Thai messages that match
// what the front-end's rpc() helper already knows how to react to (it clears
// the session and reloads on "เซสชัน|เข้าสู่ระบบใหม่|ไม่ได้เข้าสู่ระบบ").
async function requireUser(token) {
  if (!token) throw new AppError('ไม่ได้เข้าสู่ระบบ');
  const { rows: s } = await sql`select * from sessions where token = ${token}`;
  if (!s.length) throw new AppError('เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  const session = s[0];
  if (new Date(session.expires_at) < new Date()) {
    await sql`delete from sessions where token = ${token}`;
    throw new AppError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const { rows: u } = await sql`select * from users where id = ${session.user_id}`;
  if (!u.length) throw new AppError('ไม่พบผู้ใช้');
  return u[0];
}

async function requireAdmin(token) {
  const u = await requireUser(token);
  if (u.role !== 'admin') throw new AppError('ต้องเป็นผู้ดูแลระบบ');
  return u;
}

async function verifyPassword(userId, password) {
  const { rows } = await sql`select pw_hash from users where id = ${userId}`;
  const hash = rows[0] && rows[0].pw_hash;
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// ±3-month save window for schedule entries (data-retention policy).
function assertWithinPlanningWindow(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) throw new AppError('วันที่ไม่ถูกต้อง');
  const min = new Date(); min.setHours(0, 0, 0, 0); min.setMonth(min.getMonth() - 3);
  const max = new Date(); max.setHours(0, 0, 0, 0); max.setMonth(max.getMonth() + 3);
  if (d < min || d > max) {
    throw new AppError('บันทึกแผนได้เฉพาะช่วง ±3 เดือนจากวันนี้เท่านั้น');
  }
}

module.exports = {
  AppError, requireUser, requireAdmin, verifyPassword, hashPassword,
  assertWithinPlanningWindow,
};
