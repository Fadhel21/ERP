// Tes master data dengan database tes.
const { alasanLewati, siapkanDb } = require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');

test('master data (database)', { skip: alasanLewati }, async (t) => {
  const pool = await siapkanDb();
  t.after(() => pool.end());
  const svc = require('../src/modules/master/services/master');
  const { DEFINISI } = require('../src/modules/master/definisi');

  const u = await pool.query(`INSERT INTO peran (nama, admin) VALUES ('Admin', true) RETURNING id`);
  const p = await pool.query(`INSERT INTO pengguna (username, nama, password_hash, peran_id)
    VALUES ('uji', 'Uji', 'x', $1) RETURNING id`, [u.rows[0].id]);
  const admin = { id: p.rows[0].id, hakAkses: { admin: true, izin: {} } };
  const gudang = { id: p.rows[0].id, hakAkses: { admin: false, izin: { master: ['lihat'] } } };
  const idSatuan = (await pool.query(`SELECT id FROM satuan WHERE kode = 'PCS'`)).rows[0].id;

  await t.test('data awal: COA template & induk terisi', async () => {
    const { rows } = await pool.query(`SELECT a.kode, p.kode AS induk FROM akun a LEFT JOIN akun p ON p.id = a.induk_id ORDER BY a.kode`);
    assert.ok(rows.length >= 45);
    const peta = Object.fromEntries(rows.map((r) => [r.kode, r.induk]));
    assert.equal(peta['1-0000'], null);
    assert.equal(peta['1-1000'], '1-0000');
    assert.equal(peta['1-1100'], '1-1000');
    assert.equal(peta['6-9000'], '6-0000');
  });

  let barang;
  await t.test('kode otomatis & akun bawaan untuk barang baru', async () => {
    const awal = await svc.nilaiAwal(DEFINISI.barang);
    assert.equal(awal.kode, 'BRG-00001');
    assert.ok(awal.akun_persediaan_id && awal.akun_pendapatan_id && awal.akun_hpp_id);
    barang = await svc.simpan(admin, DEFINISI.barang, {
      ...awal, kode: '', nama: 'Kopi Bubuk', satuan_id: idSatuan, harga_jual: '25.000', aktif: 'on', kena_ppn: 'on',
    });
    assert.equal(barang.kode, 'BRG-00001');
    assert.equal(barang.harga_jual, '25000.00');
    const lagi = await svc.nilaiAwal(DEFINISI.barang);
    assert.equal(lagi.kode, 'BRG-00002');
  });

  await t.test('kode unik (tidak peka huruf besar/kecil)', async () => {
    await assert.rejects(
      svc.simpan(admin, DEFINISI.barang, { kode: 'brg-00001', nama: 'Lain', jenis: 'stok', satuan_id: idSatuan }),
      (e) => e.status === 422 && /sudah dipakai/.test(e.galat.kode));
  });

  await t.test('akun header tidak bisa dipilih di barang', async () => {
    const header = (await pool.query(`SELECT id FROM akun WHERE kode = '1-1000'`)).rows[0].id;
    await assert.rejects(
      svc.simpan(admin, DEFINISI.barang, { nama: 'X', jenis: 'stok', satuan_id: idSatuan, akun_persediaan_id: header }),
      (e) => e.status === 422 && !!e.galat.akun_persediaan_id);
  });

  await t.test('data yang masih dipakai tidak bisa dihapus', async () => {
    await assert.rejects(svc.hapus(admin, DEFINISI.satuan, idSatuan), (e) => e.status === 409 && /dipakai oleh 1 barang/.test(e.message));
    const akunPersediaan = barang.akun_persediaan_id;
    await assert.rejects(svc.hapus(admin, DEFINISI.akun, akunPersediaan), (e) => e.status === 409);
  });

  await t.test('akun yang dipakai tidak bisa dijadikan header', async () => {
    const akun = await svc.ambil(admin, DEFINISI.akun, barang.akun_persediaan_id);
    await assert.rejects(
      svc.simpan(admin, DEFINISI.akun, { ...akun, akun_header: 'on', aktif: 'on' }, akun.id),
      (e) => e.status === 422 && /dipakai oleh 1 barang/.test(e.galat.akun_header));
  });

  await t.test('hapus = soft delete + jejak audit; kode boleh dipakai ulang', async () => {
    const satuan = await svc.simpan(admin, DEFINISI.satuan, { kode: 'DUS', nama: 'Dus', aktif: 'on' });
    await svc.hapus(admin, DEFINISI.satuan, satuan.id);
    const r = await pool.query('SELECT deleted_at FROM satuan WHERE id = $1', [satuan.id]);
    assert.ok(r.rows[0].deleted_at, 'baris masih ada dengan deleted_at terisi');
    const audit = await pool.query(`SELECT aksi FROM jejak_audit WHERE tabel = 'satuan' AND rekaman_id = $1 ORDER BY id`, [satuan.id]);
    assert.deepEqual(audit.rows.map((x) => x.aksi), ['tambah', 'hapus']);
    await svc.simpan(admin, DEFINISI.satuan, { kode: 'DUS', nama: 'Dus baru', aktif: 'on' });
  });

  await t.test('hak akses diperiksa di service (pengguna hanya-lihat)', async () => {
    const hasil = await svc.daftar(gudang, DEFINISI.barang, {});
    assert.equal(hasil.total, 1);
    await assert.rejects(svc.simpan(gudang, DEFINISI.satuan, { kode: 'ZZ', nama: 'Z', aktif: 'on' }), (e) => e.status === 403);
    await assert.rejects(svc.hapus(gudang, DEFINISI.barang, barang.id), (e) => e.status === 403);
  });

  await t.test('cari & filter nonaktif', async () => {
    await svc.simpan(admin, DEFINISI.pelanggan, { nama: 'Toko Maju', termin_hari: '30', batas_kredit: '5.000.000', aktif: 'on' });
    await svc.simpan(admin, DEFINISI.pelanggan, { nama: 'Toko Lama', aktif: '' });
    assert.equal((await svc.daftar(admin, DEFINISI.pelanggan, { q: 'toko' })).total, 1);
    assert.equal((await svc.daftar(admin, DEFINISI.pelanggan, { q: 'toko', semua: true })).total, 2);
    assert.equal((await svc.daftar(admin, DEFINISI.pelanggan, { q: '100%' })).total, 0);
  });
});
