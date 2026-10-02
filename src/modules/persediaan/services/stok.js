// Mesin stok: SATU-SATUNYA jalan mengubah saldo stok. Selalu dipanggil di dalam transaksi.
// HPP rata-rata bergerak per barang (global semua gudang). Semua hitungan qty & nilai di SQL NUMERIC.
const db = require('../../../config/db');
const { GalatBisnis } = require('../../../lib/galat');
const { formatKuantitas } = require('../../../lib/angka');

async function izinStokNegatif(klien) {
  const { rows } = await klien.query(
    `SELECT nilai FROM pengaturan WHERE kunci = 'izinkan_stok_negatif' AND deleted_at IS NULL`);
  return rows[0] ? rows[0].nilai === 'true' : false;
}

/**
 * Mencatat satu mutasi stok & memperbarui saldo dalam transaksi yang sama.
 * opsi: { tanggal, barangId, gudangId, arah: 'masuk'|'keluar', qty, nilai?, sumberJenis, sumberId,
 *         nomorSumber, keterangan, penggunaId }
 *  - masuk: nilai wajib (total nilai masuk, string 2 desimal)
 *  - keluar: nilai dihitung dari HPP rata-rata; bila diisi (mis. pembatalan) nilai itu yang dipakai
 * Mengembalikan { nilai } — nilai mutasi yang tercatat.
 */
async function catatMutasi(klien, opsi) {
  const { tanggal, barangId, gudangId, arah, qty } = opsi;
  if (!['masuk', 'keluar'].includes(arah)) throw new Error('Arah mutasi tidak valid');

  const { rows: [barang] } = await klien.query(
    'SELECT id, kode, nama, jenis FROM barang WHERE id = $1 AND deleted_at IS NULL', [barangId]);
  if (!barang) throw new GalatBisnis('Barang tidak ditemukan.');
  if (barang.jenis !== 'stok') throw new GalatBisnis(`${barang.kode} adalah barang jasa dan tidak memiliki stok.`);

  // Kunci saldo global barang (urutan kunci konsisten: saldo_barang lalu saldo_stok → hindari deadlock)
  await klien.query('INSERT INTO saldo_barang (barang_id) VALUES ($1) ON CONFLICT (barang_id) DO NOTHING', [barangId]);
  const { rows: [sb] } = await klien.query(
    'SELECT qty, nilai, hpp_terakhir, tanggal_akhir FROM saldo_barang WHERE barang_id = $1 FOR UPDATE', [barangId]);

  if (sb.tanggal_akhir && tanggal < sb.tanggal_akhir) {
    throw new GalatBisnis(
      `Tanggal ${tanggal} lebih awal dari mutasi terakhir ${barang.kode} (${sb.tanggal_akhir}). Transaksi stok bertanggal mundur tidak diizinkan.`);
  }

  await klien.query(
    'INSERT INTO saldo_stok (barang_id, gudang_id) VALUES ($1, $2) ON CONFLICT (barang_id, gudang_id) DO NOTHING',
    [barangId, gudangId]);
  const { rows: [ss] } = await klien.query(
    'SELECT qty FROM saldo_stok WHERE barang_id = $1 AND gudang_id = $2 FOR UPDATE', [barangId, gudangId]);

  let nilai;
  if (arah === 'masuk') {
    if (opsi.nilai === undefined || opsi.nilai === null) throw new Error('Nilai masuk wajib diisi');
    nilai = opsi.nilai;
  } else {
    const { rows: [cek] } = await klien.query('SELECT $1::numeric < $2::numeric AS kurang', [ss.qty, qty]);
    if (cek.kurang && !(await izinStokNegatif(klien))) {
      const { rows: [g] } = await klien.query('SELECT nama FROM gudang WHERE id = $1', [gudangId]);
      throw new GalatBisnis(
        `Stok ${barang.kode} · ${barang.nama} di ${g ? g.nama : 'gudang'} tidak cukup: tersedia ${formatKuantitas(ss.qty)}, dibutuhkan ${formatKuantitas(qty)}.`);
    }
    // Nilai keluar: bila saldo global habis → ambil seluruh nilai (tanpa sisa sen);
    // selain itu qty × rata-rata, dibulatkan 2 desimal.
    const { rows: [h] } = await klien.query(
      `SELECT CASE
         WHEN $2::numeric <= 0 THEN round($1::numeric * $4::numeric, 2)
         WHEN $1::numeric >= $2::numeric THEN $3::numeric + round(($1::numeric - $2::numeric) * $4::numeric, 2)
         WHEN $5::numeric IS NOT NULL THEN least($5::numeric, $3::numeric)
         ELSE round($1::numeric * $3::numeric / $2::numeric, 2)
       END AS nilai`,
      [qty, sb.qty, sb.nilai, sb.hpp_terakhir, opsi.nilai ?? null]);
    nilai = h.nilai;
  }

  const masuk = arah === 'masuk';
  const { rows: [baru] } = await klien.query(
    `UPDATE saldo_barang SET
       qty = qty + $2::numeric,
       nilai = nilai + $3::numeric,
       hpp_terakhir = CASE WHEN qty + $2::numeric > 0 THEN round((nilai + $3::numeric) / (qty + $2::numeric), 2) ELSE hpp_terakhir END,
       tanggal_akhir = greatest(coalesce(tanggal_akhir, $4::date), $4::date)
     WHERE barang_id = $1 RETURNING qty, nilai`,
    [barangId, masuk ? qty : `-${qty}`, masuk ? nilai : `-${nilai}`, tanggal]);
  const { rows: [baruGudang] } = await klien.query(
    'UPDATE saldo_stok SET qty = qty + $3::numeric WHERE barang_id = $1 AND gudang_id = $2 RETURNING qty',
    [barangId, gudangId, masuk ? qty : `-${qty}`]);

  await klien.query(
    `INSERT INTO mutasi_stok (tanggal, barang_id, gudang_id, qty_masuk, qty_keluar, nilai_masuk, nilai_keluar,
       harga_satuan, saldo_qty_gudang, saldo_qty, saldo_nilai, sumber_jenis, sumber_id, nomor_sumber, keterangan, dibuat_oleh)
     VALUES ($1, $2, $3, $4, $5, $6, $7, round($8::numeric / $9::numeric, 2), $10, $11, $12, $13, $14, $15, $16, $17)`,
    [tanggal, barangId, gudangId, masuk ? qty : 0, masuk ? 0 : qty, masuk ? nilai : 0, masuk ? 0 : nilai,
      nilai, qty, baruGudang.qty, baru.qty, baru.nilai,
      opsi.sumberJenis, opsi.sumberId, opsi.nomorSumber || null, opsi.keterangan || null, opsi.penggunaId || null]);

  return { nilai };
}

/** HPP rata-rata saat ini (untuk nilai default penyesuaian masuk). */
async function hppSaatIni(klien, barangId) {
  const { rows } = await klien.query('SELECT hpp_terakhir FROM saldo_barang WHERE barang_id = $1', [barangId]);
  return rows[0] ? rows[0].hpp_terakhir : null;
}

// ---------- Kueri tampilan ----------

/** Ringkasan stok per barang (opsional per gudang), dengan tanda di bawah minimum. */
async function ringkasan({ gudangId = null, q = '', hanyaKurang = false } = {}) {
  const param = [];
  const syarat = [`b.deleted_at IS NULL`, `b.jenis = 'stok'`, `b.aktif`];
  if (q) {
    param.push(`%${q.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    syarat.push(`(lower(b.kode) LIKE $${param.length} OR lower(b.nama) LIKE $${param.length})`);
  }
  let qtyExpr = 'coalesce(sb.qty, 0)';
  if (gudangId) {
    param.push(gudangId);
    qtyExpr = `coalesce((SELECT qty FROM saldo_stok s WHERE s.barang_id = b.id AND s.gudang_id = $${param.length}), 0)`;
  }
  const sql = `
    SELECT * FROM (
      SELECT b.id, b.kode, b.nama, b.stok_minimum, st.kode AS satuan,
             ${qtyExpr} AS qty, coalesce(sb.nilai, 0) AS nilai_global, coalesce(sb.qty, 0) AS qty_global,
             coalesce(sb.hpp_terakhir, 0) AS hpp
      FROM barang b
      JOIN satuan st ON st.id = b.satuan_id
      LEFT JOIN saldo_barang sb ON sb.barang_id = b.id
      WHERE ${syarat.join(' AND ')}
    ) x
    ${hanyaKurang ? 'WHERE x.qty < x.stok_minimum' : ''}
    ORDER BY x.kode LIMIT 500`;
  const { rows } = await db.query(sql, param);
  return rows.map((r) => ({ ...r, kurang: Number(r.stok_minimum) > 0 && compareNumeric(r.qty, r.stok_minimum) < 0 }));
}

/** Perbandingan string desimal tanpa float (hanya untuk penanda tampilan). */
function compareNumeric(a, b) {
  const [ai, af = ''] = String(a).replace('-', '').split('.');
  const [bi, bf = ''] = String(b).replace('-', '').split('.');
  const na = String(a).startsWith('-');
  const nb = String(b).startsWith('-');
  if (na !== nb) return na ? -1 : 1;
  const len = Math.max(af.length, bf.length);
  const A = BigInt(ai + af.padEnd(len, '0'));
  const B = BigInt(bi + bf.padEnd(len, '0'));
  const hasil = A === B ? 0 : A < B ? -1 : 1;
  return na ? -hasil : hasil;
}

/** Kartu stok satu barang di satu gudang (atau semua gudang) dalam rentang tanggal. */
async function kartuStok({ barangId, gudangId = null, dari, sampai }) {
  const param = [barangId, dari, sampai];
  let filterGudang = '';
  if (gudangId) { param.push(gudangId); filterGudang = `AND m.gudang_id = $4`; }

  // Saldo awal periode = jumlah mutasi sebelum tanggal "dari"
  const { rows: [awal] } = await db.query(
    `SELECT coalesce(sum(qty_masuk - qty_keluar), 0) AS qty, coalesce(sum(nilai_masuk - nilai_keluar), 0) AS nilai
     FROM mutasi_stok m WHERE barang_id = $1 AND tanggal < $2 ${filterGudang.replace('$4', '$3')}`,
    gudangId ? [barangId, dari, gudangId] : [barangId, dari]);

  const { rows } = await db.query(
    `SELECT m.*, g.kode AS gudang_kode,
            $5::numeric + sum(m.qty_masuk - m.qty_keluar) OVER w AS saldo_berjalan,
            $6::numeric + sum(m.nilai_masuk - m.nilai_keluar) OVER w AS nilai_berjalan
     FROM mutasi_stok m JOIN gudang g ON g.id = m.gudang_id
     WHERE m.barang_id = $1 AND m.tanggal BETWEEN $2 AND $3 ${gudangId ? 'AND m.gudang_id = $4' : 'AND $4::bigint IS NULL'}
     WINDOW w AS (ORDER BY m.tanggal, m.id)
     ORDER BY m.tanggal, m.id`,
    [barangId, dari, sampai, gudangId, awal.qty, awal.nilai]);
  return { awal, baris: rows };
}

module.exports = { catatMutasi, hppSaatIni, ringkasan, kartuStok, compareNumeric };
