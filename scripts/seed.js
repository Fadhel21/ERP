// Membuat peran Administrator dan akun admin awal bila belum ada.
// Pemakaian (PowerShell): node scripts/seed.js admin "PasswordKuat123"
const bcrypt = require('bcryptjs');

async function seed(username, password) {
  const { transaksi, pool } = require('../src/config/db');
  if (!username || !password || password.length < 8) {
    throw new Error('Pemakaian: node scripts/seed.js <username> <password minimal 8 karakter>');
  }
  const hash = await bcrypt.hash(password, 10);
  await transaksi(async (client) => {
    let { rows } = await client.query(
      `SELECT id FROM peran WHERE lower(nama) = 'administrator' AND deleted_at IS NULL`);
    if (!rows.length) {
      ({ rows } = await client.query(
        `INSERT INTO peran (nama, keterangan, admin) VALUES ('Administrator', 'Akses penuh', true) RETURNING id`));
    }
    const peranId = rows[0].id;
    const ada = await client.query(
      'SELECT id FROM pengguna WHERE lower(username) = lower($1) AND deleted_at IS NULL', [username]);
    if (ada.rows.length) {
      console.log(`Pengguna "${username}" sudah ada, tidak diubah.`);
      return;
    }
    await client.query(
      'INSERT INTO pengguna (username, nama, password_hash, peran_id) VALUES ($1, $2, $3, $4)',
      [username, 'Administrator', hash, peranId]);
    console.log(`✔ Pengguna admin "${username}" dibuat.`);
  });
  await pool.end();
}

if (require.main === module) {
  seed(process.argv[2], process.argv[3]).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
