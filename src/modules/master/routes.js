const express = require('express');
const { wajibAkses } = require('../../middleware/akses');
const c = require('./controllers/master');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/master/barang'));
router.get('/:entitas', wajibAkses('master', 'lihat'), c.daftar);
router.get('/:entitas/ekspor.csv', wajibAkses('master', 'lihat'), c.ekspor);
router.get('/:entitas/baru', wajibAkses('master', 'tambah'), c.formTambah);
router.post('/:entitas', wajibAkses('master', 'tambah'), c.simpan);
router.get('/:entitas/:id(\\d+)/ubah', wajibAkses('master', 'ubah'), c.formUbah);
router.post('/:entitas/:id(\\d+)', wajibAkses('master', 'ubah'), c.simpan);
router.post('/:entitas/:id(\\d+)/hapus', wajibAkses('master', 'hapus'), c.hapus);

module.exports = router;
