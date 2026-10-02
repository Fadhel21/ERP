const express = require('express');
const { ringkasan } = require('./services/ringkasan');

const router = express.Router();

// Pintasan aksi; hanya yang diizinkan yang ditampilkan.
const PINTASAN = [
  { label: 'Buat PO', ikon: 'dokumen', href: '/pembelian/pesanan/baru', modul: 'pembelian' },
  { label: 'Terima barang', ikon: 'terima', href: '/pembelian/penerimaan/baru', modul: 'pembelian' },
  { label: 'Faktur pembelian', ikon: 'faktur', href: '/pembelian/faktur/baru', modul: 'pembelian' },
  { label: 'Bayar hutang', ikon: 'bayar', href: '/pembelian/pembayaran/baru', modul: 'pembelian' },
  { label: 'Penyesuaian stok', ikon: 'penyesuaian', href: '/persediaan/penyesuaian/baru', modul: 'persediaan' },
  { label: 'Tambah barang', ikon: 'barang', href: '/master/barang/baru', modul: 'master' },
];

router.get('/', async (req, res, next) => {
  try {
    const data = await ringkasan(req.pengguna);
    const pintasan = PINTASAN.filter((p) => res.locals.boleh(p.modul, 'tambah'));
    const jam = new Date().getHours();
    const sapaan = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';
    res.render('beranda/index', { judul: 'Beranda', ...data, pintasan, sapaan });
  } catch (err) { next(err); }
});

module.exports = router;
