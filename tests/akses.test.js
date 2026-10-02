require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');
const { punyaAkses, pastikanAkses } = require('../src/lib/akses');
const { samaAman } = require('../src/middleware/csrf');
const { tujuanAman } = require('../src/modules/pengaturan/controllers/auth');

test('hak akses: admin boleh semua', () => {
  assert.equal(punyaAkses({ admin: true, izin: {} }, 'akuntansi', 'posting'), true);
});

test('hak akses: hanya izin yang diberikan', () => {
  const h = { admin: false, izin: { penjualan: ['lihat', 'tambah'] } };
  assert.equal(punyaAkses(h, 'penjualan', 'lihat'), true);
  assert.equal(punyaAkses(h, 'penjualan', 'posting'), false);
  assert.equal(punyaAkses(h, 'pembelian', 'lihat'), false);
  assert.equal(punyaAkses(null, 'penjualan', 'lihat'), false);
});

test('hak akses: pastikanAkses melempar 403 di service', () => {
  const pengguna = { hakAkses: { admin: false, izin: { laporan: ['lihat'] } } };
  assert.doesNotThrow(() => pastikanAkses(pengguna, 'laporan', 'lihat'));
  assert.throws(() => pastikanAkses(pengguna, 'akuntansi', 'lihat'), (e) => e.status === 403);
  assert.throws(() => pastikanAkses(null, 'laporan', 'lihat'), (e) => e.status === 403);
});

test('csrf: pembanding token', () => {
  assert.equal(samaAman('abc', 'abc'), true);
  assert.equal(samaAman('abc', 'abd'), false);
  assert.equal(samaAman('abc', 'abcd'), false);
});

test('login: hanya mengalihkan ke path lokal', () => {
  assert.equal(tujuanAman('/penjualan'), '/penjualan');
  assert.equal(tujuanAman('//situs-jahat.com'), '/');
  assert.equal(tujuanAman('https://situs-jahat.com'), '/');
  assert.equal(tujuanAman(undefined), '/');
});
