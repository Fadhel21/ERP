// Tes alur pembelian: PO → penerimaan → faktur → uang muka/pembayaran → retur, plus pembatalan berantai.
const { alasanLewati, siapkanDb } = require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');

test('pembelian (database)', { skip: alasanLewati }, async (t) => {
  const pool = await siapkanDb();
  t.after(() => pool.end());
  const po = require('../src/modules/pembelian/services/pesanan');
  const tb = require('../src/modules/pembelian/services/penerimaan');
  const fb = require('../src/modules/pembelian/services/faktur');
  const um = require('../src/modules/pembelian/services/uangmuka');
  const ph = require('../src/modules/pembelian/services/pembayaran');
  const rb = require('../src/modules/pembelian/services/retur');

  const peran = (await pool.query(`INSERT INTO peran (nama, admin) VALUES ('Admin', true) RETURNING id`)).rows[0].id;
  const uid = (await pool.query(`INSERT INTO pengguna (username, nama, password_hash, peran_id) VALUES ('u','U','x',$1) RETURNING id`, [peran])).rows[0].id;
  const admin = { id: uid, hakAkses: { admin: true, izin: {} } };
  const pembeliLihat = { id: uid, hakAkses: { admin: false, izin: { pembelian: ['lihat', 'tambah'] } } };
  const id = async (sql, p = []) => (await pool.query(sql, p)).rows[0].id;
  const sat = await id(`SELECT id FROM satuan WHERE kode='PCS'`);
  const gd = await id(`SELECT id FROM gudang WHERE kode='GD-UTAMA'`);
  const pms = await id(`INSERT INTO pemasok (kode, nama, termin_hari) VALUES ('PMS-1','PT Sumber', 30) RETURNING id`);
  const pms2 = await id(`INSERT INTO pemasok (kode, nama) VALUES ('PMS-2','CV Lain') RETURNING id`);
  const a = await id(`INSERT INTO barang (kode, nama, satuan_id) VALUES ('A','Barang A',$1) RETURNING id`, [sat]);
  const b = await id(`INSERT INTO barang (kode, nama, satuan_id, kena_ppn) VALUES ('B','Barang B (non-PPN)',$1,false) RETURNING id`, [sat]);
  const kas = await id(`SELECT id FROM akun WHERE kode='1-1100'`);
  const saldoAkun = async (kode) => (await pool.query(
    `SELECT coalesce(sum(d.debit - d.kredit), 0) AS s FROM jurnal_detail d JOIN akun a ON a.id = d.akun_id WHERE a.kode = $1`, [kode])).rows[0].s;
  const seimbang = async () => {
    const r = (await pool.query('SELECT sum(debit) d, sum(kredit) k FROM jurnal_detail')).rows[0];
    assert.equal(r.d, r.k, 'total debit = total kredit');
  };
  const nilaiStok = async () => (await pool.query('SELECT coalesce(sum(nilai), 0) AS n FROM saldo_barang')).rows[0].n;
  const posting = async (svc, data) => svc.posting(admin, (await svc.simpanDraft(admin, data)).id);

  let poDok, poDet;
  await t.test('PO: hitung diskon & PPN per baris, tarif disimpan di dokumen', async () => {
    // A: 10 × 10.000, diskon 5% = 5.000 → DPP 95.000, PPN 10.450 ; B: 3 × 3.333 non-PPN → 9.999
    poDok = await posting(po, { tanggal: '2025-10-01', pemasok_id: pms, pakai_ppn: 'on',
      barang_id: [a, b], qty: ['10', '3'], harga: ['10.000', '3.333'], diskon_persen: ['5', ''] });
    assert.equal(poDok.nomor, 'PO/2025/10/0001');
    assert.equal(poDok.ppn_persen, '11.00');
    assert.equal(poDok.total_dpp, '104999.00');
    assert.equal(poDok.total_ppn, '10450.00');
    assert.equal(poDok.total, '115449.00');
    poDet = (await po.ambil(admin, poDok.id)).baris;
  });

  let tb1;
  await t.test('penerimaan sebagian: stok masuk dengan harga PO, jurnal Persediaan / GRNI', async () => {
    const dA = poDet.find((x) => x.barang_id === String(a));
    const dB = poDet.find((x) => x.barang_id === String(b));
    await assert.rejects(tb.simpanDraft(admin, { tanggal: '2025-10-02', po_id: poDok.id, gudang_id: gd, po_detail_id: [dA.id], qty: ['11'] }),
      (e) => e.status === 422 && /Melebihi sisa PO/.test(e.galat['baris.0.qty']));
    tb1 = await posting(tb, { tanggal: '2025-10-02', po_id: poDok.id, gudang_id: gd, po_detail_id: [dA.id, dB.id], qty: ['4', '3'] });
    assert.equal(tb1.nomor, 'TB/2025/10/0001');
    // A: 4 × 10.000 = 40.000, diskon 2.000 → 38.000 ; B: 9.999
    assert.equal(tb1.total_nilai, '47999.00');
    assert.equal(await nilaiStok(), '47999.00');
    assert.equal(await saldoAkun('2-1700'), '-47999.00');
    assert.equal((await po.ambil(admin, poDok.id)).status_terima, 'sebagian');
    await seimbang();
  });

  await t.test('PO yang sudah diterima tidak bisa dibatalkan', async () => {
    await assert.rejects(po.batal(admin, poDok.id, 'x'), /sudah diterima/);
  });

  let tb2;
  await t.test('penerimaan sisa → PO selesai', async () => {
    const dA = poDet.find((x) => x.barang_id === String(a));
    tb2 = await posting(tb, { tanggal: '2025-10-03', po_id: poDok.id, gudang_id: gd, po_detail_id: [dA.id], qty: ['6'] });
    assert.equal(tb2.total_nilai, '57000.00');
    assert.equal((await po.ambil(admin, poDok.id)).status_terima, 'selesai');
  });

  let fk;
  await t.test('faktur: harga beda dari PO → selisih ke akun Selisih Persediaan; GRNI tertutup', async () => {
    const baris = await fb.belumDifaktur(pms);
    assert.equal(baris.length, 3);
    // Faktur semua baris; harga A di penerimaan ke-2 naik jadi 10.100
    const harga = baris.map((x) => (x.penerimaan_nomor === tb2.nomor ? '10.100' : x.harga));
    fk = await posting(fb, { tanggal: '2025-10-05', pemasok_id: pms, pakai_ppn: 'on', no_faktur_pemasok: 'INV-77',
      penerimaan_detail_id: baris.map((x) => x.penerimaan_detail_id), harga, diskon_persen: baris.map((x) => x.diskon_persen),
      pilih: baris.map(() => '1') });
    assert.equal(fk.nomor, 'FB/2025/10/0001');
    assert.equal(fk.jatuh_tempo, '2025-11-04', 'jatuh tempo = tanggal + termin 30 hari');
    // A(4): 38.000 + PPN 4.180 ; B: 9.999 ; A(6): 60.600 − 3.030 = 57.570 + PPN 6.333 (6.332,7)
    assert.equal(fk.total_dpp, '105569.00');
    assert.equal(fk.total_ppn, '10513.00');
    assert.equal(fk.total, '116082.00');
    assert.equal(await saldoAkun('2-1700'), '0.00');
    assert.equal(await saldoAkun('5-2000'), '570.00');
    assert.equal(await saldoAkun('1-1500'), '10513.00');
    assert.equal(await saldoAkun('2-1100'), '-116082.00');
    assert.equal((await fb.belumDifaktur(pms)).length, 0);
    await seimbang();
  });

  await t.test('baris penerimaan tidak bisa difakturkan dua kali', async () => {
    await assert.rejects(tb.batal(admin, tb1.id, 'x'), /sudah difakturkan/);
  });

  let uangMuka;
  await t.test('uang muka & pembayaran sebagian dengan potong uang muka', async () => {
    uangMuka = await posting(um, { tanggal: '2025-10-04', pemasok_id: pms, akun_kas_id: kas, jumlah: '50.000' });
    assert.equal(await saldoAkun('1-1600'), '50000.00');
    await assert.rejects(ph.simpanDraft(admin, { tanggal: '2025-10-06', pemasok_id: pms, metode: 'uang_muka', uang_muka_id: uangMuka.id,
      faktur_id: [fk.id], jumlah: ['60.000'] }), (e) => /melebihi sisa uang muka/.test(e.galat.uang_muka_id));
    await assert.rejects(ph.simpanDraft(admin, { tanggal: '2025-10-06', pemasok_id: pms2, metode: 'kas', akun_kas_id: kas,
      faktur_id: [fk.id], jumlah: ['1'] }), (e) => /tidak valid untuk pemasok/.test(e.galat['baris.0.jumlah']));
    const bayar = await posting(ph, { tanggal: '2025-10-06', pemasok_id: pms, metode: 'uang_muka', uang_muka_id: uangMuka.id,
      faktur_id: [fk.id], jumlah: ['50.000'] });
    assert.equal(bayar.nomor, 'PH/2025/10/0001');
    assert.equal(await saldoAkun('1-1600'), '0.00');
    const f = await fb.ambil(admin, fk.id);
    assert.equal(f.sisa, '66082.00');
    await assert.rejects(um.batal(admin, uangMuka.id, 'x'), /sudah dipakai/);
    await assert.rejects(fb.batal(admin, fk.id, 'x'), /sudah dibayar/);
  });

  await t.test('pembayaran melebihi sisa hutang ditolak', async () => {
    await assert.rejects(ph.simpanDraft(admin, { tanggal: '2025-10-07', pemasok_id: pms, metode: 'kas', akun_kas_id: kas,
      faktur_id: [fk.id], jumlah: ['66.082,01'] }), (e) => /Melebihi sisa hutang/.test(e.galat['baris.0.jumlah']));
  });

  let retur;
  await t.test('retur sebagian: stok keluar (HPP), hutang berkurang, PPN masukan dibalik', async () => {
    const det = await rb.barisFaktur(fk.id);
    const lineB = det.find((x) => x.kode === 'B');
    retur = await posting(rb, { tanggal: '2025-10-08', faktur_id: fk.id, gudang_id: gd, faktur_detail_id: [lineB.faktur_detail_id], qty: ['1'] });
    assert.equal(retur.nomor, 'RB/2025/10/0001');
    assert.equal(retur.total, '3333.00');  // non-PPN
    const f = await fb.ambil(admin, fk.id);
    assert.equal(f.diretur, '3333.00');
    assert.equal(f.sisa, '62749.00');
    // retur sisa baris B (2) → nilai = 9.999 − 3.333 = 6.666 (tanpa sisa pembulatan)
    const r2 = await posting(rb, { tanggal: '2025-10-08', faktur_id: fk.id, gudang_id: gd, faktur_detail_id: [lineB.faktur_detail_id], qty: ['2'] });
    assert.equal(r2.total, '6666.00');
    await assert.rejects(rb.simpanDraft(admin, { tanggal: '2025-10-08', faktur_id: fk.id, gudang_id: gd, faktur_detail_id: [lineB.faktur_detail_id], qty: ['1'] }),
      (e) => /Melebihi qty faktur/.test(e.galat['baris.0.qty']));
    await seimbang();
  });

  await t.test('retur tidak boleh melebihi sisa hutang', async () => {
    const det = await rb.barisFaktur(fk.id);
    const lineA = det.find((x) => x.kode === 'A' && x.qty === '6.0000');
    await posting(ph, { tanggal: '2025-10-09', pemasok_id: pms, metode: 'kas', akun_kas_id: kas, faktur_id: [fk.id], jumlah: ['50.000'] });
    // sisa hutang = 62.749 − 6.666 − 50.000 = 6.083 ; retur 1 A (10.100 −5% = 9.595 + PPN 1.055) = 10.650 > sisa
    await assert.rejects(rb.simpanDraft(admin, { tanggal: '2025-10-09', faktur_id: fk.id, gudang_id: gd, faktur_detail_id: [lineA.faktur_detail_id], qty: ['1'] }),
      (e) => /melebihi sisa hutang/.test(e.galat.baris));
  });

  await t.test('pembatalan berantai: retur → pembayaran → faktur → penerimaan → PO', async () => {
    const nilaiAwal = '0.00';
    const daftar = async (svc) => (await svc.daftar(admin, { status: 'diposting' })).baris;
    for (const r of await daftar(rb)) await rb.batal(admin, r.id, 'uji');
    for (const r of await daftar(ph)) await ph.batal(admin, r.id, 'uji');
    await um.batal(admin, uangMuka.id, 'uji');
    await fb.batal(admin, fk.id, 'uji');
    await tb.batal(admin, tb2.id, 'uji');
    await tb.batal(admin, tb1.id, 'uji');
    await po.batal(admin, poDok.id, 'uji');
    assert.equal(await nilaiStok(), nilaiAwal);
    for (const kode of ['1-1100', '1-1400', '1-1500', '1-1600', '2-1100', '2-1700', '5-2000']) {
      assert.equal(await saldoAkun(kode), '0.00', `saldo ${kode} kembali nol`);
    }
    await seimbang();
  });

  await t.test('hak akses posting pembelian diperiksa di service', async () => {
    const d = await po.simpanDraft(pembeliLihat, { tanggal: '2025-10-10', pemasok_id: pms, barang_id: [a], qty: ['1'], harga: ['1'] });
    await assert.rejects(po.posting(pembeliLihat, d.id), (e) => e.status === 403);
  });
});
