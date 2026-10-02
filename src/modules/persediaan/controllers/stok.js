// Kartu stok & ringkasan stok, serta stok opname.
const dayjs = require('dayjs');
const stok = require('../services/stok');
const opname = require('../services/opname');
const opsi = require('../services/opsi');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatValidasi, STATUS, hariIni, validTanggal } = require('../services/umum');

async function kartuStok(req, res, next) {
  try {
    pastikanAkses(req.pengguna, 'persediaan', 'lihat');
    const q = req.query;
    const gudangId = /^\d+$/.test(q.gudang || '') ? q.gudang : null;
    const [gudang, barang] = await Promise.all([opsi.gudang(), opsi.barangStok()]);
    const data = { judul: 'Kartu Stok', gudang, barang, gudangId, q: String(q.q || '').slice(0, 100), kurang: q.kurang === '1' };

    if (/^\d+$/.test(q.barang || '')) {
      const dari = validTanggal(q.dari) ? q.dari : dayjs().startOf('month').format('YYYY-MM-DD');
      const sampai = validTanggal(q.sampai) ? q.sampai : hariIni();
      const kartu = await stok.kartuStok({ barangId: q.barang, gudangId, dari, sampai });
      const item = barang.find((b) => b.id === q.barang);
      return res.render('persediaan/kartu-stok', { ...data, mode: 'kartu', barangId: q.barang, item, dari, sampai, kartu });
    }
    const ringkasan = await stok.ringkasan({ gudangId, q: data.q, hanyaKurang: data.kurang });
    const view = req.get('HX-Request') && req.get('HX-Target') === 'tabel-stok' ? 'persediaan/_tabel-stok' : 'persediaan/kartu-stok';
    res.render(view, { ...data, mode: 'ringkasan', ringkasan });
  } catch (err) { next(err); }
}

// ---------- Stok opname ----------

async function opnameDaftar(req, res, next) {
  try {
    const filter = { q: String(req.query.q || '').slice(0, 100), status: req.query.status || '', dari: req.query.dari || '', sampai: req.query.sampai || '', hal: req.query.hal };
    const hasil = await opname.daftar(req.pengguna, filter);
    const k = {
      kode: 'opname', judul: 'Stok Opname', tunggal: 'stok opname', dasar: '/persediaan/opname',
      nav: '../persediaan/_navigasi', modul: 'persediaan', labelBaru: 'Mulai opname',
      kolomDaftar: [
        { judul: 'Gudang', nilai: (d) => d.gudang_nama },
        { judul: 'Dihitung', nilai: (d) => `${d.jumlah_dihitung} / ${d.jumlah_baris}`, kanan: true },
      ],
    };
    const data = { judul: k.judul, k, filter, STATUS, ...hasil };
    if (req.get('HX-Request') && req.get('HX-Target') === 'tabel-dokumen') return res.render('dokumen/_tabel', data);
    res.render('dokumen/daftar', data);
  } catch (err) { next(err); }
}

async function opnameBaru(req, res, next, galat = {}, status = 200) {
  try {
    const [gudang, kategori] = await Promise.all([opsi.gudang(), opsi.kategori()]);
    res.status(status).render('persediaan/opname-baru', {
      judul: 'Mulai stok opname', gudang, kategori, galat, dok: { tanggal: hariIni(), ...(status === 422 ? req.body : {}) },
    });
  } catch (err) { next(err); }
}

async function opnameBuat(req, res, next) {
  try {
    const dok = await opname.buat(req.pengguna, req.body);
    res.flash('sukses', 'Lembar opname dibuat. Isi qty fisik lalu simpan.');
    res.redirect(`/persediaan/opname/${dok.id}`);
  } catch (err) {
    if (err instanceof GalatValidasi) return opnameBaru(req, res, next, err.galat, 422);
    next(err);
  }
}

async function opnameDetail(req, res, next, galat = {}, status = 200) {
  try {
    const dok = await opname.ambil(req.pengguna, req.params.id);
    res.status(status).render('persediaan/opname', { judul: dok.nomor || 'Draft stok opname', dok, STATUS, galat, masukan: status === 422 ? req.body : {} });
  } catch (err) { next(err); }
}

async function opnameSimpan(req, res, next) {
  try {
    await opname.simpanHitungan(req.pengguna, req.params.id, req.body);
    res.flash('sukses', 'Hitungan disimpan.');
    res.redirect(`/persediaan/opname/${req.params.id}`);
  } catch (err) {
    if (err instanceof GalatValidasi) return opnameDetail(req, res, next, err.galat, 422);
    if (err.status && err.status < 500) { res.flash('galat', err.message); return res.redirect(`/persediaan/opname/${req.params.id}`); }
    next(err);
  }
}

function opnameAksi(nama, pesan) {
  return async (req, res, next) => {
    try {
      const dok = await opname[nama](req.pengguna, req.params.id, req.body.alasan);
      res.flash('sukses', pesan(dok));
      res.redirect(nama === 'hapusDraft' ? '/persediaan/opname' : `/persediaan/opname/${req.params.id}`);
    } catch (err) {
      if (err.status && err.status < 500) { res.flash('galat', err.message); return res.redirect(`/persediaan/opname/${req.params.id}`); }
      next(err);
    }
  };
}

module.exports = {
  kartuStok, opnameDaftar, opnameBaru: (req, res, next) => opnameBaru(req, res, next), opnameBuat,
  opnameDetail: (req, res, next) => opnameDetail(req, res, next), opnameSimpan,
  opnamePosting: opnameAksi('posting', (d) => `Stok opname ${d.nomor} berhasil diposting.`),
  opnameBatal: opnameAksi('batal', (d) => `${d.nomor} dibatalkan. Stok & jurnal sudah dibalik.`),
  opnameHapus: opnameAksi('hapusDraft', () => 'Draft stok opname dihapus.'),
};
