// Controller dokumen persediaan (penyesuaian & mutasi antar gudang) — tanpa SQL.
const dayjs = require('dayjs');
const penyesuaian = require('../services/penyesuaian');
const transfer = require('../services/transfer');
const opsi = require('../services/opsi');
const { GalatValidasi, STATUS, hariIni } = require('../services/umum');
const { formatDesimal, formatKuantitas } = require('../../../lib/angka');

// Konfigurasi tiap jenis dokumen: service, judul, kolom daftar, dan kolom baris.
const JENIS = {
  penyesuaian: {
    svc: penyesuaian, judul: 'Penyesuaian Stok', tunggal: 'penyesuaian', dasar: '/persediaan/penyesuaian',
    kolomDaftar: [
      { judul: 'Jenis', nilai: (d) => penyesuaian.JENIS[d.jenis] },
      { judul: 'Gudang', nilai: (d) => d.gudang_nama },
      { judul: 'Baris', nilai: (d) => d.jumlah_baris, kanan: true },
      { judul: 'Total nilai', nilai: (d) => (d.status === 'draft' ? '—' : formatDesimal(d.total_nilai || '0')), kanan: true },
    ],
    pakaiHarga: true,
  },
  mutasi: {
    svc: transfer, judul: 'Mutasi Antar Gudang', tunggal: 'mutasi gudang', dasar: '/persediaan/mutasi',
    kolomDaftar: [
      { judul: 'Dari', nilai: (d) => d.asal_nama },
      { judul: 'Ke', nilai: (d) => d.tujuan_nama },
      { judul: 'Baris', nilai: (d) => d.jumlah_baris, kanan: true },
    ],
    pakaiHarga: false,
  },
};

function konfig(req) {
  return { kode: req.params.jenis, ...JENIS[req.params.jenis] };
}

function filterDari(req) {
  const q = req.query;
  return { q: String(q.q || '').slice(0, 100), status: q.status || '', dari: q.dari || '', sampai: q.sampai || '', hal: q.hal };
}

async function daftar(req, res, next) {
  try {
    const k = konfig(req);
    const filter = filterDari(req);
    const hasil = await k.svc.daftar(req.pengguna, filter);
    const data = { judul: k.judul, k, filter, STATUS, ...hasil };
    if (req.get('HX-Request') && req.get('HX-Target') === 'tabel-dokumen') return res.render('persediaan/_tabel-dokumen', data);
    res.render('persediaan/daftar', data);
  } catch (err) { next(err); }
}

/** Baris form dari data tersimpan atau dari body yang gagal validasi. */
function barisForm(sumber, galat = {}) {
  const arr = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  let baris;
  if (sumber.baris) {
    baris = sumber.baris.map((b) => ({
      barang_id: String(b.barang_id), qty: formatKuantitas(b.qty), harga_satuan: b.harga_satuan ? formatDesimal(b.harga_satuan) : '',
    }));
  } else {
    const ids = arr(sumber.barang_id);
    baris = ids.map((id, i) => ({ barang_id: id, qty: arr(sumber.qty)[i] || '', harga_satuan: arr(sumber.harga_satuan)[i] || '' }))
      .filter((b) => b.barang_id || b.qty || b.harga_satuan);
  }
  if (!baris.length) baris = [{ barang_id: '', qty: '', harga_satuan: '' }];
  return baris.map((b, i) => ({
    ...b, k: i,
    galat: { barang_id: galat[`baris.${i}.barang_id`] || '', qty: galat[`baris.${i}.qty`] || '', harga_satuan: galat[`baris.${i}.harga_satuan`] || '' },
  }));
}

async function tampilForm(req, res, { dok, galat = {}, status = 200 }) {
  const k = konfig(req);
  const [gudang, barang, akun] = await Promise.all([opsi.gudang(), opsi.barangStok(), k.pakaiHarga ? opsi.akunPosting() : []]);
  res.status(status).render(`persediaan/form-${k.kode}`, {
    judul: `${dok.id ? 'Ubah' : 'Buat'} ${k.tunggal}`, k, dok, galat, gudang, barang, akun,
    baris: barisForm(dok, galat), JENIS_PENYESUAIAN: penyesuaian.JENIS,
  });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(req, res, { dok: { tanggal: hariIni(), jenis: req.query.jenis === 'saldo_awal' ? 'saldo_awal' : 'masuk' } });
  } catch (err) { next(err); }
}

async function formUbah(req, res, next) {
  try {
    const k = konfig(req);
    const dok = await k.svc.ambil(req.pengguna, req.params.id);
    if (dok.status !== 'draft') return res.redirect(`${k.dasar}/${dok.id}`);
    await tampilForm(req, res, { dok });
  } catch (err) { next(err); }
}

async function simpan(req, res, next) {
  const k = konfig(req);
  const id = req.params.id || null;
  try {
    const dok = await k.svc.simpanDraft(req.pengguna, req.body, id);
    res.flash('sukses', `Draft ${k.tunggal} tersimpan. Periksa lalu posting bila sudah benar.`);
    res.redirect(`${k.dasar}/${dok.id}`);
  } catch (err) {
    if (err instanceof GalatValidasi) {
      return tampilForm(req, res, { dok: { ...req.body, id, baris: undefined }, galat: err.galat, status: 422 }).catch(next);
    }
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const k = konfig(req);
    const dok = await k.svc.ambil(req.pengguna, req.params.id);
    res.render('persediaan/detail', { judul: dok.nomor || `Draft ${k.tunggal}`, k, dok, STATUS, JENIS_PENYESUAIAN: penyesuaian.JENIS });
  } catch (err) { next(err); }
}

function aksi(nama, pesan) {
  return async (req, res, next) => {
    const k = konfig(req);
    try {
      const dok = await k.svc[nama](req.pengguna, req.params.id, req.body.alasan);
      res.flash('sukses', pesan(dok, k));
      res.redirect(nama === 'hapusDraft' ? k.dasar : `${k.dasar}/${req.params.id}`);
    } catch (err) {
      // Galat bisnis (stok kurang, periode tutup, dll.) ditampilkan di halaman detail
      if (err.status && err.status < 500) {
        res.flash('galat', err.message);
        return res.redirect(nama === 'hapusDraft' && err.status === 404 ? k.dasar : `${k.dasar}/${req.params.id}`);
      }
      next(err);
    }
  };
}

module.exports = {
  JENIS,
  daftar, formBaru, formUbah, simpan, detail,
  posting: aksi('posting', (d, k) => `${k.tunggal[0].toUpperCase() + k.tunggal.slice(1)} ${d.nomor} berhasil diposting.`),
  batal: aksi('batal', (d) => `${d.nomor} dibatalkan. Stok & jurnal sudah dibalik.`),
  hapus: aksi('hapusDraft', () => 'Draft dihapus.'),
  hariIni, dayjs,
};
