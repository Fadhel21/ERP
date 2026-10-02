require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDesimal, formatDesimal, formatKuantitas } = require('../src/lib/angka');
const { buatCsv } = require('../src/lib/csv');
const { bersihkan } = require('../src/modules/master/services/validasi');
const { DEFINISI } = require('../src/modules/master/definisi');

test('parseDesimal: format Indonesia & titik desimal, tanpa float', () => {
  assert.equal(parseDesimal('1.500.000,50', 2), '1500000.50');
  assert.equal(parseDesimal('1500000.5', 2), '1500000.50');
  assert.equal(parseDesimal('1.500', 2), '1500.00');
  assert.equal(parseDesimal('Rp 2.000', 2), '2000.00');
  assert.equal(parseDesimal('0,1', 2), '0.10');
  assert.equal(parseDesimal('12,3456', 4), '12.3456');
  assert.equal(parseDesimal('007', 2), '7.00');
  // Nilai yang akan rusak bila lewat float
  assert.equal(parseDesimal('9999999999999.99', 2), '9999999999999.99');
});

test('parseDesimal: menolak masukan tidak valid', () => {
  assert.equal(parseDesimal('1,234', 2), null); // 3 desimal untuk uang
  assert.equal(parseDesimal('abc', 2), null);
  assert.equal(parseDesimal('1,2,3', 2), null);
  assert.equal(parseDesimal('', 2), null);
});

test('formatDesimal & formatKuantitas', () => {
  assert.equal(formatDesimal('1500000.50'), '1.500.000,50');
  assert.equal(formatDesimal('0.00'), '0,00');
  assert.equal(formatDesimal('-1234.5'), '-1.234,50');
  assert.equal(formatKuantitas('12.5000'), '12,5');
  assert.equal(formatKuantitas('10.0000'), '10');
  assert.equal(formatKuantitas('1000.2500'), '1.000,25');
});

test('CSV: escape, pemisah titik koma, cegah injeksi formula', () => {
  const csv = buatCsv([{ judul: 'A', ambil: (b) => b.a }, { judul: 'B', ambil: (b) => b.b }],
    [{ a: 'x;y', b: '=1+1' }, { a: 'kata "kutip"', b: null }]);
  assert.equal(csv, '﻿A;B\r\n"x;y";\'=1+1\r\n"kata ""kutip""";\r\n');
});

test('validasi master barang', () => {
  const def = DEFINISI.barang;
  const { data, galat } = bersihkan(def, {
    kode: ' brg-1 ', nama: 'Kopi', jenis: 'stok', satuan_id: '1',
    harga_beli: '10.000', harga_jual: '12.500,5', stok_minimum: '2,5', kena_ppn: 'on',
  });
  assert.deepEqual(galat, {});
  assert.equal(data.kode, 'BRG-1');
  assert.equal(data.harga_beli, '10000.00');
  assert.equal(data.harga_jual, '12500.50');
  assert.equal(data.stok_minimum, '2.5000');
  assert.equal(data.kena_ppn, true);
  assert.equal(data.aktif, false); // checkbox tidak dikirim = tidak dicentang

  const salah = bersihkan(def, { nama: '', jenis: 'lain', satuan_id: 'x', harga_jual: '-5' });
  assert.ok(salah.galat.kode && salah.galat.nama && salah.galat.jenis && salah.galat.satuan_id && salah.galat.harga_jual);
});
