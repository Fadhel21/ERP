const express = require('express');
const { wajibAkses } = require('../../middleware/akses');
const d = require('./controllers/dokumen');

const router = express.Router();
const akses = (aksi) => wajibAkses('pembelian', aksi);
const jenis = '/:jenis(pesanan|penerimaan|faktur|uang-muka|pembayaran|retur)';

router.get('/', (req, res) => res.redirect('/pembelian/pesanan'));
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
