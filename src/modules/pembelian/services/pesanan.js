// Pesanan pembelian (PO). Posting tidak mengubah stok/jurnal — hanya komitmen.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { hitungBaris, jumlahkanBaris } = require('../../../lib/pajak');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const u = require('../../persediaan/services/umum');
const p = require('./umum');

const TABEL = 'pesanan_pembelian';
const LABEL = 'Pesanan pembelian';
const STATUS_TERIMA = { belum: 'Belum diterima', sebagian: 'Diterima sebagian', selesai: 'Diterima penuh' };

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: 'ps.nama AS pemasok_nama', gabung: 'JOIN pemasok ps ON ps.id = d.pemasok_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, ps.kode AS pemasok_kode, ps.nama AS pemasok_nama, pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, x.qty - x.qty_diterima AS qty_sisa, b.kode, b.nama, s.kode AS satuan
     FROM pesanan_pembelian_detail x JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE x.po_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  return { ...dok, baris };
}

/** Membaca & menghitung baris (harga belum termasuk PPN). */
async function siapkanBaris(klien, masukan, pakaiPpn, galat) {
  const baris = u.bacaBaris(masukan, ['barang_id', 'qty', 'harga', 'diskon_persen']);
  if (!baris.length) galat.baris = 'Isi minimal satu baris barang.';
  u.validasiAngkaBaris(baris, galat);
  baris.forEach((b, i) => {
    const h = p.parseUang(b.harga);
    if (h === null) galat[`baris.${i}.harga`] = 'Harga tidak valid.'; else b.harga = h;
    const d = p.parsePersen(b.diskon_persen);
    if (d === null) galat[`baris.${i}.diskon_persen`] = 'Diskon 0–100%.'; else b.diskon_persen = d;
  });
  await u.periksaBarang(klien, baris, galat);
  if (Object.keys(galat).length) return { baris };
  const { tarif, desimal } = await p.pengaturanPajak(klien);
  const { rows: brg } = await klien.query('SELECT id, kena_ppn FROM barang WHERE id = ANY($1)', [baris.map((b) => b.barang_id)]);
  for (const b of baris) {
    b.kena_ppn = pakaiPpn && brg.find((x) => x.id === b.barang_id).kena_ppn;
    Object.assign(b, hitungBaris({ qty: b.qty, harga: b.harga, diskonPersen: b.diskon_persen, kenaPpn: b.kena_ppn, tarifPpn: tarif, desimal }));
  }
  return { baris, tarif, total: jumlahkanBaris(baris) };
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'pembelian', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    pemasok_id: String(masukan.pemasok_id || ''),
    tanggal_kirim: String(masukan.tanggal_kirim || '') || null,
    pakai_ppn: masukan.pakai_ppn === 'on' || masukan.pakai_ppn === true,
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  if (data.tanggal_kirim && !u.validTanggal(data.tanggal_kirim)) galat.tanggal_kirim = 'Tanggal tidak valid.';

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await p.periksaPemasok(klien, data.pemasok_id, galat);
    const { baris, tarif, total } = await siapkanBaris(klien, masukan, data.pakai_ppn, galat);
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    const nilai = [data.tanggal, data.pemasok_id, data.tanggal_kirim, data.pakai_ppn, tarif, total.dpp, total.ppn, total.total, data.keterangan];
    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal=$1, pemasok_id=$2, tanggal_kirim=$3, pakai_ppn=$4, ppn_persen=$5, total_dpp=$6, total_ppn=$7, total=$8, keterangan=$9
         WHERE id = $10 RETURNING *`, [...nilai, id])).rows[0];
      await klien.query('UPDATE pesanan_pembelian_detail SET deleted_at = now() WHERE po_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, pemasok_id, tanggal_kirim, pakai_ppn, ppn_persen, total_dpp, total_ppn, total, keterangan, dibuat_oleh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [...nilai, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query(
        `INSERT INTO pesanan_pembelian_detail (po_id, barang_id, qty, harga, diskon_persen, kena_ppn, bruto, diskon, dpp, ppn, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [dok.id, b.barang_id, b.qty, b.harga, b.diskon_persen, b.kena_ppn, b.bruto, b.diskon, b.dpp, b.ppn, b.total]);
    }
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: dok.id, aksi: id ? 'ubah' : 'tambah', sebelum: lama, sesudah: { ...dok, baris } });
    return dok;
  });
}

async function hapusDraft(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'hapus');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await klien.query(`UPDATE ${TABEL} SET deleted_at = now() WHERE id = $1`, [id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'hapus', sebelum: dok });
    return dok;
  });
}

async function posting(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'posting');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await pastikanPeriodeTerbuka(klien, dok.tanggal);
    const nomor = await nomorBerikutnya(klien, 'PO', dok.tanggal);
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, diposting_oleh = $2, diposting_pada = now() WHERE id = $3 RETURNING *`,
      [nomor, pengguna.id, id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'posting', sebelum: dok, sesudah: baru });
    return baru;
  });
}

async function batal(pengguna, id, alasan) {
  pastikanAkses(pengguna, 'pembelian', 'batal');
  alasan = String(alasan || '').trim();
  if (!alasan) throw new GalatBisnis('Alasan pembatalan wajib diisi.');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'diposting', LABEL);
    const { rows } = await klien.query(
      `SELECT pb.nomor FROM penerimaan_barang pb WHERE pb.po_id = $1 AND pb.status = 'diposting' AND pb.deleted_at IS NULL`, [id]);
    if (rows.length) throw new GalatBisnis(`PO sudah diterima (${rows.map((r) => r.nomor).join(', ')}). Batalkan penerimaannya terlebih dahulu.`, 409);
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', dibatalkan_oleh = $1, dibatalkan_pada = now(), alasan_batal = $2 WHERE id = $3 RETURNING *`,
      [pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

/** Memperbarui status_terima PO berdasarkan qty_diterima. Dipanggil di dalam transaksi. */
async function perbaruiStatusTerima(klien, poId) {
  await klien.query(
    `UPDATE ${TABEL} SET status_terima = (
       SELECT CASE WHEN sum(qty_diterima) = 0 THEN 'belum'
                   WHEN bool_and(qty_diterima >= qty) THEN 'selesai' ELSE 'sebagian' END
       FROM pesanan_pembelian_detail WHERE po_id = $1 AND deleted_at IS NULL)
     WHERE id = $1`, [poId]);
}

/** PO terbuka (diposting & belum diterima penuh) untuk form penerimaan. */
async function poTerbuka() {
  const { rows } = await db.query(
    `SELECT d.id, d.nomor, d.tanggal, ps.nama AS pemasok_nama FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id
     WHERE d.status = 'diposting' AND d.status_terima <> 'selesai' AND d.deleted_at IS NULL ORDER BY d.tanggal, d.id`);
  return rows;
}

module.exports = { STATUS_TERIMA, daftar, ambil, simpanDraft, hapusDraft, posting, batal, perbaruiStatusTerima, poTerbuka };
