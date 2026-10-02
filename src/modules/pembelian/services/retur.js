// Retur pembelian dari faktur: stok keluar (HPP rata-rata) + nota debit mengurangi hutang.
// Jurnal: D Hutang / K PPN Masukan / K Persediaan (HPP) ± Selisih Persediaan (DPP − HPP).
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { hitungBaris, jumlahkanBaris } = require('../../../lib/pajak');
const { keSen, dariSen } = require('../../../lib/uang');
const { formatDesimal } = require('../../../lib/angka');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, balikJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const { catatMutasi } = require('../../persediaan/services/stok');
const u = require('../../persediaan/services/umum');
const p = require('./umum');

const TABEL = 'retur_pembelian';
const LABEL = 'Retur pembelian';

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter, pilih: 'ps.nama AS pemasok_nama, f.nomor AS faktur_nomor',
    gabung: 'JOIN pemasok ps ON ps.id = d.pemasok_id JOIN faktur_pembelian f ON f.id = d.faktur_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, ps.nama AS pemasok_nama, f.nomor AS faktur_nomor, g.nama AS gudang_nama, j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor,
            pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id JOIN faktur_pembelian f ON f.id = d.faktur_id JOIN gudang g ON g.id = d.gudang_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, b.kode, b.nama, s.kode AS satuan, fd.harga, fd.diskon_persen
     FROM retur_pembelian_detail x JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     JOIN faktur_pembelian_detail fd ON fd.id = x.faktur_detail_id
     WHERE x.retur_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  return { ...dok, baris };
}

/** Faktur yang bisa diretur & baris yang masih bisa diretur. */
async function fakturBisaRetur() {
  const { rows } = await db.query(
    `SELECT f.id, f.nomor, f.tanggal, ps.nama AS pemasok_nama, f.total - f.dibayar - f.diretur AS sisa
     FROM faktur_pembelian f JOIN pemasok ps ON ps.id = f.pemasok_id
     WHERE f.status = 'diposting' AND f.deleted_at IS NULL AND f.total - f.dibayar - f.diretur > 0 ORDER BY f.tanggal DESC, f.id DESC LIMIT 200`);
  return rows;
}
async function barisFaktur(fakturId) {
  if (!/^\d{1,18}$/.test(String(fakturId || ''))) return [];
  const { rows } = await db.query(
    `SELECT fd.id AS faktur_detail_id, b.kode, b.nama, s.kode AS satuan, fd.qty, fd.qty_diretur, fd.qty - fd.qty_diretur AS qty_sisa, fd.harga, fd.diskon_persen
     FROM faktur_pembelian_detail fd JOIN barang b ON b.id = fd.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE fd.faktur_id = $1 AND fd.deleted_at IS NULL ORDER BY fd.id`, [fakturId]);
  return rows;
}

/**
 * Hitung nilai retur per baris. Bila meretur seluruh sisa qty, nilainya = nilai asal − retur sebelumnya
 * (agar tidak ada sisa sen akibat pembulatan).
 */
async function hitungRetur(klien, fd, qty, faktur, desimal, kecualiReturId = 0) {
  const { rows: [c] } = await klien.query('SELECT $1::numeric = $2::numeric - $3::numeric AS habis', [qty, fd.qty, fd.qty_diretur]);
  if (c.habis) {
    const { rows: [s] } = await klien.query(
      `SELECT coalesce(sum(x.dpp), 0) AS dpp, coalesce(sum(x.ppn), 0) AS ppn FROM retur_pembelian_detail x JOIN retur_pembelian r ON r.id = x.retur_id
       WHERE x.faktur_detail_id = $1 AND r.status = 'diposting' AND x.deleted_at IS NULL AND r.id <> $2`, [fd.id, kecualiReturId]);
    const dpp = dariSen(keSen(fd.dpp) - keSen(s.dpp));
    const ppn = dariSen(keSen(fd.ppn) - keSen(s.ppn));
    return { dpp, ppn, total: dariSen(keSen(dpp) + keSen(ppn)) };
  }
  const h = hitungBaris({ qty, harga: fd.harga, diskonPersen: fd.diskon_persen, kenaPpn: fd.kena_ppn, tarifPpn: faktur.ppn_persen, desimal });
  return { dpp: h.dpp, ppn: h.ppn, total: h.total };
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'pembelian', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    faktur_id: String(masukan.faktur_id || ''),
    gudang_id: String(masukan.gudang_id || ''),
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  const baris = u.bacaBaris(masukan, ['faktur_detail_id', 'qty']).filter((b) => b.qty !== '' && !/^0+([.,]0+)?$/.test(b.qty));
  if (!baris.length) galat.baris = 'Isi qty retur minimal untuk satu barang.';
  baris.forEach((b) => { b.barang_id = '0'; });
  u.validasiAngkaBaris(baris, galat);

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    const faktur = /^\d{1,18}$/.test(data.faktur_id) && (await klien.query(
      'SELECT *, total - dibayar - diretur AS sisa FROM faktur_pembelian WHERE id = $1 AND deleted_at IS NULL', [data.faktur_id])).rows[0];
    if (!faktur || faktur.status !== 'diposting') galat.faktur_id = 'Pilih faktur yang sudah diposting.';
    else if (!galat.tanggal && data.tanggal < faktur.tanggal) galat.tanggal = 'Tanggal retur tidak boleh sebelum tanggal faktur.';
    await u.periksaGudang(klien, data.gudang_id, 'gudang_id', galat);
    const { desimal } = await p.pengaturanPajak(klien);
    if (faktur) {
      const { rows: det } = await klien.query('SELECT * FROM faktur_pembelian_detail WHERE faktur_id = $1 AND deleted_at IS NULL', [faktur.id]);
      for (const [i, b] of baris.entries()) {
        const fd = det.find((x) => x.id === b.faktur_detail_id);
        if (!fd) { galat[`baris.${i}.qty`] = 'Baris faktur tidak valid.'; continue; }
        b.barang_id = fd.barang_id;
        if (galat[`baris.${i}.qty`]) continue;
        const { rows: [c] } = await klien.query('SELECT $1::numeric > $2::numeric - $3::numeric AS lebih', [b.qty, fd.qty, fd.qty_diretur]);
        if (c.lebih) { galat[`baris.${i}.qty`] = 'Melebihi qty faktur yang belum diretur.'; continue; }
        Object.assign(b, await hitungRetur(klien, fd, b.qty, faktur, desimal, id || 0));
      }
    }
    const total = Object.keys(galat).length ? null : jumlahkanBaris(baris.map((b) => ({ bruto: '0', diskon: '0', dpp: b.dpp, ppn: b.ppn, total: b.total })));
    if (total && keSen(total.total) > keSen(faktur.sisa)) galat.baris = `Nilai retur ${formatDesimal(total.total)} melebihi sisa hutang faktur ${formatDesimal(faktur.sisa)}.`;
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    const nilai = [data.tanggal, faktur.pemasok_id, faktur.id, data.gudang_id, total.dpp, total.ppn, total.total, data.keterangan];
    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal=$1, pemasok_id=$2, faktur_id=$3, gudang_id=$4, total_dpp=$5, total_ppn=$6, total=$7, keterangan=$8 WHERE id = $9 RETURNING *`,
        [...nilai, id])).rows[0];
      await klien.query('UPDATE retur_pembelian_detail SET deleted_at = now() WHERE retur_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, pemasok_id, faktur_id, gudang_id, total_dpp, total_ppn, total, keterangan, dibuat_oleh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [...nilai, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query('INSERT INTO retur_pembelian_detail (retur_id, faktur_detail_id, barang_id, qty, dpp, ppn, total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [dok.id, b.faktur_detail_id, b.barang_id, b.qty, b.dpp, b.ppn, b.total]);
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

async function akunPersediaanBarang(klien, barangId) {
  const { rows } = await klien.query('SELECT akun_persediaan_id FROM barang WHERE id = $1', [barangId]);
  return rows[0].akun_persediaan_id || akunDariPengaturan(klien, 'akun_persediaan');
}

async function posting(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'posting');
  return db.transaksi(async (klien) => {
    const dok = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    await pastikanPeriodeTerbuka(klien, dok.tanggal);
    const { rows: [faktur] } = await klien.query('SELECT *, total - dibayar - diretur AS sisa FROM faktur_pembelian WHERE id = $1 FOR UPDATE', [dok.faktur_id]);
    if (faktur.status !== 'diposting') throw new GalatBisnis(`Faktur ${faktur.nomor || ''} sudah dibatalkan.`, 409);
    const { rows: baris } = await klien.query(
      'SELECT * FROM retur_pembelian_detail WHERE retur_id = $1 AND deleted_at IS NULL ORDER BY id', [id]);
    if (!baris.length) throw new GalatBisnis('Retur tidak memiliki baris.');
    const { desimal } = await p.pengaturanPajak(klien);
    const nomor = await nomorBerikutnya(klien, 'RB', dok.tanggal);
    let tDpp = 0n; let tPpn = 0n; const persediaan = [];
    for (const b of baris) {
      const { rows: [fd] } = await klien.query('SELECT * FROM faktur_pembelian_detail WHERE id = $1 FOR UPDATE', [b.faktur_detail_id]);
      const { rows: [c] } = await klien.query('SELECT $1::numeric > $2::numeric - $3::numeric AS lebih', [b.qty, fd.qty, fd.qty_diretur]);
      if (c.lebih) throw new GalatBisnis('Qty retur melebihi sisa faktur. Ubah draft retur.', 409);
      const nilai = await hitungRetur(klien, fd, b.qty, faktur, desimal, id);   // hitung ulang terhadap kondisi terkini
      const hasil = await catatMutasi(klien, {
        tanggal: dok.tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: 'keluar', qty: b.qty,
        sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, keterangan: `Retur ke pemasok (${faktur.nomor})`, penggunaId: pengguna.id,
      });
      await klien.query('UPDATE retur_pembelian_detail SET dpp = $1, ppn = $2, total = $3, nilai_hpp = $4 WHERE id = $5',
        [nilai.dpp, nilai.ppn, nilai.total, hasil.nilai, b.id]);
      await klien.query('UPDATE faktur_pembelian_detail SET qty_diretur = qty_diretur + $1 WHERE id = $2', [b.qty, fd.id]);
      tDpp += keSen(nilai.dpp); tPpn += keSen(nilai.ppn);
      persediaan.push({ akun_id: await akunPersediaanBarang(klien, b.barang_id), kredit: hasil.nilai, sen: keSen(hasil.nilai) });
    }
    const total = tDpp + tPpn;
    if (total > keSen(faktur.sisa)) throw new GalatBisnis(`Nilai retur melebihi sisa hutang faktur ${formatDesimal(faktur.sisa)}.`, 409);
    await klien.query('UPDATE faktur_pembelian SET diretur = diretur + $1 WHERE id = $2', [dariSen(total), faktur.id]);
    const hpp = persediaan.reduce((t, x) => t + x.sen, 0n);
    const selisih = tDpp - hpp;   // positif: harga beli > HPP saat ini → kredit selisih
    const jurnalBaris = [
      { akun_id: await p.akunHutang(klien, dok.pemasok_id), debit: dariSen(total) },
      { akun_id: await akunDariPengaturan(klien, 'akun_ppn_masukan'), kredit: dariSen(tPpn) },
      ...persediaan.map(({ akun_id, kredit }) => ({ akun_id, kredit })),
    ];
    if (selisih !== 0n) {
      jurnalBaris.push({ akun_id: await akunDariPengaturan(klien, 'akun_selisih_persediaan'),
        kredit: selisih > 0n ? dariSen(selisih) : '0', debit: selisih < 0n ? dariSen(-selisih) : '0' });
    }
    const jurnal = await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `Retur pembelian ${nomor} (${faktur.nomor})`, sumberJenis: TABEL, sumberId: dok.id,
      nomorSumber: nomor, baris: jurnalBaris, penggunaId: pengguna.id,
    });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, total_dpp = $2, total_ppn = $3, total = $4, jurnal_id = $5, diposting_oleh = $6, diposting_pada = now()
       WHERE id = $7 RETURNING *`, [nomor, dariSen(tDpp), dariSen(tPpn), dariSen(total), jurnal ? jurnal.id : null, pengguna.id, id]);
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
    const tanggal = u.hariIni();
    await pastikanPeriodeTerbuka(klien, tanggal);
    await klien.query('SELECT 1 FROM faktur_pembelian WHERE id = $1 FOR UPDATE', [dok.faktur_id]);
    const { rows: baris } = await klien.query('SELECT * FROM retur_pembelian_detail WHERE retur_id = $1 AND deleted_at IS NULL ORDER BY id DESC', [id]);
    for (const b of baris) {
      await catatMutasi(klien, {
        tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: 'masuk', qty: b.qty, nilai: b.nilai_hpp,
        sumberJenis: TABEL, sumberId: dok.id, nomorSumber: dok.nomor, keterangan: `Batal ${dok.nomor}`, penggunaId: pengguna.id,
      });
      await klien.query('UPDATE faktur_pembelian_detail SET qty_diretur = qty_diretur - $1 WHERE id = $2', [b.qty, b.faktur_detail_id]);
    }
    await klien.query('UPDATE faktur_pembelian SET diretur = diretur - $1 WHERE id = $2', [dok.total, dok.faktur_id]);
    const jurnal = dok.jurnal_id ? await balikJurnal(klien, dok.jurnal_id, {
      tanggal, keterangan: `Pembatalan ${dok.nomor}: ${alasan}`, penggunaId: pengguna.id }) : null;
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', jurnal_batal_id = $1, dibatalkan_oleh = $2, dibatalkan_pada = now(), alasan_batal = $3 WHERE id = $4 RETURNING *`,
      [jurnal ? jurnal.id : null, pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

module.exports = { daftar, ambil, fakturBisaRetur, barisFaktur, simpanDraft, hapusDraft, posting, batal };
