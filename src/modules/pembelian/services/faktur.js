// Faktur pembelian dari baris penerimaan (1 baris faktur = 1 baris penerimaan utuh).
// Jurnal: D Barang Diterima Belum Difaktur (nilai terima) ± Selisih Persediaan, D PPN Masukan / K Hutang.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { hitungBaris, jumlahkanBaris } = require('../../../lib/pajak');
const { keSen, dariSen } = require('../../../lib/uang');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, balikJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const u = require('../../persediaan/services/umum');
const p = require('./umum');

const TABEL = 'faktur_pembelian';
const LABEL = 'Faktur pembelian';

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: 'ps.nama AS pemasok_nama, d.total - d.dibayar - d.diretur AS sisa', gabung: 'JOIN pemasok ps ON ps.id = d.pemasok_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, d.total - d.dibayar - d.diretur AS sisa, ps.nama AS pemasok_nama, j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor,
            pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, b.kode, b.nama, s.kode AS satuan, pb.nomor AS penerimaan_nomor
     FROM faktur_pembelian_detail x JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     JOIN penerimaan_barang_detail pd ON pd.id = x.penerimaan_detail_id JOIN penerimaan_barang pb ON pb.id = pd.penerimaan_id
     WHERE x.faktur_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  const { rows: bayar } = await db.query(
    `SELECT ph.id, ph.nomor, ph.tanggal, ph.metode, d.jumlah FROM pembayaran_hutang_detail d JOIN pembayaran_hutang ph ON ph.id = d.pembayaran_id
     WHERE d.faktur_id = $1 AND d.deleted_at IS NULL AND ph.status = 'diposting' ORDER BY ph.tanggal`, [id]);
  const { rows: retur } = await db.query(
    `SELECT id, nomor, tanggal, total FROM retur_pembelian WHERE faktur_id = $1 AND status = 'diposting' AND deleted_at IS NULL ORDER BY tanggal`, [id]);
  return { ...dok, baris, bayar, retur };
}

/** Baris penerimaan yang belum difakturkan untuk satu pemasok (harga & diskon bawaan dari PO). */
async function belumDifaktur(pemasokId) {
  if (!/^\d{1,18}$/.test(String(pemasokId || ''))) return [];
  const { rows } = await db.query(
    `SELECT x.id AS penerimaan_detail_id, pb.nomor AS penerimaan_nomor, pb.tanggal, b.kode, b.nama, s.kode AS satuan,
            x.qty, x.nilai, pd.harga, pd.diskon_persen, b.kena_ppn
     FROM penerimaan_barang_detail x JOIN penerimaan_barang pb ON pb.id = x.penerimaan_id
     JOIN pesanan_pembelian_detail pd ON pd.id = x.po_detail_id
     JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE pb.pemasok_id = $1 AND pb.status = 'diposting' AND x.faktur_detail_id IS NULL AND x.deleted_at IS NULL
     ORDER BY pb.tanggal, x.id`, [pemasokId]);
  return rows;
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'pembelian', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    pemasok_id: String(masukan.pemasok_id || ''),
    no_faktur_pemasok: String(masukan.no_faktur_pemasok || '').trim().slice(0, 50) || null,
    no_faktur_pajak: String(masukan.no_faktur_pajak || '').trim().slice(0, 50) || null,
    jatuh_tempo: String(masukan.jatuh_tempo || ''),
    pakai_ppn: masukan.pakai_ppn === 'on' || masukan.pakai_ppn === true,
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  // Hanya baris yang dicentang (pilih) yang difakturkan
  const baris = u.bacaBaris(masukan, ['penerimaan_detail_id', 'harga', 'diskon_persen', 'pilih']).filter((b) => b.pilih === '1');
  if (!baris.length) galat.baris = 'Pilih minimal satu baris penerimaan.';
  baris.forEach((b, i) => {
    const h = p.parseUang(b.harga);
    if (h === null) galat[`baris.${i}.harga`] = 'Harga tidak valid.'; else b.harga = h;
    const d = p.parsePersen(b.diskon_persen);
    if (d === null) galat[`baris.${i}.diskon_persen`] = 'Diskon 0–100%.'; else b.diskon_persen = d;
  });

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    const pemasok = await p.periksaPemasok(klien, data.pemasok_id, galat);
    if (!data.jatuh_tempo && pemasok && !galat.tanggal) data.jatuh_tempo = p.tambahHari(data.tanggal, pemasok.termin_hari);
    if (!u.validTanggal(data.jatuh_tempo)) galat.jatuh_tempo = 'Tanggal jatuh tempo tidak valid.';
    else if (!galat.tanggal && data.jatuh_tempo < data.tanggal) galat.jatuh_tempo = 'Jatuh tempo tidak boleh sebelum tanggal faktur.';

    const ids = baris.map((b) => b.penerimaan_detail_id).filter((x) => /^\d{1,18}$/.test(x));
    const { rows: sumber } = await klien.query(
      `SELECT x.id, x.barang_id, x.qty, x.nilai, x.faktur_detail_id, pb.pemasok_id, pb.status, pb.tanggal, bg.kena_ppn
       FROM penerimaan_barang_detail x JOIN penerimaan_barang pb ON pb.id = x.penerimaan_id JOIN barang bg ON bg.id = x.barang_id
       WHERE x.id = ANY($1) AND x.deleted_at IS NULL`, [ids]);
    const terlihat = new Set();
    baris.forEach((b, i) => {
      const s = sumber.find((x) => x.id === b.penerimaan_detail_id);
      if (!s || s.status !== 'diposting' || s.pemasok_id !== data.pemasok_id) galat[`baris.${i}.harga`] = 'Baris penerimaan tidak valid untuk pemasok ini.';
      else if (s.faktur_detail_id) galat[`baris.${i}.harga`] = 'Baris ini sudah difakturkan.';
      else if (terlihat.has(s.id)) galat[`baris.${i}.harga`] = 'Baris ganda.';
      else if (!galat.tanggal && data.tanggal < s.tanggal) galat.tanggal = 'Tanggal faktur tidak boleh sebelum tanggal penerimaan.';
      terlihat.add(b.penerimaan_detail_id);
      if (s) Object.assign(b, { barang_id: s.barang_id, qty: s.qty, nilai_terima: s.nilai, kena_ppn_barang: s.kena_ppn });
    });
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    const { tarif, desimal } = await p.pengaturanPajak(klien);
    for (const b of baris) {
      b.kena_ppn = data.pakai_ppn && b.kena_ppn_barang;
      Object.assign(b, hitungBaris({ qty: b.qty, harga: b.harga, diskonPersen: b.diskon_persen, kenaPpn: b.kena_ppn, tarifPpn: tarif, desimal }));
    }
    const total = jumlahkanBaris(baris);
    const nilai = [data.tanggal, data.pemasok_id, data.no_faktur_pemasok, data.no_faktur_pajak, data.jatuh_tempo, data.pakai_ppn, tarif,
      total.dpp, total.ppn, total.total, data.keterangan];
    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal=$1, pemasok_id=$2, no_faktur_pemasok=$3, no_faktur_pajak=$4, jatuh_tempo=$5, pakai_ppn=$6, ppn_persen=$7,
         total_dpp=$8, total_ppn=$9, total=$10, keterangan=$11 WHERE id = $12 RETURNING *`, [...nilai, id])).rows[0];
      await klien.query('UPDATE faktur_pembelian_detail SET deleted_at = now() WHERE faktur_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, pemasok_id, no_faktur_pemasok, no_faktur_pajak, jatuh_tempo, pakai_ppn, ppn_persen, total_dpp, total_ppn, total, keterangan, dibuat_oleh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [...nilai, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query(
        `INSERT INTO faktur_pembelian_detail (faktur_id, penerimaan_detail_id, barang_id, qty, harga, diskon_persen, kena_ppn, bruto, diskon, dpp, ppn, total, nilai_terima)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [dok.id, b.penerimaan_detail_id, b.barang_id, b.qty, b.harga, b.diskon_persen, b.kena_ppn, b.bruto, b.diskon, b.dpp, b.ppn, b.total, b.nilai_terima]);
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
      `SELECT x.*, pd.faktur_detail_id AS sudah, pb.status AS status_terima, pb.nomor AS penerimaan_nomor
       FROM faktur_pembelian_detail x JOIN penerimaan_barang_detail pd ON pd.id = x.penerimaan_detail_id
       JOIN penerimaan_barang pb ON pb.id = pd.penerimaan_id
       WHERE x.faktur_id = $1 AND x.deleted_at IS NULL ORDER BY x.id FOR UPDATE OF pd`, [id]);
    if (!baris.length) throw new GalatBisnis('Faktur tidak memiliki baris.');
    for (const b of baris) {
      if (b.status_terima !== 'diposting') throw new GalatBisnis(`Penerimaan ${b.penerimaan_nomor || ''} sudah dibatalkan. Ubah draft faktur.`, 409);
      if (b.sudah) throw new GalatBisnis(`Baris dari ${b.penerimaan_nomor} sudah difakturkan di faktur lain. Ubah draft faktur.`, 409);
      await klien.query('UPDATE penerimaan_barang_detail SET faktur_detail_id = $1 WHERE id = $2', [b.id, b.penerimaan_detail_id]);
    }
    const nomor = await nomorBerikutnya(klien, 'FB', dok.tanggal);
    const grni = baris.reduce((t, b) => t + keSen(b.nilai_terima), 0n);
    const dpp = keSen(dok.total_dpp);
    const selisih = dpp - grni;
    const jurnalBaris = [
      { akun_id: await akunDariPengaturan(klien, 'akun_grni'), debit: dariSen(grni) },
      { akun_id: await akunDariPengaturan(klien, 'akun_ppn_masukan'), debit: dok.total_ppn },
      { akun_id: await p.akunHutang(klien, dok.pemasok_id), kredit: dok.total },
    ];
    if (selisih !== 0n) {
      jurnalBaris.push({ akun_id: await akunDariPengaturan(klien, 'akun_selisih_persediaan'),
        debit: selisih > 0n ? dariSen(selisih) : '0', kredit: selisih < 0n ? dariSen(-selisih) : '0' });
    }
    const jurnal = await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `Faktur pembelian ${nomor}${dok.no_faktur_pemasok ? ' / ' + dok.no_faktur_pemasok : ''}`,
      sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, baris: jurnalBaris, penggunaId: pengguna.id,
    });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, jurnal_id = $2, diposting_oleh = $3, diposting_pada = now() WHERE id = $4 RETURNING *`,
      [nomor, jurnal ? jurnal.id : null, pengguna.id, id]);
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
    if (keSen(dok.dibayar) > 0n) throw new GalatBisnis('Faktur sudah dibayar. Batalkan pembayarannya terlebih dahulu.', 409);
    if (keSen(dok.diretur) > 0n) throw new GalatBisnis('Faktur sudah memiliki retur. Batalkan returnya terlebih dahulu.', 409);
    const tanggal = u.hariIni();
    await klien.query(
      `UPDATE penerimaan_barang_detail SET faktur_detail_id = NULL
       WHERE faktur_detail_id IN (SELECT id FROM faktur_pembelian_detail WHERE faktur_id = $1)`, [id]);
    const jurnal = dok.jurnal_id ? await balikJurnal(klien, dok.jurnal_id, {
      tanggal, keterangan: `Pembatalan ${dok.nomor}: ${alasan}`, penggunaId: pengguna.id }) : null;
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', jurnal_batal_id = $1, dibatalkan_oleh = $2, dibatalkan_pada = now(), alasan_batal = $3
       WHERE id = $4 RETURNING *`, [jurnal ? jurnal.id : null, pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

/** Faktur yang masih punya sisa hutang untuk satu pemasok. */
async function belumLunas(pemasokId) {
  if (!/^\d{1,18}$/.test(String(pemasokId || ''))) return [];
  const { rows } = await db.query(
    `SELECT id, nomor, tanggal, jatuh_tempo, no_faktur_pemasok, total, total - dibayar - diretur AS sisa
     FROM ${TABEL} WHERE pemasok_id = $1 AND status = 'diposting' AND deleted_at IS NULL AND total - dibayar - diretur > 0
     ORDER BY jatuh_tempo, id`, [pemasokId]);
  return rows;
}

module.exports = { daftar, ambil, belumDifaktur, belumLunas, simpanDraft, hapusDraft, posting, batal };
