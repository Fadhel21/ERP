require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');
const { hitungBaris, jumlahkanBaris } = require('../src/lib/pajak');

test('PPN 11% dibulatkan per baris ke rupiah penuh (half-up)', () => {
  // 3 × 3.333 = 9.999 → PPN 1.099,89 → 1.100
  assert.deepEqual(hitungBaris({ qty: '3', harga: '3333', tarifPpn: '11' }),
    { bruto: '9999.00', diskon: '0.00', dpp: '9999.00', ppn: '1100.00', total: '11099.00' });
  // DPP 4.545 → PPN 499,95 → 500 ; DPP 4.540 → 499,40 → 499
  assert.equal(hitungBaris({ qty: '1', harga: '4545', tarifPpn: '11' }).ppn, '500.00');
  assert.equal(hitungBaris({ qty: '1', harga: '4540', tarifPpn: '11' }).ppn, '499.00');
  // tepat ,50 dibulatkan ke atas: DPP 50 × 11% = 5,50 → 6
  assert.equal(hitungBaris({ qty: '1', harga: '50', tarifPpn: '11' }).ppn, '6.00');
});

test('diskon % per baris dibulatkan ke rupiah penuh, lalu PPN dari DPP', () => {
  // 7 × 1.234,50 = 8.641,50 ; diskon 2,5% = 216,0375 → 216 ; DPP 8.425,50 ; PPN 926,805 → 927
  assert.deepEqual(hitungBaris({ qty: '7', harga: '1234.50', diskonPersen: '2.5', tarifPpn: '11' }),
    { bruto: '8641.50', diskon: '216.00', dpp: '8425.50', ppn: '927.00', total: '9352.50' });
});

test('qty pecahan & barang tidak kena PPN', () => {
  // 2,5 kg × 12.345,67 = 30.864,175 → 30.864,18
  const r = hitungBaris({ qty: '2.5', harga: '12345.67', kenaPpn: false, tarifPpn: '11' });
  assert.equal(r.bruto, '30864.18');
  assert.equal(r.ppn, '0.00');
  assert.equal(r.total, '30864.18');
});

test('pembulatan 2 desimal bila pengaturan diubah', () => {
  assert.equal(hitungBaris({ qty: '1', harga: '4545', tarifPpn: '11', desimal: 2 }).ppn, '499.95');
});

test('angka besar tetap presisi', () => {
  const r = hitungBaris({ qty: '1000', harga: '9999999999.99', tarifPpn: '11' });
  assert.equal(r.dpp, '9999999999990.00');
  assert.equal(r.ppn, '1099999999999.00');
});

test('jumlahkan baris & validasi', () => {
  const a = hitungBaris({ qty: '1', harga: '100', tarifPpn: '11' });
  const b = hitungBaris({ qty: '2', harga: '0.5', tarifPpn: '11' });
  assert.deepEqual(jumlahkanBaris([a, b]), { bruto: '101.00', diskon: '0.00', dpp: '101.00', ppn: '11.00', total: '112.00' });
  assert.throws(() => hitungBaris({ qty: '1', harga: '1', diskonPersen: '101' }), /maksimal 100/);
  assert.throws(() => hitungBaris({ qty: 'x', harga: '1' }), /tidak valid/);
});
