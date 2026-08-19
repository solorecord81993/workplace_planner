const { sql } = require('../_lib/db');

// Vercel Cron (see vercel.json) hits this on the 1st of every month.
// Protect it with CRON_SECRET (Vercel sets the Authorization header
// automatically for cron-triggered requests once CRON_SECRET is set
// as an env var — see README "ตั้งค่า Environment Variables").
module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const sched = await sql`delete from schedule where date < (current_date - interval '3 months')`;
    const sess = await sql`delete from sessions where expires_at < now()`;
    res.status(200).json({
      ok: true,
      deleted_schedule_rows: sched.rowCount,
      deleted_expired_sessions: sess.rowCount,
      ran_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[cron:cleanup]', e);
    res.status(500).json({ error: 'cleanup failed' });
  }
};
