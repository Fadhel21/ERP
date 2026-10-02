// Controller generik master data — tidak ada SQL di sini; semua lewat service.
const { ambilDefinisi, URUTAN, DEFINISI } = require('../definisi');
const service = require('../services/master');
const { GalatBisnis } = require('../../../lib/galat');
const { buatCsv } = require('../../../lib/csv');
const { formatDesimal, formatKuantitas } = require('../../../lib/angka');

function definisi(req) {
  const def = ambilDefinisi(req.params.entitas);
  if (!def) throw new GalatBisnis('Halaman tidak ditemukan.', 404);
  return def;
}

function navigasi() {
  return URUTAN.map((k) => ({ kode: k, judul: DEFINISI[k].judul }));
}

function filter(req) {
  return { q: String(req.query.q || '').slice(0, 100), hal: req.query.hal, semua: req.query.semua === '1' };
}

async function daftar(req, res, next) {
  try {
    const def = definisi(req);
    const f = filter(req);
    const hasil = await service.daftar(req.pengguna, def, f);
    const data = { judul: def.judul, def, entitas: req.params.entitas, ...hasil, filter: f, navigasi: navigasi() };
    // Permintaan HTMX dari kotak cari / paging hanya butuh tabelnya
    if (req.get('HX-Request') && req.get('HX-Target') === 'tabel-master') return res.render('master/_tabel', data);
    res.render('master/daftar', data);
  } catch (err) { next(err); }
}

async function tampilForm(req, res, { rekaman, galat = {}, status = 200 }) {
  const def = definisi(req);
  const opsi = await service.opsiRelasi(def, rekaman);
  res.status(status).render('master/form', {
    judul: `${rekaman.id ? 'Ubah' : 'Tambah'} ${def.judulTunggal}`,
    def, entitas: req.params.entitas, rekaman, galat, opsi, navigasi: navigasi(),
  });
}

async function formTambah(req, res, next) {
  try {
    const def = definisi(req);
    await tampilForm(req, res, { rekaman: await service.nilaiAwal(def) });
  } catch (err) { next(err); }
}

async function formUbah(req, res, next) {
  try {
    const def = definisi(req);
    await tampilForm(req, res, { rekaman: await service.ambil(req.pengguna, def, req.params.id) });
  } catch (err) { next(err); }
}

async function simpan(req, res, next) {
  const def = ambilDefinisi(req.params.entitas);
  const id = req.params.id || null;
  try {
    if (!def) throw new GalatBisnis('Halaman tidak ditemukan.', 404);
    const baru = await service.simpan(req.pengguna, def, req.body, id);
    res.flash('sukses', `${def.judulTunggal[0].toUpperCase() + def.judulTunggal.slice(1)} ${baru.kode} berhasil disimpan.`);
    res.redirect(`/master/${req.params.entitas}`);
  } catch (err) {
    if (err instanceof service.GalatValidasi) {
      // Tampilkan ulang form dengan isian pengguna & pesan per field
      return tampilForm(req, res, { rekaman: { ...req.body, id }, galat: err.galat, status: 422 }).catch(next);
    }
    next(err);
  }
}

async function hapus(req, res, next) {
  try {
    const def = definisi(req);
    const lama = await service.hapus(req.pengguna, def, req.params.id);
    const f = filter(req);
    const hasil = await service.daftar(req.pengguna, def, f);
    res.render('master/_tabel', {
      def, entitas: req.params.entitas, ...hasil, filter: f,
      notifikasi: { jenis: 'sukses', pesan: `${lama.kode} berhasil dihapus.` },
    });
  } catch (err) { next(err); }
}

/** Nilai sel untuk tampilan & CSV. */
function nilaiSel(f, baris, untukCsv = false) {
  const v = baris[f.nama];
  switch (f.tipe) {
    case 'uang': return formatDesimal(v, 2);
    case 'kuantitas': return formatKuantitas(v);
    case 'boolean': return v ? 'Ya' : 'Tidak';
    case 'pilihan': return (f.opsi.find(([k]) => k === v) || [, v ?? ''])[1];
    case 'relasi': return baris[`${f.nama}__label`] || '';
    default: return v ?? (untukCsv ? '' : '');
  }
}

async function ekspor(req, res, next) {
  try {
    const def = definisi(req);
    const baris = await service.semuaUntukEkspor(req.pengguna, def, filter(req));
    const kolom = def.field.map((f) => ({ judul: f.label, ambil: (b) => nilaiSel(f, b, true) }));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.params.entitas}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(buatCsv(kolom, baris));
  } catch (err) { next(err); }
}

module.exports = { daftar, formTambah, formUbah, simpan, hapus, ekspor, nilaiSel };
