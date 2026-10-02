// Stok opname: catat qty fisik; saat posting, selisih terhadap saldo terkini dijadikan mutasi + jurnal.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { parseDesimal } = require('../../../lib/angka');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const { catatMutasi } = require('./stok');
const u = require('./umum');

const TABEL = 'stok_opname';
const LABEL = 'Stok opname';

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'persediaan', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: `g.nama AS gudang_nama,
            (SELECT count(*) FROM stok_opname_detail x WHERE x.opname_id = d.id AND x.deleted_at IS NULL AND x.qty_fisik IS NOT NULL) AS jumlah_dihitung,
            (SELECT count(*) FROM stok_opname_detail x WHERE x.opname_id = d.id AND x.deleted_at IS NULL) AS jumlah_baris`,
    gabung: 'JOIN gudang g ON g.id = d.gudang_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, g.nama AS gudang_nama, j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor,
            pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN gudang g ON g.id = d.gudang_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh
     LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  // Untuk draft, tampilkan qty sistem terkini (bukan snapshot) agar selisih yang terlihat akurat
  const { rows: baris } = await db.query(
    `SELECT x.*, b.kode, b.nama, s.kode AS satuan,
            coalesce((SELECT qty FROM saldo_stok ss WHERE ss.barang_id = x.barang_id AND ss.gudang_id = $2), 0) AS qty_terkini
     FROM stok_opname_detail x JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE x.opname_id = $1 AND x.deleted_at IS NULL ORDER BY b.kode`, [id, dok.gudang_id]);
  return { ...dok, baris };
}

/** Membuat draft opname: semua barang stok aktif (opsional per kategori) dengan qty sistem saat ini. */
async function buat(pengguna, masukan) {
  pastikanAkses(pengguna, 'persediaan', 'tambah');
  const galat = {};
  const tanggal = String(masukan.tanggal || '');
  const gudangId = String(masukan.gudang_id || '');
  const kategoriId = String(masukan.kategori_id || '') || null;
  const keterangan = String(masukan.keterangan || '').trim().slice(0, 500) || null;
  if (!u.validTanggal(tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  if (kategoriId && !/^\d{1,18}$/.test(kategoriId)) galat.kategori_id = 'Kategori tidak valid.';

  return db.transaksi(async (klien) => {
    await u.periksaGudang(klien, gudangId, 'gudang_id', galat);
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);
    const { rows: [dok] } = await klien.query(
      `INSERT INTO ${TABEL} (tanggal, gudang_id, keterangan, dibuat_oleh) VALUES ($1, $2, $3, $4) RETURNING *`,
      [tanggal, gudangId, keterangan, pengguna.id]);
    const { rowCount } = await klien.query(
      `INSERT INTO stok_opname_detail (opname_id, barang_id, qty_sistem)
       SELECT $1, b.id, coalesce(ss.qty, 0) FROM barang b
       LEFT JOIN saldo_stok ss ON ss.barang_id = b.id AND ss.gudang_id = $2
       WHERE b.deleted_at IS NULL AND b.aktif AND b.jenis = 'stok' ${kategoriId ? 'AND b.kategori_id = $3' : ''}`,
      kategoriId ? [dok.id, gudangId, kategoriId] : [dok.id, gudangId]);
    if (!rowCount) throw new u.GalatValidasi({ kategori_id: 'Tidak ada barang stok aktif untuk dihitung.' });
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: dok.id, aksi: 'tambah', sesudah: dok });
    return dok;
  });
}

/** Menyimpan qty fisik (draft). masukan.fisik_<detailId> = angka atau kosong. */
async function simpanHitungan(pengguna, id, masukan) {
  pastikanAkses(pengguna, 'persediaan', 'ubah');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    const { rows: baris } = await klien.query(
      'SELECT id FROM stok_opname_detail WHERE opname_id = $1 AND deleted_at IS NULL', [id]);
    const galat = {};
    const ubah = [];
    for (const b of baris) {
      const mentah = masukan[`fisik_${b.id}`];
      if (mentah === undefined) continue;
      const s = String(mentah).trim();
      if (s === '') { ubah.push([b.id, null]); continue; }
      const q = parseDesimal(s, 4);
      if (q === null || q.startsWith('-')) galat[`fisik_${b.id}`] = 'Qty fisik tidak valid.';
      else ubah.push([b.id, q]);
    }
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);
    for (const [detailId, q] of ubah) {
      await klien.query('UPDATE stok_opname_detail SET qty_fisik = $1 WHERE id = $2', [q, detailId]);
    }
    if (masukan.keterangan !== undefined) {
      await klien.query(`UPDATE ${TABEL} SET keterangan = $1 WHERE id = $2`, [String(masukan.keterangan).trim().slice(0, 500) || null, id]);
    }
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'ubah', sebelum: dok, sesudah: { hitungan: ubah } });
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

async function posting(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'posting');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await pastikanPeriodeTerbuka(klien, dok.tanggal);
    const { rows: baris } = await klien.query(
      `SELECT x.*, b.akun_persediaan_id, b.harga_beli FROM stok_opname_detail x JOIN barang b ON b.id = x.barang_id
       WHERE x.opname_id = $1 AND x.deleted_at IS NULL AND x.qty_fisik IS NOT NULL ORDER BY x.id`, [id]);
    if (!baris.length) throw new GalatBisnis('Belum ada qty fisik yang diisi.');

    const nomor = await nomorBerikutnya(klien, 'OPN', dok.tanggal);
    const akunSelisih = await akunDariPengaturan(klien, 'akun_selisih_persediaan');
    let akunBawaan = null;
    const jurnalBaris = [];

    for (const b of baris) {
      // Qty sistem diambil ulang saat posting (terkunci) agar selisih akurat
      await klien.query(
        'INSERT INTO saldo_stok (barang_id, gudang_id) VALUES ($1, $2) ON CONFLICT (barang_id, gudang_id) DO NOTHING',
        [b.barang_id, dok.gudang_id]);
      const { rows: [s] } = await klien.query(
        `SELECT ss.qty AS sistem, $3::numeric - ss.qty AS selisih,
                CASE WHEN $3::numeric > ss.qty THEN 'masuk' WHEN $3::numeric < ss.qty THEN 'keluar' ELSE 'sama' END AS arah,
                abs($3::numeric - ss.qty) AS qty_abs,
                coalesce(nullif(sb.hpp_terakhir, 0), $4::numeric) AS harga
         FROM saldo_stok ss LEFT JOIN saldo_barang sb ON sb.barang_id = ss.barang_id
         WHERE ss.barang_id = $1 AND ss.gudang_id = $2 FOR UPDATE OF ss`,
        [b.barang_id, dok.gudang_id, b.qty_fisik, b.harga_beli]);
      let nilaiBertanda = '0';
      if (s.arah !== 'sama') {
        const masuk = s.arah === 'masuk';
        const qty = s.qty_abs;
        const nilaiMasuk = masuk
          ? (await klien.query('SELECT round($1::numeric * $2::numeric, 2) AS n', [qty, s.harga])).rows[0].n : undefined;
        const hasil = await catatMutasi(klien, {
          tanggal: dok.tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: masuk ? 'masuk' : 'keluar',
          qty, nilai: nilaiMasuk, sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor,
          keterangan: 'Selisih stok opname', penggunaId: pengguna.id,
        });
        nilaiBertanda = masuk ? hasil.nilai : `-${hasil.nilai}`;
        const akunP = b.akun_persediaan_id || (akunBawaan ||= await akunDariPengaturan(klien, 'akun_persediaan'));
        jurnalBaris.push(
          { akun_id: akunP, debit: masuk ? hasil.nilai : '0', kredit: masuk ? '0' : hasil.nilai },
          { akun_id: akunSelisih, debit: masuk ? '0' : hasil.nilai, kredit: masuk ? hasil.nilai : '0' });
      }
      await klien.query(
        'UPDATE stok_opname_detail SET qty_sistem = $1, qty_selisih = $2, nilai_selisih = $3 WHERE id = $4',
        [s.sistem, s.selisih, nilaiBertanda, b.id]);
    }
    const jurnal = jurnalBaris.length ? await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `Selisih stok opname ${nomor}`, sumberJenis: TABEL, sumberId: dok.id,
      nomorSumber: nomor, baris: jurnalBaris, penggunaId: pengguna.id,
    }) : null;
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, jurnal_id = $2, diposting_oleh = $3, diposting_pada = now()
       WHERE id = $4 RETURNING *`, [nomor, jurnal ? jurnal.id : null, pengguna.id, id]);
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
      `SELECT x.*, b.akun_persediaan_id FROM stok_opname_detail x JOIN barang b ON b.id = x.barang_id
       WHERE x.opname_id = $1 AND x.deleted_at IS NULL AND x.qty_selisih <> 0 ORDER BY x.id DESC`, [id]);
    const akunSelisih = await akunDariPengaturan(klien, 'akun_selisih_persediaan');
    let akunBawaan = null;
    const jurnalBaris = [];
    for (const b of baris) {
      const masukAsal = !b.qty_selisih.startsWith('-');
      const hasil = await catatMutasi(klien, {
        tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: masukAsal ? 'keluar' : 'masuk',
        qty: b.qty_selisih.replace('-', ''), nilai: b.nilai_selisih.replace('-', ''),
        sumberJenis: TABEL, sumberId: dok.id, nomorSumber: dok.nomor, keterangan: `Batal ${dok.nomor}`, penggunaId: pengguna.id,
      });
      const akunP = b.akun_persediaan_id || (akunBawaan ||= await akunDariPengaturan(klien, 'akun_persediaan'));
      jurnalBaris.push(
        { akun_id: akunP, debit: masukAsal ? '0' : hasil.nilai, kredit: masukAsal ? hasil.nilai : '0' },
        { akun_id: akunSelisih, debit: masukAsal ? hasil.nilai : '0', kredit: masukAsal ? '0' : hasil.nilai });
    }
    const jurnal = jurnalBaris.length ? await buatJurnal(klien, {
      tanggal, keterangan: `Pembatalan ${dok.nomor}: ${alasan}`, sumberJenis: TABEL, sumberId: dok.id,
      nomorSumber: dok.nomor, baris: jurnalBaris, penggunaId: pengguna.id, membalikId: dok.jurnal_id,
    }) : null;
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', jurnal_batal_id = $1, dibatalkan_oleh = $2, dibatalkan_pada = now(), alasan_batal = $3
       WHERE id = $4 RETURNING *`, [jurnal ? jurnal.id : null, pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

module.exports = { daftar, ambil, buat, simpanHitungan, hapusDraft, posting, batal };
