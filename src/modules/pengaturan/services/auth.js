const bcrypt = require('bcryptjs');
const db = require('../../../config/db');

// Hash tiruan agar waktu respons sama saat username tidak ditemukan.
const HASH_TIRUAN = bcrypt.hashSync('tidak-dipakai', 10);

async function muatHakAkses(peranId) {
  const peran = await db.query('SELECT admin FROM peran WHERE id = $1 AND deleted_at IS NULL', [peranId]);
  if (!peran.rows.length) return { admin: false, izin: {} };
  const { rows } = await db.query(
    'SELECT modul, aksi FROM peran_izin WHERE peran_id = $1 AND deleted_at IS NULL', [peranId]);
  const izin = {};
  for (const r of rows) (izin[r.modul] ||= []).push(r.aksi);
  return { admin: peran.rows[0].admin, izin };
}

/** Memeriksa username & password. Mengembalikan pengguna atau null. */
async function verifikasiLogin(username, password) {
  const { rows } = await db.query(
    `SELECT id, password_hash FROM pengguna
     WHERE lower(username) = lower($1) AND aktif AND deleted_at IS NULL`, [username]);
  const cocok = await bcrypt.compare(password || '', rows[0] ? rows[0].password_hash : HASH_TIRUAN);
  if (!rows[0] || !cocok) return null;
  await db.query('UPDATE pengguna SET login_terakhir = now() WHERE id = $1', [rows[0].id]);
  return { id: rows[0].id };
}

/** Memuat pengguna aktif beserta hak aksesnya (dipanggil tiap request). */
async function muatPengguna(id) {
  const { rows } = await db.query(
    `SELECT p.id, p.username, p.nama, p.peran_id, r.nama AS peran
     FROM pengguna p JOIN peran r ON r.id = p.peran_id
     WHERE p.id = $1 AND p.aktif AND p.deleted_at IS NULL`, [id]);
  if (!rows.length) return null;
  const pengguna = rows[0];
  pengguna.hakAkses = await muatHakAkses(pengguna.peran_id);
  return pengguna;
}

module.exports = { verifikasiLogin, muatPengguna };
