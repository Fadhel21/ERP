// Bantuan bersama dokumen persediaan (daftar, kunci, validasi baris).
const dayjs = require('dayjs');
const db = require('../../../config/db');
const { GalatBisnis } = require('../../../lib/galat');
const { parseDesimal } = require('../../../lib/angka');

class GalatValidasi extends GalatBisnis {
  constructor(galat) {
    super('Periksa kembali isian yang ditandai.', 422);
    this.galat = galat;
  }
}

const STATUS = { draft: 'Draft', diposting: 'Diposting', batal: 'Batal' };

function hariIni() {
  return dayjs().format('YYYY-MM-DD');
}

function validTanggal(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s).format('YYYY-MM-DD') === s;
}

/** Mengubah field berulang dari form (string atau array) menjadi array. */
function sebagaiArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Membaca baris detail dari body form. kolom: { nama: 'qty'|'harga_satuan'|... }.
 * Baris yang seluruhnya kosong diabaikan.
 */
function bacaBaris(body, kolom) {
  const panjang = Math.max(...kolom.map((k) => sebagaiArray(body[k]).length), 0);
  const baris = [];
  for (let i = 0; i < panjang; i++) {
    const b = {};
    for (const k of kolom) b[k] = String(sebagaiArray(body[k])[i] ?? '').trim();
    if (kolom.every((k) => b[k] === '')) continue;
    baris.push(b);
  }
  return baris;
}

/** Validasi qty (>0, 4 desimal) & harga (>=0, 2 desimal) per baris. Mengisi galat['baris.i.kolom']. */
function validasiAngkaBaris(baris, galat, { harga = false } = {}) {
  baris.forEach((b, i) => {
    const q = parseDesimal(b.qty, 4);
    if (q === null || /^-/.test(q) || /^0+(\.0+)?$/.test(q)) galat[`baris.${i}.qty`] = 'Qty harus lebih dari 0 (maks. 4 desimal).';
    else b.qty = q;
    if (harga) {
      const h = parseDesimal(b.harga_satuan === '' ? '0' : b.harga_satuan, 2);
      if (h === null || /^-/.test(h)) galat[`baris.${i}.harga_satuan`] = 'Harga tidak valid (maks. 2 desimal).';
      else b.harga_satuan = h;
    }
    if (!/^\d{1,18}$/.test(b.barang_id)) galat[`baris.${i}.barang_id`] = 'Pilih barang.';
  });
}

/** Memastikan semua barang ada, aktif, berjenis stok, dan tidak ganda. */
async function periksaBarang(klien, baris, galat) {
  const ids = baris.map((b) => b.barang_id).filter((x) => /^\d+$/.test(x));
  if (!ids.length) return;
  const { rows } = await klien.query(
    `SELECT id, kode, jenis, aktif FROM barang WHERE id = ANY($1) AND deleted_at IS NULL`, [ids]);
  const terlihat = new Set();
  baris.forEach((b, i) => {
    const r = rows.find((x) => x.id === b.barang_id);
    if (!r) galat[`baris.${i}.barang_id`] ||= 'Barang tidak ditemukan.';
    else if (r.jenis !== 'stok') galat[`baris.${i}.barang_id`] = `${r.kode} adalah jasa (tanpa stok).`;
    else if (!r.aktif) galat[`baris.${i}.barang_id`] = `${r.kode} sudah nonaktif.`;
    else if (terlihat.has(b.barang_id)) galat[`baris.${i}.barang_id`] = `${r.kode} sudah ada di baris lain.`;
    terlihat.add(b.barang_id);
  });
}

async function periksaGudang(klien, id, kolom, galat) {
  if (!/^\d{1,18}$/.test(String(id || ''))) { galat[kolom] = 'Pilih gudang.'; return; }
  const { rows } = await klien.query('SELECT 1 FROM gudang WHERE id = $1 AND aktif AND deleted_at IS NULL', [id]);
  if (!rows.length) galat[kolom] = 'Gudang tidak tersedia atau nonaktif.';
}

/** Mengunci dokumen & memastikan statusnya sesuai. */
async function kunciDokumen(klien, tabel, id, statusDiharapkan, label) {
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${label} tidak ditemukan.`, 404);
  const { rows } = await klien.query(`SELECT * FROM ${tabel} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
  if (!rows.length) throw new GalatBisnis(`${label} tidak ditemukan.`, 404);
  const dok = rows[0];
  if (statusDiharapkan && dok.status !== statusDiharapkan) {
    const pesan = {
      draft: `${label} ${dok.nomor || ''} sudah ${STATUS[dok.status].toLowerCase()} sehingga tidak bisa diubah.`,
      diposting: `${label} hanya bisa dibatalkan bila berstatus diposting.`,
    };
    throw new GalatBisnis((pesan[statusDiharapkan] || 'Status dokumen tidak sesuai.').replace(/\s+/g, ' '), 409);
  }
  return dok;
}

/** Daftar dokumen dengan filter status/tanggal/cari, paging 25. */
async function daftarDokumen({ tabel, pilih, gabung = '', filter }) {
  const param = [];
  const syarat = ['d.deleted_at IS NULL'];
  if (filter.status && STATUS[filter.status]) { param.push(filter.status); syarat.push(`d.status = $${param.length}`); }
  if (validTanggal(filter.dari)) { param.push(filter.dari); syarat.push(`d.tanggal >= $${param.length}`); }
  if (validTanggal(filter.sampai)) { param.push(filter.sampai); syarat.push(`d.tanggal <= $${param.length}`); }
  if (filter.q) {
    param.push(`%${String(filter.q).toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    syarat.push(`(lower(coalesce(d.nomor, '')) LIKE $${param.length} OR lower(coalesce(d.keterangan, '')) LIKE $${param.length})`);
  }
  const where = syarat.join(' AND ');
  const total = Number((await db.query(`SELECT count(*) FROM ${tabel} d WHERE ${where}`, param)).rows[0].count);
  const per = 25;
  const jumlahHal = Math.max(1, Math.ceil(total / per));
  const hal = Math.min(Math.max(1, Number(filter.hal) || 1), jumlahHal);
  const { rows } = await db.query(
    `SELECT d.*, ${pilih} FROM ${tabel} d ${gabung} WHERE ${where}
     ORDER BY d.tanggal DESC, d.id DESC LIMIT ${per} OFFSET ${(hal - 1) * per}`, param);
  return { baris: rows, total, hal, jumlahHal, perHalaman: per };
}

module.exports = {
  GalatValidasi, STATUS, hariIni, validTanggal, sebagaiArray, bacaBaris, validasiAngkaBaris,
  periksaBarang, periksaGudang, kunciDokumen, daftarDokumen,
};
