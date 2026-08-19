const crypto = require('crypto');
const { sql } = require('../_lib/db');
const {
  AppError, requireUser, requireAdmin, verifyPassword, hashPassword,
  assertWithinPlanningWindow,
} = require('../_lib/auth');

const handlers = {

  // ---------------- auth ----------------
  async app_login({ p_username, p_password }) {
    const { rows } = await sql`select * from users where username = ${p_username}`;
    if (!rows.length) throw new AppError('ไม่พบชื่อผู้ใช้นี้');
    const u = rows[0];
    if (u.needs_pw) throw new AppError('ยังไม่ได้ตั้งรหัสผ่าน กรุณาไปที่ "ตั้งรหัสผ่านครั้งแรก"');
    if (!(await verifyPassword(u.id, p_password))) throw new AppError('รหัสผ่านไม่ถูกต้อง');
    const token = crypto.randomUUID();
    await sql`insert into sessions (token, user_id) values (${token}, ${u.id})`;
    return { token, id: u.id, username: u.username, name: u.name, role: u.role };
  },

  async app_set_password({ p_username, p_password }) {
    if ((p_password || '').length < 6) throw new AppError('อย่างน้อย 6 ตัวอักษร');
    const { rows } = await sql`select * from users where username = ${p_username}`;
    if (!rows.length) throw new AppError('ไม่พบชื่อผู้ใช้ กรุณาติดต่อ Admin');
    const u = rows[0];
    if (!u.needs_pw) throw new AppError('บัญชีนี้ตั้งรหัสผ่านแล้ว กรุณา Login');
    const hash = await hashPassword(p_password);
    await sql`update users set pw_hash = ${hash}, needs_pw = false where id = ${u.id}`;
    return { ok: true };
  },

  async app_logout({ p_token }) {
    if (p_token) await sql`delete from sessions where token = ${p_token}`;
    return null;
  },

  // ---------------- reads (any logged-in user) ----------------
  async app_locations({ p_token }) {
    await requireUser(p_token);
    const { rows } = await sql`select * from locations order by sort_order`;
    return rows;
  },

  async app_holidays({ p_token }) {
    await requireUser(p_token);
    const { rows } = await sql`select id, to_char(date,'YYYY-MM-DD') as date, name from holidays order by date`;
    return rows;
  },

  async app_users_basic({ p_token }) {
    await requireUser(p_token);
    // The 'admin' account is a system/maintenance login only — it never
    // has real work-location data and should never show up in presence
    // lists. Other accounts with role='admin' still show normally.
    const { rows } = await sql`select id, name, username from users where username <> 'admin' order by name`;
    return rows;
  },

  async app_schedule_range({ p_token, p_start, p_end }) {
    await requireUser(p_token);
    // Same rule as app_users_basic: the 'admin' system account is excluded
    // from schedule views for everyone; other admin-role users show as usual.
    const { rows } = await sql`
      select s.user_id, to_char(s.date,'YYYY-MM-DD') as date, s.location_id
      from schedule s
      join users u on u.id = s.user_id
      where s.date >= ${p_start}::date and s.date <= ${p_end}::date
        and u.username <> 'admin'`;
    return rows;
  },

  // ---------------- writes (self, or admin acting for another user) ----------------
  async app_save_schedule({ p_token, p_date, p_location_id, p_target_user_id }) {
    const me = await requireUser(p_token);
    const target = p_target_user_id || me.id;
    if (target !== me.id && me.role !== 'admin') {
      throw new AppError('ไม่มีสิทธิ์แก้แผนของผู้อื่น');
    }
    assertWithinPlanningWindow(p_date);
    if (!p_location_id) {
      await sql`delete from schedule where user_id = ${target} and date = ${p_date}::date`;
    } else {
      await sql`
        insert into schedule (user_id, date, location_id, updated_at)
        values (${target}, ${p_date}::date, ${p_location_id}, now())
        on conflict (user_id, date)
        do update set location_id = excluded.location_id, updated_at = now()`;
    }
    return null;
  },

  async app_update_profile({ p_token, p_name }) {
    const me = await requireUser(p_token);
    await sql`update users set name = ${p_name} where id = ${me.id}`;
    return null;
  },

  async app_change_password({ p_token, p_old, p_new }) {
    const me = await requireUser(p_token);
    if ((p_new || '').length < 6) throw new AppError('อย่างน้อย 6 ตัวอักษร');
    if (!(await verifyPassword(me.id, p_old))) throw new AppError('รหัสผ่านเดิมไม่ถูกต้อง');
    const hash = await hashPassword(p_new);
    await sql`update users set pw_hash = ${hash}, needs_pw = false where id = ${me.id}`;
    return null;
  },

  // ---------------- admin: user management ----------------
  async app_list_users({ p_token }) {
    await requireAdmin(p_token);
    const { rows } = await sql`select id, username, name, role, needs_pw from users order by name`;
    return rows;
  },

  async app_add_user({ p_token, p_username, p_name, p_role }) {
    await requireAdmin(p_token);
    if (!p_username) throw new AppError('กรุณาใส่ username');
    if (!['user', 'admin'].includes(p_role)) throw new AppError('สิทธิ์ไม่ถูกต้อง');
    const { rows } = await sql`select 1 from users where username = ${p_username}`;
    if (rows.length) throw new AppError('Username นี้มีอยู่แล้ว');
    await sql`
      insert into users (username, name, role, pw_hash, needs_pw)
      values (${p_username}, ${p_name || ''}, ${p_role}, '', true)`;
    return { ok: true };
  },

  async app_edit_user({ p_token, p_user_id, p_name, p_role }) {
    await requireAdmin(p_token);
    if (!['user', 'admin'].includes(p_role)) throw new AppError('สิทธิ์ไม่ถูกต้อง');
    await sql`update users set name = ${p_name}, role = ${p_role} where id = ${p_user_id}`;
    return null;
  },

  async app_reset_password({ p_token, p_user_id }) {
    await requireAdmin(p_token);
    await sql`update users set pw_hash = '', needs_pw = true where id = ${p_user_id}`;
    await sql`delete from sessions where user_id = ${p_user_id}`;
    return null;
  },

  async app_delete_user({ p_token, p_user_id }) {
    const me = await requireAdmin(p_token);
    if (p_user_id === me.id) throw new AppError('ลบบัญชีตัวเองไม่ได้');
    await sql`delete from users where id = ${p_user_id}`; // schedule/sessions cascade
    return null;
  },

  // ---------------- admin: locations & holidays ----------------
  async app_save_location({ p_token, p_id, p_name, p_icon, p_color }) {
    await requireAdmin(p_token);
    if (!p_name) throw new AppError('กรุณากรอกชื่อ');
    const icon = p_icon || '📍';
    if (!p_id) {
      const newId = 'loc_' + crypto.randomUUID().replace(/-/g, '');
      await sql`
        insert into locations (id, name, icon, color, sort_order)
        values (${newId}, ${p_name}, ${icon}, ${p_color || '#888888'}, 99)`;
    } else {
      await sql`update locations set name = ${p_name}, icon = ${icon}, color = ${p_color} where id = ${p_id}`;
    }
    return { ok: true };
  },

  async app_delete_location({ p_token, p_id }) {
    await requireAdmin(p_token);
    await sql`delete from locations where id = ${p_id}`;
    return null;
  },

  async app_add_holiday({ p_token, p_date, p_name }) {
    await requireAdmin(p_token);
    if (!p_date || !p_name) throw new AppError('กรุณากรอกให้ครบ');
    const { rows } = await sql`select 1 from holidays where date = ${p_date}::date`;
    if (rows.length) throw new AppError('วันนี้มีอยู่แล้ว');
    await sql`insert into holidays (date, name) values (${p_date}::date, ${p_name})`;
    return { ok: true };
  },

  async app_delete_holiday({ p_token, p_id }) {
    await requireAdmin(p_token);
    await sql`delete from holidays where id = ${p_id}`;
    return null;
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const name = req.query.name;
  const fn = handlers[name];
  if (!fn) {
    res.status(404).json({ error: 'ไม่พบคำสั่งนี้' });
    return;
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await fn(body);
    res.status(200).json(data === undefined ? null : data);
  } catch (e) {
    const isAppError = e instanceof AppError;
    if (!isAppError) console.error(`[rpc:${name}]`, e);
    res.status(isAppError ? 400 : 500).json({ error: isAppError ? e.message : 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
  }
};
