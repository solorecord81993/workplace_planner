const { sql } = require('@vercel/postgres');

// to_char(...) so dates always come back as plain 'YYYY-MM-DD' strings,
// matching what the front-end's ds() function produces — no timezone drift.
module.exports = { sql };
