// Bantuan bersama dokumen pembelian.
const dayjs = require('dayjs');
const db = require('../../../config/db');
const { GalatBisnis } = require('../../../lib/galat');
const { parseDesimal } = require('../../../lib/angka');
const { akunDariPengaturan } = require('../../akuntansi/services/jurnal');

/** Tarif PPN & jumlah desimal pembulatan dari pengaturan. */
async function pengaturanPajak(klien = db) {
  const { rows } = await klien.query(
    `SELECT kunci, nilai FROM pengaturan WHERE kunci IN ('ppn_persen', 'pembulatan_desimal') AND deleted_at IS NULL`);
  const p = Object.fromEntries(rows.map((r) => [r.kunci, r.nilai]));
  return { tarif: p.ppn_persen || '0', desimal: Number(p.pembulatan_desimal || 0) };
}

/** Memastikan pemasok ada & aktif; mengembalikan barisnya. */
async function periksaPemasok(klien, id, galat, kolom = 'pemasok_id') {
  if (!/^\d{1,18}$/.test(String(id || ''))) { galat[kolom] = 'Pilih pemasok.'; return null; }
  const { rows } = await klien.query('SELECT * FROM pemasok WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!rows.length || !rows[0].aktif) { galat[kolom] = 'Pemasok tidak tersedia atau nonaktif.'; return null; }
  return rows[0];
}

async function akunHutang(klien, pemasokId) {
  const { rows } = await klien.query('SELECT akun_hutang_id FROM pemasok WHERE id = $1', [pemasokId]);
  return (rows[0] && rows[0].akun_hutang_id) || akunDariPengaturan(klien, 'akun_hutang');
}

/** Daftar akun kas/bank (berdasarkan prefiks di pengaturan). */
async function akunKasBank(klien = db) {
  const { rows: [p] } = await klien.query(`SELECT nilai FROM pengaturan WHERE kunci = 'prefiks_akun_kas' AND deleted_at IS NULL`);
  const prefiks = (p ? p.nilai : '1-11,1-12').split(',').map((s) => s.trim()).filter(Boolean);
  const { rows } = await klien.query(
    `SELECT id, kode, nama FROM akun WHERE NOT akun_header AND aktif AND deleted_at IS NULL
     AND kode LIKE ANY($1) ORDER BY kode`, [prefiks.map((x) => `${x}%`)]);
  return rows;
}

async function periksaAkunKas(klien, id, galat, kolom = 'akun_kas_id') {
  if (!/^\d{1,18}$/.test(String(id || ''))) { galat[kolom] = 'Pilih akun kas/bank.'; return; }
  if (!(await akunKasBank(klien)).some((a) => a.id === String(id))) galat[kolom] = 'Akun kas/bank tidak valid.';
}

/** Persen diskon: kosong = 0, maksimal 100, 2 desimal. */
function parsePersen(s) {
  if (s === undefined || s === null || String(s).trim() === '') return '0.00';
  const v = parseDesimal(s, 2);
  if (v === null || v.startsWith('-')) return null;
  const [bulat] = v.split('.');
  if (Number(bulat) > 100 || (Number(bulat) === 100 && !/\.00$/.test(v))) return null;
  return v;
}

function parseUang(s, { bolehNol = true } = {}) {
  const v = parseDesimal(s === '' || s === undefined ? (bolehNol ? '0' : '') : s, 2);
  if (v === null || v.startsWith('-')) return null;
  if (!bolehNol && /^0+\.00$/.test(v)) return null;
  if (v.split('.')[0].length > 13) return null;
  return v;
}

function tambahHari(tanggal, hari) {
  return dayjs(tanggal).add(Number(hari) || 0, 'day').format('YYYY-MM-DD');
}

function cekKe(cond, pesan) {
  if (!cond) throw new GalatBisnis(pesan);
}

// ---------- Opsi dropdown form ----------
async function daftarPemasok() {
  return (await db.query(`SELECT id, kode, nama, termin_hari FROM pemasok WHERE aktif AND deleted_at IS NULL ORDER BY nama`)).rows;
}
async function barangBeli() {
  return (await db.query(
    `SELECT b.id, b.kode, b.nama, s.kode AS satuan, b.harga_beli, b.kena_ppn FROM barang b JOIN satuan s ON s.id = b.satuan_id
     WHERE b.aktif AND b.deleted_at IS NULL AND b.jenis = 'stok' ORDER BY b.kode`)).rows;
}

module.exports = { daftarPemasok, barangBeli, pengaturanPajak, periksaPemasok, akunHutang, akunKasBank, periksaAkunKas, parsePersen, parseUang, tambahHari, cekKe };
