// Controller dokumen pembelian — konfigurasi per jenis dokumen; tanpa SQL.
const po = require('../services/pesanan');
const tb = require('../services/penerimaan');
const fb = require('../services/faktur');
const um = require('../services/uangmuka');
const ph = require('../services/pembayaran');
const rb = require('../services/retur');
const p = require('../services/umum');
const opsiPersediaan = require('../../persediaan/services/opsi');
const { GalatValidasi, STATUS, hariIni } = require('../../persediaan/services/umum');
const { formatDesimal: uang, formatKuantitas: qty } = require('../../../lib/angka');

const tgl = (s) => (s ? s.split('-').reverse().join('/') : '');
const persen = (v) => (Number(v) ? `${String(v).replace(/\.?0+$/, '').replace('.', ',')}%` : '');
const arr = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
/** Peta nilai body form per id baris (untuk menampilkan ulang isian saat validasi gagal). */
function petaBody(body, kunciId, kolom) {
  const ids = arr(body[kunciId]);
  return Object.fromEntries(ids.map((id, i) => [id, Object.fromEntries(kolom.map((k) => [k, arr(body[k])[i] ?? '']))]));
}
const galatBaris = (galat, i) => ({
  qty: galat[`baris.${i}.qty`] || '', harga: galat[`baris.${i}.harga`] || '',
  diskon_persen: galat[`baris.${i}.diskon_persen`] || '', jumlah: galat[`baris.${i}.jumlah`] || '', barang_id: galat[`baris.${i}.barang_id`] || '',
});

const umum = { nav: '../pembelian/_navigasi', modul: 'pembelian' };

const JENIS = {
  pesanan: {
    ...umum, svc: po, judul: 'Pesanan Pembelian', tunggal: 'pesanan pembelian', dasar: '/pembelian/pesanan', labelBaru: 'Buat PO',
    kolomDaftar: [
      { judul: 'Pemasok', nilai: (d) => d.pemasok_nama },
      { judul: 'Penerimaan', nilai: (d) => (d.status === 'diposting' ? po.STATUS_TERIMA[d.status_terima] : '') },
      { judul: 'Total', nilai: (d) => uang(d.total), kanan: true },
    ],
    detail: (d, boleh) => ({
      jenis: `Pesanan pembelian · ${tgl(d.tanggal)}`,
      aksiLain: d.status_terima !== 'selesai' && boleh('pembelian', 'tambah') ? [{ href: `/pembelian/penerimaan/baru?po_id=${d.id}`, label: 'Terima barang' }] : [],
      info: [
        { label: 'Pemasok', nilai: d.pemasok_nama }, { label: 'Tanggal kirim', nilai: tgl(d.tanggal_kirim) },
        { label: 'PPN', nilai: d.pakai_ppn ? persen(d.ppn_persen) : 'Tanpa PPN' },
        { label: 'Penerimaan', nilai: d.status === 'diposting' ? po.STATUS_TERIMA[d.status_terima] : '' },
        { label: 'Dibuat oleh', nilai: d.dibuat_nama }, { label: 'Keterangan', nilai: d.keterangan, lebar: true },
      ],
      kolom: [{ judul: 'Barang' }, { judul: 'Qty', kanan: true }, { judul: 'Diterima', kanan: true }, { judul: 'Harga', kanan: true },
        { judul: 'Diskon', kanan: true }, { judul: 'DPP', kanan: true }, { judul: 'PPN', kanan: true }, { judul: 'Total', kanan: true }],
      baris: d.baris.map((b) => [`${b.kode} · ${b.nama}`, `${qty(b.qty)} ${b.satuan}`, qty(b.qty_diterima), uang(b.harga), persen(b.diskon_persen),
        uang(b.dpp), uang(b.ppn), uang(b.total)]),
      total: [{ label: 'DPP', nilai: uang(d.total_dpp) }, { label: 'PPN', nilai: uang(d.total_ppn) }, { label: 'Total', nilai: uang(d.total), tebal: true }],
    }),
    async form(req, dok, galat) {
      const [pemasok, barang, pajak] = await Promise.all([p.daftarPemasok(), p.barangBeli(), p.pengaturanPajak()]);
      let baris;
      if (dok.baris) baris = dok.baris.map((b) => ({ barang_id: String(b.barang_id), qty: qty(b.qty), harga: uang(b.harga), diskon_persen: persen(b.diskon_persen).replace('%', '') }));
      else baris = arr(dok.barang_id).map((id, i) => ({ barang_id: id, qty: arr(dok.qty)[i] || '', harga: arr(dok.harga)[i] || '', diskon_persen: arr(dok.diskon_persen)[i] || '' }))
        .filter((b) => b.barang_id || b.qty || b.harga);
      if (!baris.length) baris = [{ barang_id: '', qty: '', harga: '', diskon_persen: '' }];
      baris = baris.map((b, i) => ({ ...b, k: i, galat: galatBaris(galat, i) }));
      return { pemasok, barang, baris, pajak };
    },
    awal: () => ({ tanggal: hariIni(), pakai_ppn: true }),
  },

  penerimaan: {
    ...umum, svc: tb, judul: 'Penerimaan Barang', tunggal: 'penerimaan barang', dasar: '/pembelian/penerimaan', labelBaru: 'Terima barang',
    kolomDaftar: [
      { judul: 'Pemasok', nilai: (d) => d.pemasok_nama }, { judul: 'PO', nilai: (d) => d.po_nomor },
      { judul: 'Gudang', nilai: (d) => d.gudang_nama }, { judul: 'Nilai', nilai: (d) => (d.status === 'draft' ? '—' : uang(d.total_nilai)), kanan: true },
    ],
    detail: (d) => ({
      jenis: `Penerimaan barang · ${tgl(d.tanggal)}`,
      catatanBatal: 'Stok dikembalikan dan jurnal dibalik dengan tanggal hari ini. Penerimaan yang sudah difakturkan tidak bisa dibatalkan.',
      info: [
        { label: 'Pemasok', nilai: d.pemasok_nama }, { label: 'PO', nilai: d.po_nomor, kode: true }, { label: 'Gudang', nilai: d.gudang_nama },
        { label: 'No. surat jalan', nilai: d.no_surat_jalan }, { label: 'Dibuat oleh', nilai: d.dibuat_nama }, { label: 'Keterangan', nilai: d.keterangan, lebar: true },
      ],
      kolom: [{ judul: 'Barang' }, { judul: 'Qty', kanan: true }, { judul: 'Harga PO', kanan: true }, { judul: 'Diskon', kanan: true },
        { judul: 'Nilai', kanan: true }, { judul: 'Faktur' }],
      baris: d.baris.map((b) => [`${b.kode} · ${b.nama}`, `${qty(b.qty)} ${b.satuan}`, uang(b.harga), persen(b.diskon_persen),
        d.status === 'draft' ? '—' : uang(b.nilai), b.faktur_nomor || '']),
      total: d.status === 'draft' ? [] : [{ label: 'Total nilai', nilai: uang(d.total_nilai), tebal: true }],
    }),
    async form(req, dok, galat) {
      const poId = String(req.query.po_id || dok.po_id || '');
      const [daftarPo, gudang] = await Promise.all([po.poTerbuka(), opsiPersediaan.gudang()]);
      const sisa = poId ? await tb.sisaPo(poId) : [];
      // isian qty: dari draft, dari body gagal validasi, atau bawaan = sisa PO
      const dariDraft = Object.fromEntries((dok.baris || []).map((b) => [String(b.po_detail_id), qty(b.qty)]));
      const dariBody = dok.baris ? {} : petaBody(dok, 'po_detail_id', ['qty']);
      const terisi = Object.keys(dariBody).filter((x) => dariBody[x].qty !== '' && !/^0+([.,]0+)?$/.test(dariBody[x].qty));
      const baris = sisa.map((s) => ({
        ...s,
        // bawaan untuk dokumen baru = seluruh sisa PO
        isi: dariBody[s.po_detail_id] ? dariBody[s.po_detail_id].qty : dok.baris ? (dariDraft[s.po_detail_id] || '') : (dok.id ? '' : qty(s.qty_sisa)),
        galat: terisi.indexOf(s.po_detail_id) >= 0 ? galat[`baris.${terisi.indexOf(s.po_detail_id)}.qty`] || '' : '',
      }));
      if (poId && !daftarPo.some((x) => x.id === poId) && dok.po_nomor) daftarPo.push({ id: poId, nomor: dok.po_nomor, pemasok_nama: dok.pemasok_nama });
      return { daftarPo, gudang, poId, baris };
    },
    awal: (req) => ({ tanggal: hariIni(), po_id: req.query.po_id || '' }),
  },

  faktur: {
    ...umum, svc: fb, judul: 'Faktur Pembelian', tunggal: 'faktur pembelian', dasar: '/pembelian/faktur', labelBaru: 'Buat faktur',
    kolomDaftar: [
      { judul: 'Pemasok', nilai: (d) => d.pemasok_nama }, { judul: 'Jatuh tempo', nilai: (d) => tgl(d.jatuh_tempo) },
      { judul: 'Total', nilai: (d) => uang(d.total), kanan: true },
      { judul: 'Sisa', nilai: (d) => (d.status === 'diposting' ? uang(d.sisa) : ''), kanan: true },
    ],
    detail: (d, boleh) => ({
      jenis: `Faktur pembelian · ${tgl(d.tanggal)}`,
      catatanBatal: 'Jurnal faktur dibalik dan baris penerimaan bisa difakturkan ulang. Faktur yang sudah dibayar/diretur tidak bisa dibatalkan.',
      aksiLain: d.status === 'diposting' && Number(d.sisa) > 0 && boleh('pembelian', 'tambah')
        ? [{ href: `/pembelian/pembayaran/baru?pemasok_id=${d.pemasok_id}`, label: 'Bayar' }, { href: `/pembelian/retur/baru?faktur_id=${d.id}`, label: 'Retur' }] : [],
      info: [
        { label: 'Pemasok', nilai: d.pemasok_nama }, { label: 'No. faktur pemasok', nilai: d.no_faktur_pemasok },
        { label: 'No. faktur pajak', nilai: d.no_faktur_pajak }, { label: 'Jatuh tempo', nilai: tgl(d.jatuh_tempo) },
        { label: 'PPN', nilai: d.pakai_ppn ? persen(d.ppn_persen) : 'Tanpa PPN' }, { label: 'Dibuat oleh', nilai: d.dibuat_nama },
        { label: 'Keterangan', nilai: d.keterangan, lebar: true },
      ],
      kolom: [{ judul: 'Penerimaan' }, { judul: 'Barang' }, { judul: 'Qty', kanan: true }, { judul: 'Harga', kanan: true }, { judul: 'Diskon', kanan: true },
        { judul: 'DPP', kanan: true }, { judul: 'PPN', kanan: true }, { judul: 'Total', kanan: true }, { judul: 'Diretur', kanan: true }],
      baris: d.baris.map((b) => [b.penerimaan_nomor, `${b.kode} · ${b.nama}`, `${qty(b.qty)} ${b.satuan}`, uang(b.harga), persen(b.diskon_persen),
        uang(b.dpp), uang(b.ppn), uang(b.total), b.qty_diretur !== '0.0000' ? qty(b.qty_diretur) : '']),
      total: [
        { label: 'DPP', nilai: uang(d.total_dpp) }, { label: 'PPN', nilai: uang(d.total_ppn) }, { label: 'Total', nilai: uang(d.total), tebal: true },
        ...(d.status === 'diposting' ? [{ label: 'Dibayar', nilai: uang(d.dibayar) }, { label: 'Diretur', nilai: uang(d.diretur) }, { label: 'Sisa hutang', nilai: uang(d.sisa), tebal: true }] : []),
      ],
      tambahan: [
        { judul: 'Pembayaran', kolom: [{ judul: 'Nomor' }, { judul: 'Tanggal' }, { judul: 'Metode' }, { judul: 'Jumlah', kanan: true }],
          baris: d.bayar.map((x) => [x.nomor, tgl(x.tanggal), ph.METODE[x.metode], uang(x.jumlah)]) },
        { judul: 'Retur', kolom: [{ judul: 'Nomor' }, { judul: 'Tanggal' }, { judul: 'Total', kanan: true }],
          baris: d.retur.map((x) => [x.nomor, tgl(x.tanggal), uang(x.total)]) },
      ],
    }),
    async form(req, dok, galat) {
      const pemasokId = String(req.query.pemasok_id || dok.pemasok_id || '');
      const [pemasok, pajak] = await Promise.all([p.daftarPemasok(), p.pengaturanPajak()]);
      const sumber = pemasokId ? await fb.belumDifaktur(pemasokId) : [];
      const dariDraft = Object.fromEntries((dok.baris || []).map((b) => [String(b.penerimaan_detail_id), b]));
      const dariBody = dok.baris ? {} : petaBody(dok, 'penerimaan_detail_id', ['harga', 'diskon_persen', 'pilih']);
      const urutBody = Object.keys(dariBody);
      const baris = sumber.map((s) => {
        const d = dariDraft[s.penerimaan_detail_id];
        const bd = dariBody[s.penerimaan_detail_id];
        const iDipilih = urutBody.filter((x) => dariBody[x].pilih === '1').indexOf(s.penerimaan_detail_id);
        return {
          ...s,
          pilih: bd ? bd.pilih === '1' : d ? true : !dok.id && !Object.keys(dariBody).length,
          harga: bd ? bd.harga : d ? uang(d.harga) : uang(s.harga),
          diskon_persen: bd ? bd.diskon_persen : (persen(d ? d.diskon_persen : s.diskon_persen).replace('%', '')),
          galat: iDipilih >= 0 ? (galat[`baris.${iDipilih}.harga`] || galat[`baris.${iDipilih}.diskon_persen`] || '') : '',
        };
      });
      return { pemasok, pemasokId, baris, pajak };
    },
    awal: (req) => ({ tanggal: hariIni(), pemasok_id: req.query.pemasok_id || '', pakai_ppn: true }),
  },

  'uang-muka': {
    ...umum, svc: um, judul: 'Uang Muka Pemasok', tunggal: 'uang muka', dasar: '/pembelian/uang-muka', labelBaru: 'Catat uang muka',
    kolomDaftar: [
      { judul: 'Pemasok', nilai: (d) => d.pemasok_nama }, { judul: 'Jumlah', nilai: (d) => uang(d.jumlah), kanan: true },
      { judul: 'Sisa', nilai: (d) => (d.status === 'diposting' ? uang(d.sisa) : ''), kanan: true },
    ],
    detail: (d) => ({
      jenis: `Uang muka pembelian · ${tgl(d.tanggal)}`,
      catatanBatal: 'Jurnal uang muka dibalik. Uang muka yang sudah dipakai tidak bisa dibatalkan.',
      info: [
        { label: 'Pemasok', nilai: d.pemasok_nama }, { label: 'Dibayar dari', nilai: d.akun_kas_label }, { label: 'Jumlah', nilai: uang(d.jumlah) },
        { label: 'Sudah dipakai', nilai: d.status === 'diposting' ? uang(d.dipakai) : '' }, { label: 'Sisa', nilai: d.status === 'diposting' ? uang(d.sisa) : '' },
        { label: 'Dibuat oleh', nilai: d.dibuat_nama }, { label: 'Keterangan', nilai: d.keterangan, lebar: true },
      ],
    }),
    async form() {
      const [pemasok, akunKas] = await Promise.all([p.daftarPemasok(), p.akunKasBank()]);
      return { pemasok, akunKas };
    },
    awal: () => ({ tanggal: hariIni() }),
  },

  pembayaran: {
    ...umum, svc: ph, judul: 'Pembayaran Hutang', tunggal: 'pembayaran hutang', dasar: '/pembelian/pembayaran', labelBaru: 'Bayar hutang',
    kolomDaftar: [
      { judul: 'Pemasok', nilai: (d) => d.pemasok_nama }, { judul: 'Metode', nilai: (d) => ph.METODE[d.metode] },
      { judul: 'Total', nilai: (d) => uang(d.total), kanan: true },
    ],
    detail: (d) => ({
      jenis: `Pembayaran hutang · ${tgl(d.tanggal)}`,
      catatanBatal: 'Sisa hutang faktur dikembalikan dan jurnal dibalik dengan tanggal hari ini.',
      info: [
        { label: 'Pemasok', nilai: d.pemasok_nama }, { label: 'Metode', nilai: ph.METODE[d.metode] },
        { label: d.metode === 'kas' ? 'Dibayar dari' : 'Uang muka', nilai: d.metode === 'kas' ? d.akun_kas_label : d.uang_muka_nomor },
        { label: 'Dibuat oleh', nilai: d.dibuat_nama }, { label: 'Keterangan', nilai: d.keterangan, lebar: true },
      ],
      kolom: [{ judul: 'Faktur' }, { judul: 'No. faktur pemasok' }, { judul: 'Jatuh tempo' }, { judul: 'Total faktur', kanan: true }, { judul: 'Dibayar', kanan: true }],
      baris: d.baris.map((b) => [b.faktur_nomor, b.no_faktur_pemasok || '', tgl(b.jatuh_tempo), uang(b.faktur_total), uang(b.jumlah)]),
      total: [{ label: 'Total pembayaran', nilai: uang(d.total), tebal: true }],
    }),
    async form(req, dok, galat) {
      const pemasokId = String(req.query.pemasok_id || dok.pemasok_id || '');
      const [pemasok, akunKas] = await Promise.all([p.daftarPemasok(), p.akunKasBank()]);
      const [faktur, uangMuka] = pemasokId ? await Promise.all([fb.belumLunas(pemasokId), um.tersedia(pemasokId)]) : [[], []];
      const dariDraft = Object.fromEntries((dok.baris || []).map((b) => [String(b.faktur_id), b]));
      // Faktur di draft yang sudah tidak "belum lunas" tetap ditampilkan agar bisa dikoreksi
      const dariBody = dok.baris ? {} : petaBody(dok, 'faktur_id', ['jumlah']);
      const terisi = Object.keys(dariBody).filter((x) => dariBody[x].jumlah !== '');
      const baris = faktur.map((f) => ({
        ...f,
        jumlah: dariBody[f.id] ? dariBody[f.id].jumlah : dariDraft[f.id] ? uang(dariDraft[f.id].jumlah) : '',
        galat: terisi.indexOf(f.id) >= 0 ? galat[`baris.${terisi.indexOf(f.id)}.jumlah`] || '' : '',
      }));
      return { pemasok, pemasokId, akunKas, baris, uangMuka };
    },
    awal: (req) => ({ tanggal: hariIni(), pemasok_id: req.query.pemasok_id || '', metode: 'kas' }),
  },

  retur: {
    ...umum, svc: rb, judul: 'Retur Pembelian', tunggal: 'retur pembelian', dasar: '/pembelian/retur', labelBaru: 'Buat retur',
    kolomDaftar: [
      { judul: 'Pemasok', nilai: (d) => d.pemasok_nama }, { judul: 'Faktur', nilai: (d) => d.faktur_nomor },
      { judul: 'Total', nilai: (d) => uang(d.total), kanan: true },
    ],
    detail: (d) => ({
      jenis: `Retur pembelian · ${tgl(d.tanggal)}`,
      catatanBatal: 'Stok masuk kembali, hutang faktur dikembalikan, dan jurnal dibalik dengan tanggal hari ini.',
      info: [
        { label: 'Pemasok', nilai: d.pemasok_nama }, { label: 'Faktur', nilai: d.faktur_nomor, kode: true }, { label: 'Dari gudang', nilai: d.gudang_nama },
        { label: 'Dibuat oleh', nilai: d.dibuat_nama }, { label: 'Keterangan', nilai: d.keterangan, lebar: true },
      ],
      kolom: [{ judul: 'Barang' }, { judul: 'Qty', kanan: true }, { judul: 'Harga', kanan: true }, { judul: 'DPP', kanan: true },
        { judul: 'PPN', kanan: true }, { judul: 'Total', kanan: true }, { judul: 'Nilai HPP', kanan: true }],
      baris: d.baris.map((b) => [`${b.kode} · ${b.nama}`, `${qty(b.qty)} ${b.satuan}`, uang(b.harga), uang(b.dpp), uang(b.ppn), uang(b.total),
        d.status === 'draft' ? '—' : uang(b.nilai_hpp)]),
      total: [{ label: 'DPP', nilai: uang(d.total_dpp) }, { label: 'PPN', nilai: uang(d.total_ppn) }, { label: 'Total retur', nilai: uang(d.total), tebal: true }],
    }),
    async form(req, dok, galat) {
      const fakturId = String(req.query.faktur_id || dok.faktur_id || '');
      const [daftarFaktur, gudang] = await Promise.all([rb.fakturBisaRetur(), opsiPersediaan.gudang()]);
      const sumber = fakturId ? await rb.barisFaktur(fakturId) : [];
      const dariDraft = Object.fromEntries((dok.baris || []).map((b) => [String(b.faktur_detail_id), qty(b.qty)]));
      const dariBody = dok.baris ? {} : petaBody(dok, 'faktur_detail_id', ['qty']);
      const terisi = Object.keys(dariBody).filter((x) => dariBody[x].qty !== '');
      const baris = sumber.map((s) => ({
        ...s,
        isi: dariBody[s.faktur_detail_id] ? dariBody[s.faktur_detail_id].qty : dariDraft[s.faktur_detail_id] || '',
        galat: terisi.indexOf(s.faktur_detail_id) >= 0 ? galat[`baris.${terisi.indexOf(s.faktur_detail_id)}.qty`] || '' : '',
      }));
      if (fakturId && !daftarFaktur.some((x) => x.id === fakturId) && dok.faktur_nomor) daftarFaktur.push({ id: fakturId, nomor: dok.faktur_nomor, pemasok_nama: dok.pemasok_nama });
      return { daftarFaktur, gudang, fakturId, baris };
    },
    awal: (req) => ({ tanggal: hariIni(), faktur_id: req.query.faktur_id || '' }),
  },
};

function konfig(req) {
  return { kode: req.params.jenis, ...JENIS[req.params.jenis] };
}

async function daftar(req, res, next) {
  try {
    const k = konfig(req);
    const q = req.query;
    const filter = { q: String(q.q || '').slice(0, 100), status: q.status || '', dari: q.dari || '', sampai: q.sampai || '', hal: q.hal };
    const hasil = await k.svc.daftar(req.pengguna, filter);
    const data = { judul: k.judul, k, filter, STATUS, ...hasil };
    if (req.get('HX-Request') && req.get('HX-Target') === 'tabel-dokumen') return res.render('dokumen/_tabel', data);
    res.render('dokumen/daftar', data);
  } catch (err) { next(err); }
}

async function tampilForm(req, res, { dok, galat = {}, status = 200 }) {
  const k = konfig(req);
  const tambahan = await k.form(req, dok, galat);
  res.status(status).render(`pembelian/form-${k.kode}`, { judul: `${dok.id ? 'Ubah' : 'Buat'} ${k.tunggal}`, k, dok, galat, ...tambahan });
}

async function formBaru(req, res, next) {
  try { await tampilForm(req, res, { dok: konfig(req).awal(req) }); } catch (err) { next(err); }
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
      return tampilForm(req, res, { dok: { ...req.body, id, pakai_ppn: req.body.pakai_ppn === 'on' }, galat: err.galat, status: 422 }).catch(next);
    }
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const k = konfig(req);
    const dok = await k.svc.ambil(req.pengguna, req.params.id);
    res.render('dokumen/detail', { judul: dok.nomor || `Draft ${k.tunggal}`, k, dok, t: k.detail(dok, res.locals.boleh) });
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
      if (err.status && err.status < 500) {
        res.flash('galat', err.message);
        return res.redirect(nama === 'hapusDraft' && err.status === 404 ? k.dasar : `${k.dasar}/${req.params.id}`);
      }
      next(err);
    }
  };
}

module.exports = {
  JENIS, daftar, formBaru, formUbah, simpan, detail,
  posting: aksi('posting', (d, k) => `${k.tunggal[0].toUpperCase() + k.tunggal.slice(1)} ${d.nomor} berhasil diposting.`),
  batal: aksi('batal', (d) => `${d.nomor} dibatalkan.`),
  hapus: aksi('hapusDraft', () => 'Draft dihapus.'),
};
