const express = require('express');
const { wajibAkses } = require('../../middleware/akses');
const d = require('./controllers/dokumen');
const s = require('./controllers/stok');

const router = express.Router();
const akses = (aksi) => wajibAkses('persediaan', aksi);

router.get('/', (req, res) => res.redirect('/persediaan/kartu-stok'));
router.get('/kartu-stok', akses('lihat'), s.kartuStok);

// Stok opname (didaftarkan sebelum rute generik :jenis)
router.get('/opname', akses('lihat'), s.opnameDaftar);
router.get('/opname/baru', akses('tambah'), s.opnameBaru);
router.post('/opname', akses('tambah'), s.opnameBuat);
router.get('/opname/:id(\\d+)', akses('lihat'), s.opnameDetail);
router.post('/opname/:id(\\d+)', akses('ubah'), s.opnameSimpan);
router.post('/opname/:id(\\d+)/posting', akses('posting'), s.opnamePosting);
router.post('/opname/:id(\\d+)/batal', akses('batal'), s.opnameBatal);
router.post('/opname/:id(\\d+)/hapus', akses('hapus'), s.opnameHapus);

// Penyesuaian & mutasi antar gudang
const jenis = '/:jenis(penyesuaian|mutasi)';
router.get(jenis, akses('lihat'), d.daftar);
router.get(`${jenis}/baru`, akses('tambah'), d.formBaru);
router.post(jenis, akses('tambah'), d.simpan);
router.get(`${jenis}/:id(\\d+)`, akses('lihat'), d.detail);
router.get(`${jenis}/:id(\\d+)/ubah`, akses('ubah'), d.formUbah);
router.post(`${jenis}/:id(\\d+)`, akses('ubah'), d.simpan);
router.post(`${jenis}/:id(\\d+)/posting`, akses('posting'), d.posting);
router.post(`${jenis}/:id(\\d+)/batal`, akses('batal'), d.batal);
router.post(`${jenis}/:id(\\d+)/hapus`, akses('hapus'), d.hapus);

module.exports = router;
