// Penerimaan barang dari PO: stok masuk (harga & diskon PO) + jurnal Persediaan / Barang Diterima Belum Difaktur.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { hitungBaris } = require('../../../lib/pajak');
const { keSen, dariSen } = require('../../../lib/uang');
const { catatAudit } = require('../../pengaturan/services/audit');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');
const { buatJurnal, akunDariPengaturan } = require('../../akuntansi/services/jurnal');
const { catatMutasi } = require('../../persediaan/services/stok');
const u = require('../../persediaan/services/umum');
const p = require('./umum');
const pesanan = require('./pesanan');

const TABEL = 'penerimaan_barang';
const LABEL = 'Penerimaan barang';

function daftar(pengguna, filter) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  return u.daftarDokumen({
    tabel: TABEL, filter,
    pilih: 'ps.nama AS pemasok_nama, po.nomor AS po_nomor, g.nama AS gudang_nama',
    gabung: 'JOIN pemasok ps ON ps.id = d.pemasok_id JOIN pesanan_pembelian po ON po.id = d.po_id JOIN gudang g ON g.id = d.gudang_id',
  });
}

async function ambil(pengguna, id) {
  pastikanAkses(pengguna, 'pembelian', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: [dok] } = await db.query(
    `SELECT d.*, ps.nama AS pemasok_nama, po.nomor AS po_nomor, g.nama AS gudang_nama, j.nomor AS jurnal_nomor, jb.nomor AS jurnal_batal_nomor,
            pb.nama AS dibuat_nama, pp.nama AS diposting_nama, pc.nama AS dibatalkan_nama
     FROM ${TABEL} d JOIN pemasok ps ON ps.id = d.pemasok_id JOIN pesanan_pembelian po ON po.id = d.po_id JOIN gudang g ON g.id = d.gudang_id
     LEFT JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN jurnal jb ON jb.id = d.jurnal_batal_id
     LEFT JOIN pengguna pb ON pb.id = d.dibuat_oleh LEFT JOIN pengguna pp ON pp.id = d.diposting_oleh LEFT JOIN pengguna pc ON pc.id = d.dibatalkan_oleh
     WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
  if (!dok) throw new GalatBisnis(`${LABEL} tidak ditemukan.`, 404);
  const { rows: baris } = await db.query(
    `SELECT x.*, b.kode, b.nama, s.kode AS satuan, pd.qty AS qty_po, pd.qty - pd.qty_diterima AS qty_sisa_po, pd.harga, pd.diskon_persen,
            fp.nomor AS faktur_nomor
     FROM penerimaan_barang_detail x JOIN barang b ON b.id = x.barang_id JOIN satuan s ON s.id = b.satuan_id
     JOIN pesanan_pembelian_detail pd ON pd.id = x.po_detail_id
     LEFT JOIN faktur_pembelian_detail fd ON fd.id = x.faktur_detail_id LEFT JOIN faktur_pembelian fp ON fp.id = fd.faktur_id
     WHERE x.penerimaan_id = $1 AND x.deleted_at IS NULL ORDER BY x.id`, [id]);
  return { ...dok, baris };
}

/** Baris PO yang masih bisa diterima (untuk form). */
async function sisaPo(poId) {
  const { rows } = await db.query(
    `SELECT pd.id AS po_detail_id, pd.barang_id, b.kode, b.nama, s.kode AS satuan, pd.qty, pd.qty_diterima, pd.qty - pd.qty_diterima AS qty_sisa,
            pd.harga, pd.diskon_persen
     FROM pesanan_pembelian_detail pd JOIN pesanan_pembelian po ON po.id = pd.po_id
     JOIN barang b ON b.id = pd.barang_id JOIN satuan s ON s.id = b.satuan_id
     WHERE pd.po_id = $1 AND pd.deleted_at IS NULL AND po.status = 'diposting' ORDER BY pd.id`, [poId]);
  return rows;
}

async function simpanDraft(pengguna, masukan, id = null) {
  pastikanAkses(pengguna, 'pembelian', id ? 'ubah' : 'tambah');
  const galat = {};
  const data = {
    tanggal: String(masukan.tanggal || ''),
    po_id: String(masukan.po_id || ''),
    gudang_id: String(masukan.gudang_id || ''),
    no_surat_jalan: String(masukan.no_surat_jalan || '').trim().slice(0, 50) || null,
    keterangan: String(masukan.keterangan || '').trim().slice(0, 500) || null,
  };
  if (!u.validTanggal(data.tanggal)) galat.tanggal = 'Tanggal tidak valid.';
  // Baris: qty per po_detail_id (qty kosong/0 = tidak diterima)
  const baris = u.bacaBaris(masukan, ['po_detail_id', 'qty']).filter((b) => b.qty !== '' && !/^0+([.,]0+)?$/.test(b.qty));

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) lama = await u.kunciDokumen(klien, TABEL, id, 'draft', LABEL);
    let po = null;
    if (!/^\d{1,18}$/.test(data.po_id)) galat.po_id = 'Pilih PO.';
    else {
      po = (await klien.query(`SELECT * FROM pesanan_pembelian WHERE id = $1 AND deleted_at IS NULL`, [data.po_id])).rows[0];
      if (!po || po.status !== 'diposting') galat.po_id = 'PO tidak ditemukan atau belum diposting.';
    }
    await u.periksaGudang(klien, data.gudang_id, 'gudang_id', galat);
    if (!baris.length) galat.baris = 'Isi qty diterima minimal untuk satu barang.';
    baris.forEach((b, i) => { b.barang_id = '0'; });
    u.validasiAngkaBaris(baris, galat);
    if (po) {
      const { rows: det } = await klien.query(
        'SELECT id, barang_id, qty - qty_diterima AS sisa FROM pesanan_pembelian_detail WHERE po_id = $1 AND deleted_at IS NULL', [po.id]);
      for (const [i, b] of baris.entries()) {
        delete galat[`baris.${i}.barang_id`];
        const d = det.find((x) => x.id === b.po_detail_id);
        if (!d) { galat[`baris.${i}.qty`] = 'Baris PO tidak valid.'; continue; }
        b.barang_id = d.barang_id;
        if (!galat[`baris.${i}.qty`]) {
          const { rows: [c] } = await klien.query('SELECT $1::numeric > $2::numeric AS lebih', [b.qty, d.sisa]);
          if (c.lebih) galat[`baris.${i}.qty`] = 'Melebihi sisa PO.';
        }
      }
    }
    if (Object.keys(galat).length) throw new u.GalatValidasi(galat);

    const nilai = [data.tanggal, po.pemasok_id, po.id, data.gudang_id, data.no_surat_jalan, data.keterangan];
    let dok;
    if (id) {
      dok = (await klien.query(
        `UPDATE ${TABEL} SET tanggal=$1, pemasok_id=$2, po_id=$3, gudang_id=$4, no_surat_jalan=$5, keterangan=$6 WHERE id = $7 RETURNING *`,
        [...nilai, id])).rows[0];
      await klien.query('UPDATE penerimaan_barang_detail SET deleted_at = now() WHERE penerimaan_id = $1 AND deleted_at IS NULL', [id]);
    } else {
      dok = (await klien.query(
        `INSERT INTO ${TABEL} (tanggal, pemasok_id, po_id, gudang_id, no_surat_jalan, keterangan, dibuat_oleh)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [...nilai, pengguna.id])).rows[0];
    }
    for (const b of baris) {
      await klien.query('INSERT INTO penerimaan_barang_detail (penerimaan_id, po_detail_id, barang_id, qty) VALUES ($1,$2,$3,$4)',
        [dok.id, b.po_detail_id, b.barang_id, b.qty]);
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
    const { rows: [po] } = await klien.query('SELECT * FROM pesanan_pembelian WHERE id = $1 FOR UPDATE', [dok.po_id]);
    if (po.status !== 'diposting') throw new GalatBisnis(`PO ${po.nomor || ''} sudah dibatalkan.`, 409);
    const { rows: baris } = await klien.query(
      `SELECT x.*, pd.harga, pd.diskon_persen, pd.qty - pd.qty_diterima AS sisa, x.qty > pd.qty - pd.qty_diterima AS lebih
       FROM penerimaan_barang_detail x JOIN pesanan_pembelian_detail pd ON pd.id = x.po_detail_id
       WHERE x.penerimaan_id = $1 AND x.deleted_at IS NULL ORDER BY x.id FOR UPDATE OF pd`, [id]);
    if (!baris.length) throw new GalatBisnis('Dokumen tidak memiliki baris barang.');
    const { desimal } = await p.pengaturanPajak(klien);
    const nomor = await nomorBerikutnya(klien, 'TB', dok.tanggal);
    const akunGrni = await akunDariPengaturan(klien, 'akun_grni');
    const jurnalBaris = [];
    let total = 0n;
    for (const b of baris) {
      if (b.lebih) throw new GalatBisnis(`Qty diterima melebihi sisa PO (sisa ${b.sisa}). Ubah draft penerimaan.`, 409);
      const { dpp: nilai } = hitungBaris({ qty: b.qty, harga: b.harga, diskonPersen: b.diskon_persen, kenaPpn: false, desimal });
      await catatMutasi(klien, {
        tanggal: dok.tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: 'masuk', qty: b.qty, nilai,
        sumberJenis: TABEL, sumberId: dok.id, nomorSumber: nomor, keterangan: `Penerimaan ${po.nomor}`, penggunaId: pengguna.id,
      });
      await klien.query('UPDATE penerimaan_barang_detail SET nilai = $1 WHERE id = $2', [nilai, b.id]);
      await klien.query('UPDATE pesanan_pembelian_detail SET qty_diterima = qty_diterima + $1 WHERE id = $2', [b.qty, b.po_detail_id]);
      jurnalBaris.push({ akun_id: await akunPersediaanBarang(klien, b.barang_id), debit: nilai }, { akun_id: akunGrni, kredit: nilai });
      total += keSen(nilai);
    }
    await pesanan.perbaruiStatusTerima(klien, po.id);
    const jurnal = await buatJurnal(klien, {
      tanggal: dok.tanggal, keterangan: `Penerimaan barang ${nomor} (${po.nomor})`, sumberJenis: TABEL, sumberId: dok.id,
      nomorSumber: nomor, baris: jurnalBaris, penggunaId: pengguna.id,
    });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'diposting', nomor = $1, total_nilai = $2, jurnal_id = $3, diposting_oleh = $4, diposting_pada = now()
       WHERE id = $5 RETURNING *`, [nomor, dariSen(total), jurnal ? jurnal.id : null, pengguna.id, id]);
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
      'SELECT * FROM penerimaan_barang_detail WHERE penerimaan_id = $1 AND deleted_at IS NULL ORDER BY id DESC FOR UPDATE', [id]);
    if (baris.some((b) => b.faktur_detail_id)) throw new GalatBisnis('Penerimaan sudah difakturkan. Batalkan fakturnya terlebih dahulu.', 409);
    const tanggal = u.hariIni();
    await pastikanPeriodeTerbuka(klien, tanggal);
    const akunGrni = await akunDariPengaturan(klien, 'akun_grni');
    const akunSelisih = await akunDariPengaturan(klien, 'akun_selisih_persediaan');
    const jurnalBaris = [];
    for (const b of baris) {
      const hasil = await catatMutasi(klien, {
        tanggal, barangId: b.barang_id, gudangId: dok.gudang_id, arah: 'keluar', qty: b.qty, nilai: b.nilai,
        sumberJenis: TABEL, sumberId: dok.id, nomorSumber: dok.nomor, keterangan: `Batal ${dok.nomor}`, penggunaId: pengguna.id,
      });
      await klien.query('UPDATE pesanan_pembelian_detail SET qty_diterima = qty_diterima - $1 WHERE id = $2', [b.qty, b.po_detail_id]);
      // GRNI dibalik sebesar nilai asal; selisih (bila stok habis & nilai berbeda) ke akun selisih persediaan
      const selisih = keSen(b.nilai) - keSen(hasil.nilai);
      jurnalBaris.push({ akun_id: akunGrni, debit: b.nilai }, { akun_id: await akunPersediaanBarang(klien, b.barang_id), kredit: hasil.nilai });
      if (selisih !== 0n) jurnalBaris.push({ akun_id: akunSelisih, kredit: selisih > 0n ? dariSen(selisih) : '0', debit: selisih < 0n ? dariSen(-selisih) : '0' });
    }
    await pesanan.perbaruiStatusTerima(klien, dok.po_id);
    const jurnal = await buatJurnal(klien, {
      tanggal, keterangan: `Pembatalan ${dok.nomor}: ${alasan}`, sumberJenis: TABEL, sumberId: dok.id, nomorSumber: dok.nomor,
      baris: jurnalBaris, penggunaId: pengguna.id, membalikId: dok.jurnal_id,
    });
    const { rows: [baru] } = await klien.query(
      `UPDATE ${TABEL} SET status = 'batal', jurnal_batal_id = $1, dibatalkan_oleh = $2, dibatalkan_pada = now(), alasan_batal = $3
       WHERE id = $4 RETURNING *`, [jurnal ? jurnal.id : null, pengguna.id, alasan.slice(0, 500), id]);
    await catatAudit(klien, { penggunaId: pengguna.id, tabel: TABEL, rekamanId: id, aksi: 'batal', sebelum: dok, sesudah: baru });
    return baru;
  });
}

module.exports = { daftar, ambil, sisaPo, simpanDraft, hapusDraft, posting, batal };
