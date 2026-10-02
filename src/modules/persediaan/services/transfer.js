// Mutasi (transfer) antar gudang. Nilai persediaan total tidak berubah → tanpa jurnal.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { catatMutasi } = require('./stok');
const u = require('./umum');

const TABEL = 'transfer_gudang';
const LABEL = 'Mutasi antar gudang';

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'persediaan', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: `ga.nama AS asal_nama, gt.nama AS tujuan_nama,
            (SELECT count(*) FROM transfer_gudang_detail x WHERE x.transfer_id = d.id AND x.deleted_at IS NULL) AS jumlah_baris`,
    gabung: 'JOIN gudang ga ON ga.id = d.gudang_asal_id JOIN gudang gt ON gt.id = d.gudang_tujuan_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, ga.nama AS asal_nama, gt.nama AS tujuan_nama,
            pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN gudang ga ON ga.id = d.gudang_asal_id JOIN gudang gt ON gt.id = d.gudang_tujuan_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh
     LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, b.kode, b.nama, s.kode AS satuan FROM transfer_gudang_detail x
     JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE x.transfer_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  return { ...dok, baris };
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'persediaan', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    gudang_asal_id: String(masukan.gudang_asal_id || ''),
    gudang_tujuan_id: String(masukan.gudang_tujuan_id || ''),
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  const baris = u.bacaBaris(masukan, ['barang_id', 'qty']);
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  if (!baris.length) galat.baris = 'Isi minimal satu baris barang.';
  u.validasiAngkaBaris(baris, galat);

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await u.periksaGudang(klien, data.gudang_asal_id, 'gudang_asal_id', galat);
    await u.periksaGudang(klien, data.gudang_tujuan_id, 'gudang_tujuan_id', galat);
    if (!galat.gudang_tujuan_id && data.gudang_asal_id === data.gudang_tujuan_id) galat.gudang_tujuan_id = 'Gudang tujuan harus berbeda dari gudang asal.';
    await u.periksaBarang(klien, baris, galat);
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal = $1, gudang_asal_id = $2, gudang_tujuan_id = $3, keterangan = $4 WHERE id = $5 RETURNING *`,
        [data.tanggal, data.gudang_asal_id, data.gudang_tujuan_id, data.keterangan, id])).rows[0];
      await klien.query('UPDATE transfer_gudang_detail SET deleted_at = now() WHERE transfer_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, gudang_asal_id, gudang_tujuan_id, keterangan, dibuat_oleh)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.tanggal, data.gudang_asal_id, data.gudang_tujuan_id, data.keterangan, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query('INSERT INTO transfer_gudang_detail (transfer_id, barang_id, qty) VALUES ($1, $2, $3)', [dok.id, b.barang_id, b.qty]);
    }
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: dok.id, aksi: id ? 'ubah' : 'tambah', sebelum: lama, sesudah: { ...dok, baris } });
    return dok;
  });
}

async function hapusDraft(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'hapus');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await klien.query(`UPDATE ${TABEL} SET deleted_at = now() WHERE id = $1`, [id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'hapus', sebelum: dok });
    return dok;
  });
}

/** Memindahkan qty dari satu gudang ke gudang lain dengan nilai yang sama (HPP global tidak berubah). */
async function pindahkan(klien, { tanggal, barangId, dari, ke, qty, nilai, dok, nomor, keterangan, penggunaId }) {
  const keluar = await catatMutasi(klien, {
    tanggal, barangId, gudangId: dari, arah: 'keluar', qty, nilai,
    sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, keterangan, penggunaId,
  });
  await catatMutasi(klien, {
    tanggal, barangId, gudangId: ke, arah: 'masuk', qty, nilai: keluar.nilai,
    sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, keterangan, penggunaId,
  });
  return keluar.nilai;
}

async function posting(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'posting');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await pastikanPeriodeTerbuka(klien, dok.tanggal);
    const { rows: baris } = await klien.query(
      'SELECT * FROM transfer_gudang_detail WHERE transfer_id = $1 AND deleted_at IS NULL ORDER BY id', [id]);
    if (!baris.length) throw new GalatBisnis('Dokumen tidak memiliki baris barang.');
    const nomor = await nomorBerikutnya(klien, 'TRF', dok.tanggal);
    for (const b of baris) {
      const nilai = await pindahkan(klien, {
        tanggal: dok.tanggal, barangId: b.barang_id, dari: dok.gudang_asal_id, ke: dok.gudang_tujuan_id,
        qty: b.qty, dok, nomor, keterangan: 'Mutasi antar gudang', penggunaId: pengguna.id,
      });
      await klien.query('UPDATE transfer_gudang_detail SET nilai = $1 WHERE id = $2', [nilai, b.id]);
    }
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, diposting_oleh = $2, diposting_pada = now() WHERE id = $3 RETURNING *`,
      [nomor, pengguna.id, id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'posting', sebelum: dok, sesudah: baru });
    return baru;
  });
}

async function batal(pengguna, id, alasan) {
  pastikanAkses(pengguna, 'persediaan', 'batal');
  alasan = String(alasan || '').trim();
  if (!alasan) throw new GalatBisnis('Alasan pembatalan wajib diisi.');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'diposting', LABEL);
    const tanggal = u.hariIni();
    await pastikanPeriodeTerbuka(klien, tanggal);
    const { rows: baris } = await klien.query(
      'SELECT * FROM transfer_gudang_detail WHERE transfer_id = $1 AND deleted_at IS NULL ORDER BY id DESC', [id]);
    for (const b of baris) {
      await pindahkan(klien, {
        tanggal, barangId: b.barang_id, dari: dok.gudang_tujuan_id, ke: dok.gudang_asal_id,
        qty: b.qty, nilai: b.nilai, dok, nomor: dok.nomor, keterangan: `Batal ${dok.nomor}`, penggunaId: pengguna.id,
      });
    }
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', dibatalkan_oleh = $1, dibatalkan_pada = now(), alasan_batal = $2 WHERE id = $3 RETURNING *`,
      [pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

module.exports = { daftar, ambil, simpanDraft, hapusDraft, posting, batal };
