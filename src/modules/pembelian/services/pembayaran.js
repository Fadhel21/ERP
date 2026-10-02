// Pembayaran hutang: alokasi ke satu/lebih faktur. D Hutang / K Kas-Bank atau K Uang Muka Pembelian.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { keSen, dariSen } = require('../../../lib/uang');
const { formatDesimal } = require('../../../lib/angka');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, balikJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const u = require('../../persediaan/services/umum');
const p = require('./umum');

const TABEL = 'pembayaran_hutang';
const LABEL = 'Pembayaran hutang';
const METODE = { kas: 'Kas / Bank', uang_muka: 'Potong uang muka' };

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  return u.daftarDokumen({ tabel: TABEL, filter, pilih: 'ps.nama AS pemasok_nama', gabung: 'JOIN pemasok ps ON ps.id = d.pemasok_id' });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, ps.nama AS pemasok_nama, a.kode || ' · ' || a.nama AS akun_kas_label, um.nomor AS uang_muka_nomor,
            j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor, pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id LEFT JOIN akun a ON a.id = d.akun_kas_id
     LEFT JOIN uang_muka_pembelian um ON um.id = d.uang_muka_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, f.nomor AS faktur_nomor, f.no_faktur_pemasok, f.jatuh_tempo, f.total AS faktur_total
     FROM pembayaran_hutang_detail x JOIN faktur_pembelian f ON f.id = x.faktur_id
     WHERE x.pembayaran_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  return { ...dok, baris };
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'pembelian', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    pemasok_id: String(masukan.pemasok_id || ''),
    metode: METODE[masukan.metode] ? masukan.metode : '',
    akun_kas_id: String(masukan.akun_kas_id || '') || null,
    uang_muka_id: String(masukan.uang_muka_id || '') || null,
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  if (!data.metode) galat.metode = 'Pilih metode pembayaran.';
  const baris = u.bacaBaris(masukan, ['faktur_id', 'jumlah']).filter((b) => b.jumlah !== '' && !/^0+([.,]0+)?$/.test(b.jumlah));
  if (!baris.length) galat.baris = 'Isi jumlah bayar minimal untuk satu faktur.';
  baris.forEach((b, i) => {
    const j = p.parseUang(b.jumlah, { bolehNol: false });
    if (j === null) galat[`baris.${i}.jumlah`] = 'Jumlah tidak valid.'; else b.jumlah = j;
  });

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await p.periksaPemasok(klien, data.pemasok_id, galat);
    if (data.metode === 'kas') { data.uang_muka_id = null; await p.periksaAkunKas(klien, data.akun_kas_id, galat); }
    let um = null;
    if (data.metode === 'uang_muka') {
      data.akun_kas_id = null;
      um = /^\d{1,18}$/.test(data.uang_muka_id || '') &&
        (await klien.query(`SELECT *, jumlah - dipakai AS sisa FROM uang_muka_pembelian WHERE id = $1 AND deleted_at IS NULL`, [data.uang_muka_id])).rows[0];
      if (!um || um.status !== 'diposting' || um.pemasok_id !== data.pemasok_id) galat.uang_muka_id = 'Pilih uang muka yang valid untuk pemasok ini.';
    }
    const { rows: fk } = await klien.query(
      `SELECT id, nomor, tanggal, pemasok_id, status, total - dibayar - diretur AS sisa FROM faktur_pembelian WHERE id = ANY($1)`,
      [baris.map((b) => b.faktur_id).filter((x) => /^\d{1,18}$/.test(x))]);
    const terlihat = new Set();
    let total = 0n;
    baris.forEach((b, i) => {
      const f = fk.find((x) => x.id === b.faktur_id);
      if (!f || f.status !== 'diposting' || f.pemasok_id !== data.pemasok_id) galat[`baris.${i}.jumlah`] = 'Faktur tidak valid untuk pemasok ini.';
      else if (terlihat.has(f.id)) galat[`baris.${i}.jumlah`] = 'Faktur ganda.';
      else if (!galat[`baris.${i}.jumlah`] && keSen(b.jumlah) > keSen(f.sisa)) galat[`baris.${i}.jumlah`] = `Melebihi sisa hutang ${formatDesimal(f.sisa)}.`;
      else if (!galat.tanggal && data.tanggal < f.tanggal) galat.tanggal = `Tanggal bayar tidak boleh sebelum tanggal faktur ${f.nomor}.`;
      terlihat.add(b.faktur_id);
      if (!galat[`baris.${i}.jumlah`]) total += keSen(b.jumlah);
    });
    if (um && !galat.uang_muka_id && total > keSen(um.sisa)) galat.uang_muka_id = `Total bayar melebihi sisa uang muka ${formatDesimal(um.sisa)}.`;
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    const nilai = [data.tanggal, data.pemasok_id, data.metode, data.akun_kas_id, data.uang_muka_id, dariSen(total), data.keterangan];
    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal=$1, pemasok_id=$2, metode=$3, akun_kas_id=$4, uang_muka_id=$5, total=$6, keterangan=$7 WHERE id = $8 RETURNING *`,
        [...nilai, id])).rows[0];
      await klien.query('UPDATE pembayaran_hutang_detail SET deleted_at = now() WHERE pembayaran_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, pemasok_id, metode, akun_kas_id, uang_muka_id, total, keterangan, dibuat_oleh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [...nilai, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query('INSERT INTO pembayaran_hutang_detail (pembayaran_id, faktur_id, jumlah) VALUES ($1,$2,$3)', [dok.id, b.faktur_id, b.jumlah]);
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
    const { rows: baris } = await klien.query(
      `SELECT x.*, f.nomor, f.status, f.total - f.dibayar - f.diretur AS sisa FROM pembayaran_hutang_detail x
       JOIN faktur_pembelian f ON f.id = x.faktur_id WHERE x.pembayaran_id = $1 AND x.deleted_at IS NULL ORDER BY f.id FOR UPDATE OF f`, [id]);
    if (!baris.length) throw new GalatBisnis('Pembayaran tidak memiliki baris.');
    for (const b of baris) {
      if (b.status !== 'diposting') throw new GalatBisnis(`Faktur ${b.nomor || ''} sudah dibatalkan. Ubah draft pembayaran.`, 409);
      if (keSen(b.jumlah) > keSen(b.sisa)) throw new GalatBisnis(`Pembayaran ${b.nomor} melebihi sisa hutang ${formatDesimal(b.sisa)}. Ubah draft pembayaran.`, 409);
      await klien.query('UPDATE faktur_pembelian SET dibayar = dibayar + $1 WHERE id = $2', [b.jumlah, b.faktur_id]);
    }
    let akunKredit = dok.akun_kas_id;
    if (dok.metode === 'uang_muka') {
      const { rows: [um] } = await klien.query(`SELECT *, jumlah - dipakai AS sisa FROM uang_muka_pembelian WHERE id = $1 FOR UPDATE`, [dok.uang_muka_id]);
      if (um.status !== 'diposting') throw new GalatBisnis(`Uang muka ${um.nomor || ''} sudah dibatalkan.`, 409);
      if (keSen(dok.total) > keSen(um.sisa)) throw new GalatBisnis(`Sisa uang muka ${um.nomor} tinggal ${formatDesimal(um.sisa)}.`, 409);
      await klien.query('UPDATE uang_muka_pembelian SET dipakai = dipakai + $1 WHERE id = $2', [dok.total, um.id]);
      akunKredit = await akunDariPengaturan(klien, 'akun_uang_muka_beli');
    }
    const nomor = await nomorBerikutnya(klien, 'PH', dok.tanggal);
    const jurnal = await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `Pembayaran hutang ${nomor} (${baris.map((b) => b.nomor).join(', ')})`,
      sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, penggunaId: pengguna.id,
      baris: [{ akun_id: await p.akunHutang(klien, dok.pemasok_id), debit: dok.total }, { akun_id: akunKredit, kredit: dok.total }],
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
    const { rows: baris } = await klien.query(
      `SELECT x.* FROM pembayaran_hutang_detail x JOIN faktur_pembelian f ON f.id = x.faktur_id
       WHERE x.pembayaran_id = $1 AND x.deleted_at IS NULL ORDER BY f.id FOR UPDATE OF f`, [id]);
    for (const b of baris) await klien.query('UPDATE faktur_pembelian SET dibayar = dibayar - $1 WHERE id = $2', [b.jumlah, b.faktur_id]);
    if (dok.metode === 'uang_muka') {
      await klien.query('SELECT 1 FROM uang_muka_pembelian WHERE id = $1 FOR UPDATE', [dok.uang_muka_id]);
      await klien.query('UPDATE uang_muka_pembelian SET dipakai = dipakai - $1 WHERE id = $2', [dok.total, dok.uang_muka_id]);
    }
    const jurnal = await balikJurnal(klien, dok.jurnal_id, { tanggal: u.hariIni(), keterangan: `Pembatalan ${dok.nomor}: ${alasan}`, penggunaId: pengguna.id });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', jurnal_batal_id = $1, dibatalkan_oleh = $2, dibatalkan_pada = now(), alasan_batal = $3 WHERE id = $4 RETURNING *`,
      [jurnal.id, pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

module.exports = { METODE, daftar, ambil, simpanDraft, hapusDraft, posting, batal };
