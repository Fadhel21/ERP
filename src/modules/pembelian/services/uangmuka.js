// Uang muka pembelian: D Uang Muka Pembelian / K Kas-Bank. Dipakai lewat pembayaran hutang metode "uang_muka".
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { keSen } = require('../../../lib/uang');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, balikJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const u = require('../../persediaan/services/umum');
const p = require('./umum');

const TABEL = 'uang_muka_pembelian';
const LABEL = 'Uang muka pembelian';

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: 'ps.nama AS pemasok_nama, d.jumlah - d.dipakai AS sisa', gabung: 'JOIN pemasok ps ON ps.id = d.pemasok_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, d.jumlah - d.dipakai AS sisa, ps.nama AS pemasok_nama, a.kode || ' · ' || a.nama AS akun_kas_label,
            j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor, pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id JOIN akun a ON a.id = d.akun_kas_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  return { ...dok, baris: [] };
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'pembelian', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    pemasok_id: String(masukan.pemasok_id || ''),
    akun_kas_id: String(masukan.akun_kas_id || ''),
    jumlah: p.parseUang(masukan.jumlah, { bolehNol: false }),
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  if (data.jumlah === null) galat.jumlah = 'Jumlah harus lebih dari 0 (maks. 2 desimal).';
  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await p.periksaPemasok(klien, data.pemasok_id, galat);
    await p.periksaAkunKas(klien, data.akun_kas_id, galat);
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);
    const nilai = [data.tanggal, data.pemasok_id, data.akun_kas_id, data.jumlah, data.keterangan];
    const dok = id
      ? (await klien.query(`UPDATE ${TABEL} SET tanggal=$1, pemasok_id=$2, akun_kas_id=$3, jumlah=$4, keterangan=$5 WHERE id = $6 RETURNING *`, [...nilai, id])).rows[0]
      : (await klien.query(`INSERT INTO ${TABEL} (tanggal, pemasok_id, akun_kas_id, jumlah, keterangan, dibuat_oleh) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [...nilai, pengguna.id])).rows[0];
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: dok.id, aksi: id ? 'ubah' : 'tambah', sebelum: lama, sesudah: dok });
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
    const nomor = await nomorBerikutnya(klien, 'UMB', dok.tanggal);
    const jurnal = await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `Uang muka pembelian ${nomor}`, sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor,
      baris: [{ akun_id: await akunDariPengaturan(klien, 'akun_uang_muka_beli'), debit: dok.jumlah }, { akun_id: dok.akun_kas_id, kredit: dok.jumlah }],
      penggunaId: pengguna.id,
    });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, jurnal_id = $2, diposting_oleh = $3, diposting_pada = now() WHERE id = $4 RETURNING *`,
      [nomor, jurnal.id, pengguna.id, id]);
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
    if (keSen(dok.dipakai) > 0n) throw new GalatBisnis('Uang muka sudah dipakai untuk pembayaran. Batalkan pembayarannya terlebih dahulu.', 409);
    const jurnal = await balikJurnal(klien, dok.jurnal_id, { tanggal: u.hariIni(), keterangan: `Pembatalan ${dok.nomor}: ${alasan}`, penggunaId: pengguna.id });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', jurnal_batal_id = $1, dibatalkan_oleh = $2, dibatalkan_pada = now(), alasan_batal = $3 WHERE id = $4 RETURNING *`,
      [jurnal.id, pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

async function tersedia(pemasokId) {
  if (!/^\d{1,18}$/.test(String(pemasokId || ''))) return [];
  const { rows } = await db.query(
    `SELECT id, nomor, tanggal, jumlah, jumlah - dipakai AS sisa FROM ${TABEL}
     WHERE pemasok_id = $1 AND status = 'diposting' AND deleted_at IS NULL AND jumlah > dipakai ORDER BY tanggal, id`, [pemasokId]);
  return rows;
}

module.exports = { daftar, ambil, simpanDraft, hapusDraft, posting, batal, tersedia };
