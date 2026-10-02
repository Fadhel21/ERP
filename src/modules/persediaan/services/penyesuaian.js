// Penyesuaian stok: saldo awal, masuk, keluar. draft → diposting → batal.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const { catatMutasi } = require('./stok');
const u = require('./umum');

const TABEL = 'penyesuaian_stok';
const LABEL = 'Penyesuaian stok';
const JENIS = { saldo_awal: 'Saldo awal', masuk: 'Penyesuaian masuk', keluar: 'Penyesuaian keluar' };

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'persediaan', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: `g.nama AS gudang_nama,
            (SELECT count(*) FROM penyesuaian_stok_detail x WHERE x.penyesuaian_id = d.id AND x.deleted_at IS NULL) AS jumlah_baris,
            (SELECT sum(nilai) FROM penyesuaian_stok_detail x WHERE x.penyesuaian_id = d.id AND x.deleted_at IS NULL) AS total_nilai`,
    gabung: 'JOIN gudang g ON g.id = d.gudang_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, g.nama AS gudang_nama, a.kode || ' · ' || a.nama AS akun_lawan_label,
            j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor,
            pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN gudang g ON g.id = d.gudang_id
     LEFT JOIN akun a ON a.id = d.akun_lawan_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh
     LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, b.kode, b.nama, s.kode AS satuan FROM penyesuaian_stok_detail x
     JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE x.penyesuaian_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  return { ...dok, baris };
}

/** Simpan draft (baru bila id kosong). */
async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'persediaan', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    jenis: String(masukan.jenis || ''),
    gudang_id: String(masukan.gudang_id || ''),
    akun_lawan_id: String(masukan.akun_lawan_id || '') || null,
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  const baris = u.bacaBaris(masukan, ['barang_id', 'qty', 'harga_satuan']);
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  if (!JENIS[data.jenis]) galat.jenis = 'Pilih jenis penyesuaian.';
  if (!baris.length) galat.baris = 'Isi minimal satu baris barang.';
  u.validasiAngkaBaris(baris, galat, { harga: data.jenis !== 'keluar' });
  if (data.jenis === 'keluar') baris.forEach((b) => { b.harga_satuan = '0'; });

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await u.periksaGudang(klien, data.gudang_id, 'gudang_id', galat);
    await u.periksaBarang(klien, baris, galat);
    if (data.akun_lawan_id) {
      const { rows } = await klien.query(
        'SELECT 1 FROM akun WHERE id = $1 AND NOT akun_header AND aktif AND deleted_at IS NULL', [data.akun_lawan_id]);
      if (!rows.length) galat.akun_lawan_id = 'Akun tidak valid atau akun header.';
    }
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal = $1, jenis = $2, gudang_id = $3, akun_lawan_id = $4, keterangan = $5
         WHERE id = $6 RETURNING *`,
        [data.tanggal, data.jenis, data.gudang_id, data.akun_lawan_id, data.keterangan, id])).rows[0];
      await klien.query('UPDATE penyesuaian_stok_detail SET deleted_at = now() WHERE penyesuaian_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, jenis, gudang_id, akun_lawan_id, keterangan, dibuat_oleh)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.tanggal, data.jenis, data.gudang_id, data.akun_lawan_id, data.keterangan, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query(
        'INSERT INTO penyesuaian_stok_detail (penyesuaian_id, barang_id, qty, harga_satuan) VALUES ($1, $2, $3, $4)',
        [dok.id, b.barang_id, b.qty, b.harga_satuan]);
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

/** Akun persediaan per barang (atau bawaan dari pengaturan). */
async function akunPersediaan(klien, barangIds) {
  const { rows } = await klien.query('SELECT id, akun_persediaan_id FROM barang WHERE id = ANY($1)', [barangIds]);
  const bawaan = rows.some((r) => !r.akun_persediaan_id) ? await akunDariPengaturan(klien, 'akun_persediaan') : null;
  return Object.fromEntries(rows.map((r) => [r.id, r.akun_persediaan_id || bawaan]));
}

async function posting(pengguna, id) {
  pastikanAkses(pengguna, 'persediaan', 'posting');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await pastikanPeriodeTerbuka(klien, dok.tanggal);
    const { rows: baris } = await klien.query(
      'SELECT * FROM penyesuaian_stok_detail WHERE penyesuaian_id = $1 AND deleted_at IS NULL ORDER BY id', [id]);
    if (!baris.length) throw new GalatBisnis('Dokumen tidak memiliki baris barang.');

    const nomor = await nomorBerikutnya(klien, 'ADJ', dok.tanggal);
    const masuk = dok.jenis !== 'keluar';
    const akunP = await akunPersediaan(klien, baris.map((b) => b.barang_id));
    const akunLawan = dok.akun_lawan_id
      || await akunDariPengaturan(klien, dok.jenis === 'saldo_awal' ? 'akun_saldo_awal' : 'akun_selisih_persediaan');

    const jurnalBaris = [];
    for (const b of baris) {
      let nilai;
      if (masuk) {
        nilai = (await klien.query('SELECT round($1::numeric * $2::numeric, 2) AS n', [b.qty, b.harga_satuan])).rows[0].n;
      }
      const hasil = await catatMutasi(klien, {
        tanggal: dok.tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: masuk ? 'masuk' : 'keluar',
        qty: b.qty, nilai, sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor,
        keterangan: JENIS[dok.jenis], penggunaId: pengguna.id,
      });
      await klien.query('UPDATE penyesuaian_stok_detail SET nilai = $1 WHERE id = $2', [hasil.nilai, b.id]);
      jurnalBaris.push(
        { akun_id: akunP[b.barang_id], debit: masuk ? hasil.nilai : '0', kredit: masuk ? '0' : hasil.nilai },
        { akun_id: akunLawan, debit: masuk ? '0' : hasil.nilai, kredit: masuk ? hasil.nilai : '0' });
    }
    const jurnal = await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `${JENIS[dok.jenis]} ${nomor}${dok.keterangan ? ' — ' + dok.keterangan : ''}`,
      sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, baris: jurnalBaris, penggunaId: pengguna.id,
    });
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
      'SELECT * FROM penyesuaian_stok_detail WHERE penyesuaian_id = $1 AND deleted_at IS NULL ORDER BY id DESC', [id]);
    const masukAsal = dok.jenis !== 'keluar';
    const akunP = await akunPersediaan(klien, baris.map((b) => b.barang_id));
    let akunLawan = null;
    if (dok.jurnal_id) {
      // Akun lawan diambil dari jurnal asal agar pembalikan persis
      const { rows } = await klien.query(
        `SELECT akun_id FROM jurnal_detail WHERE jurnal_id = $1 AND ${masukAsal ? 'kredit' : 'debit'} > 0 LIMIT 1`, [dok.jurnal_id]);
      akunLawan = rows[0] && rows[0].akun_id;
    }

    const jurnalBaris = [];
    for (const b of baris) {
      const hasil = await catatMutasi(klien, {
        tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: masukAsal ? 'keluar' : 'masuk',
        qty: b.qty, nilai: b.nilai, sumberJenis: TABEL, sumberId: dok.id, nomorSumber: dok.nomor,
        keterangan: `Batal ${dok.nomor}`, penggunaId: pengguna.id,
      });
      if (akunLawan) {
        jurnalBaris.push(
          { akun_id: akunP[b.barang_id], debit: masukAsal ? '0' : hasil.nilai, kredit: masukAsal ? hasil.nilai : '0' },
          { akun_id: akunLawan, debit: masukAsal ? hasil.nilai : '0', kredit: masukAsal ? '0' : hasil.nilai });
      }
    }
    const jurnal = akunLawan ? await buatJurnal(klien, {
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

module.exports = { JENIS, daftar, ambil, simpanDraft, hapusDraft, posting, batal };
