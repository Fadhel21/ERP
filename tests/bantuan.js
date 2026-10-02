// Bantuan tes: menyiapkan env dan database tes yang bersih.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'rahasia-tes-jwt-minimal-32-karakter-xx';
process.env.COOKIE_SECRET ||= 'rahasia-tes-cookie-minimal-32-karakter';

const adaDbTes = !!process.env.DATABASE_URL_TES;
const alasanLewati = adaDbTes ? false : 'DATABASE_URL_TES belum diisi di .env';

/** Mengosongkan skema database tes lalu menjalankan semua migrasi. */
async function siapkanDb() {
  const nama = new URL(process.env.DATABASE_URL_TES).pathname.slice(1);
  // Pengaman: jangan pernah mengosongkan database selain database tes.
  if (!nama.endsWith('_tes')) throw new Error(`Database tes harus berakhiran "_tes" (sekarang: ${nama})`);
  const { pool } = require('../src/config/db');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await require('../scripts/migrate').jalankanMigrasi({ diam: true });
  return pool;
}

module.exports = { adaDbTes, alasanLewati, siapkanDb };
