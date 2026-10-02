// Tes persediaan & jurnal dengan database tes.
const { alasanLewati, siapkanDb } = require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');

test('persediaan & jurnal (database)', { skip: alasanLewati }, async (t) => {
  const pool = await siapkanDb();
  t.after(() => pool.end());
  const db = require('../src/config/db');
  const pny = require('../src/modules/persediaan/services/penyesuaian');
  const trf = require('../src/modules/persediaan/services/transfer');
  const opn = require('../src/modules/persediaan/services/opname');
  const { buatJurnal } = require('../src/modules/akuntansi/services/jurnal');

  const peran = await pool.query(`INSERT INTO peran (nama, admin) VALUES ('Admin', true) RETURNING id`);
  const pid = (await pool.query(`INSERT INTO pengguna (username, nama, password_hash, peran_id) VALUES ('u','U','x',$1) RETURNING id`, [peran.rows[0].id])).rows[0].id;
  const admin = { id: pid, hakAkses: { admin: true, izin: {} } };
  const hanyaLihat = { id: pid, hakAkses: { admin: false, izin: { persediaan: ['lihat', 'tambah'] } } };
  const satuan = (await pool.query(`SELECT id FROM satuan WHERE kode='PCS'`)).rows[0].id;
  const g1 = (await pool.query(`SELECT id FROM gudang WHERE kode='GD-UTAMA'`)).rows[0].id;
  const g2 = (await pool.query(`INSERT INTO gudang (kode, nama) VALUES ('GD-2', 'Gudang Dua') RETURNING id`)).rows[0].id;
  const brg = (await pool.query(`INSERT INTO barang (kode, nama, satuan_id) VALUES ('B1', 'Barang Satu', $1) RETURNING id`, [satuan])).rows[0].id;
  const jasa = (await pool.query(`INSERT INTO barang (kode, nama, satuan_id, jenis) VALUES ('J1', 'Jasa', $1, 'jasa') RETURNING id`, [satuan])).rows[0].id;

  const saldo = async () => (await pool.query('SELECT qty, nilai, hpp_terakhir FROM saldo_barang WHERE barang_id = $1', [brg])).rows[0];
  const saldoGudang = async (g) => ((await pool.query('SELECT qty FROM saldo_stok WHERE barang_id = $1 AND gudang_id = $2', [brg, g])).rows[0] || { qty: '0.0000' }).qty;
  const akunSaldo = async (kode) => (await pool.query(
    `SELECT coalesce(sum(d.debit - d.kredit), 0) AS s FROM jurnal_detail d JOIN akun a ON a.id = d.akun_id WHERE a.kode = $1`, [kode])).rows[0].s;
  const posting = async (svc, data) => { const d = await svc.simpanDraft(admin, data); return svc.posting(admin, d.id); };

  /** Invarian: saldo = jumlah kartu stok, & persediaan di buku besar = nilai stok. */
  async function periksaInvarian() {
    const { rows: [k] } = await pool.query(
      `SELECT coalesce(sum(qty_masuk - qty_keluar), 0) AS qty, coalesce(sum(nilai_masuk - nilai_keluar), 0) AS nilai FROM mutasi_stok WHERE barang_id = $1`, [brg]);
    const s = await saldo();
    assert.equal(s.qty, k.qty, 'qty saldo = jumlah mutasi');
    assert.equal(s.nilai, k.nilai, 'nilai saldo = jumlah mutasi');
    const { rows: [g] } = await pool.query('SELECT coalesce(sum(qty), 0) AS q FROM saldo_stok WHERE barang_id = $1', [brg]);
    assert.equal(g.q, s.qty, 'jumlah saldo gudang = saldo global');
    assert.equal(await akunSaldo('1-1400'), s.nilai, 'akun persediaan = nilai stok');
    const { rows: [j] } = await pool.query('SELECT sum(debit) AS d, sum(kredit) AS k FROM jurnal_detail');
    assert.equal(j.d, j.k, 'total debit = total kredit');
  }

  await t.test('jurnal tidak seimbang ditolak (service & database)', async () => {
    const kas = (await pool.query(`SELECT id FROM akun WHERE kode='1-1100'`)).rows[0].id;
    const modal = (await pool.query(`SELECT id FROM akun WHERE kode='3-1000'`)).rows[0].id;
    await assert.rejects(db.transaksi((k) => buatJurnal(k, {
      tanggal: '2025-10-01', keterangan: 'x', sumberJenis: 'uji',
      baris: [{ akun_id: kas, debit: '100.00' }, { akun_id: modal, kredit: '99.99' }] })), /tidak seimbang/);
    // Lewati service, tulis langsung ke tabel → trigger deferred menolak saat COMMIT
    await assert.rejects(db.transaksi(async (k) => {
      const j = (await k.query(`INSERT INTO jurnal (nomor, tanggal, keterangan, sumber_jenis) VALUES ('X1','2025-10-01','x','uji') RETURNING id`)).rows[0];
      await k.query('INSERT INTO jurnal_detail (jurnal_id, akun_id, debit) VALUES ($1, $2, 100)', [j.id, kas]);
      await k.query('INSERT INTO jurnal_detail (jurnal_id, akun_id, kredit) VALUES ($1, $2, 50)', [j.id, modal]);
    }), /tidak seimbang/);
    const header = (await pool.query(`SELECT id FROM akun WHERE kode='1-1000'`)).rows[0].id;
    await assert.rejects(db.transaksi((k) => buatJurnal(k, {
      tanggal: '2025-10-01', keterangan: 'x', sumberJenis: 'uji',
      baris: [{ akun_id: header, debit: '1' }, { akun_id: modal, kredit: '1' }] })), /akun header/);
  });

  await t.test('saldo awal: stok, nilai, HPP & jurnal ke ekuitas saldo awal', async () => {
    const d = await posting(pny, { tanggal: '2025-10-01', jenis: 'saldo_awal', gudang_id: g1, barang_id: brg, qty: '10', harga_satuan: '1.000' });
    assert.equal(d.status, 'diposting');
    assert.equal(d.nomor, 'ADJ/2025/10/0001');
    assert.deepEqual(await saldo(), { qty: '10.0000', nilai: '10000.00', hpp_terakhir: '1000.00' });
    assert.equal(await akunSaldo('3-9000'), '-10000.00');
    await periksaInvarian();
  });

  await t.test('rata-rata bergerak & pembulatan', async () => {
    // 10 @1000 + 5 @1.333,33 → nilai 16.666,65 / 15 = 1.111,11
    await posting(pny, { tanggal: '2025-10-02', jenis: 'masuk', gudang_id: g1, barang_id: brg, qty: '5', harga_satuan: '1.333,33' });
    let s = await saldo();
    assert.equal(s.nilai, '16666.65');
    assert.equal(s.hpp_terakhir, '1111.11');
    // keluar 7 → 7 × 16666.65 / 15 = 7777.77 (dibulatkan)
    await posting(pny, { tanggal: '2025-10-03', jenis: 'keluar', gudang_id: g1, barang_id: brg, qty: '7' });
    s = await saldo();
    assert.equal(s.qty, '8.0000');
    assert.equal(s.nilai, '8888.88');
    await periksaInvarian();
  });

  await t.test('stok negatif ditolak & tidak ada perubahan setengah jalan', async () => {
    const sebelum = await saldo();
    const nMutasi = (await pool.query('SELECT count(*) FROM mutasi_stok')).rows[0].count;
    const d = await pny.simpanDraft(admin, { tanggal: '2025-10-03', jenis: 'keluar', gudang_id: g1, barang_id: brg, qty: '8,0001' });
    await assert.rejects(pny.posting(admin, d.id), /tidak cukup/);
    assert.deepEqual(await saldo(), sebelum);
    assert.equal((await pool.query('SELECT count(*) FROM mutasi_stok')).rows[0].count, nMutasi);
    assert.equal((await pny.ambil(admin, d.id)).status, 'draft');
    assert.equal((await pny.ambil(admin, d.id)).nomor, null, 'nomor tidak terpakai saat gagal');
    await pny.hapusDraft(admin, d.id);
  });

  await t.test('tanggal mundur ditolak', async () => {
    const d = await pny.simpanDraft(admin, { tanggal: '2025-10-01', jenis: 'masuk', gudang_id: g1, barang_id: brg, qty: '1', harga_satuan: '1000' });
    await assert.rejects(pny.posting(admin, d.id), /bertanggal mundur/);
    await pny.hapusDraft(admin, d.id);
  });

  await t.test('barang jasa tidak bisa masuk dokumen stok', async () => {
    await assert.rejects(pny.simpanDraft(admin, { tanggal: '2025-10-05', jenis: 'masuk', gudang_id: g1, barang_id: jasa, qty: '1', harga_satuan: '1' }),
      (e) => e.status === 422 && /jasa/.test(e.galat['baris.0.barang_id']));
  });

  await t.test('transfer antar gudang: qty pindah, nilai total tetap, tanpa jurnal', async () => {
    const sebelum = await saldo();
    const nJurnal = (await pool.query('SELECT count(*) FROM jurnal')).rows[0].count;
    const d = await posting(trf, { tanggal: '2025-10-04', gudang_asal_id: g1, gudang_tujuan_id: g2, barang_id: brg, qty: '3' });
    assert.equal(d.nomor, 'TRF/2025/10/0001');
    assert.equal(await saldoGudang(g1), '5.0000');
    assert.equal(await saldoGudang(g2), '3.0000');
    assert.deepEqual(await saldo(), sebelum);
    assert.equal((await pool.query('SELECT count(*) FROM jurnal')).rows[0].count, nJurnal);
    await periksaInvarian();
  });

  await t.test('stok opname: selisih jadi mutasi & jurnal', async () => {
    const d = await opn.buat(admin, { tanggal: '2025-10-05', gudang_id: g1 });
    const det = (await opn.ambil(admin, d.id)).baris.find((b) => b.barang_id === String(brg));
    assert.equal(det.qty_sistem, '5.0000');
    await opn.simpanHitungan(admin, d.id, { [`fisik_${det.id}`]: '4' });
    const p = await opn.posting(admin, d.id);
    assert.equal(p.nomor, 'OPN/2025/10/0001');
    assert.equal(await saldoGudang(g1), '4.0000');
    const setelah = (await opn.ambil(admin, d.id)).baris.find((b) => b.barang_id === String(brg));
    assert.equal(setelah.qty_selisih, '-1.0000');
    assert.equal(setelah.nilai_selisih, '-1111.11');
    await periksaInvarian();
  });

  await t.test('pembatalan mengembalikan stok & membalik jurnal', async () => {
    const d = await posting(pny, { tanggal: '2025-10-06', jenis: 'masuk', gudang_id: g1, barang_id: brg, qty: '2', harga_satuan: '500' });
    const sebelumBatal = await saldo();
    assert.equal(sebelumBatal.qty, '9.0000');
    await assert.rejects(pny.batal(admin, d.id, ''), /Alasan/);
    const b = await pny.batal(admin, d.id, 'Salah input');
    assert.equal(b.status, 'batal');
    const s = await saldo();
    assert.equal(s.qty, '7.0000');
    assert.equal(s.nilai, '7777.77');
    const jb = (await pool.query('SELECT membalik_id FROM jurnal WHERE id = $1', [b.jurnal_batal_id])).rows[0];
    assert.equal(jb.membalik_id, d.jurnal_id);
    await assert.rejects(pny.batal(admin, d.id, 'lagi'), /hanya bisa dibatalkan/);
    await assert.rejects(pny.simpanDraft(admin, { tanggal: '2025-10-06', jenis: 'masuk', gudang_id: g1, barang_id: brg, qty: '1', harga_satuan: '1' }, d.id), /tidak bisa diubah/);
    await periksaInvarian();
  });

  await t.test('stok habis → nilai ikut nol (tanpa sisa sen)', async () => {
    const kini = require('../src/modules/persediaan/services/umum').hariIni();
    await posting(trf, { tanggal: kini, gudang_asal_id: g2, gudang_tujuan_id: g1, barang_id: brg, qty: '3' });
    await posting(pny, { tanggal: kini, jenis: 'keluar', gudang_id: g1, barang_id: brg, qty: '7' });
    assert.deepEqual(await saldo(), { qty: '0.0000', nilai: '0.00', hpp_terakhir: '1111.11' });
    await periksaInvarian();
  });

  await t.test('kartu stok & jurnal tidak bisa diubah langsung', async () => {
    await assert.rejects(pool.query('UPDATE mutasi_stok SET qty_masuk = 999'), /hanya boleh ditambah/);
    await assert.rejects(pool.query('DELETE FROM jurnal_detail'), /hanya boleh ditambah/);
  });

  await t.test('periode tertutup menolak posting', async () => {
    await pool.query('INSERT INTO periode (tahun, bulan, ditutup) VALUES (2025, 11, true)');
    const d = await pny.simpanDraft(admin, { tanggal: '2025-11-02', jenis: 'masuk', gudang_id: g1, barang_id: brg, qty: '1', harga_satuan: '1' });
    await assert.rejects(pny.posting(admin, d.id), /sudah ditutup/);
  });

  await t.test('hak akses posting/batal diperiksa di service', async () => {
    const d = await pny.simpanDraft(hanyaLihat, { tanggal: require('../src/modules/persediaan/services/umum').hariIni(), jenis: 'masuk', gudang_id: g1, barang_id: brg, qty: '1', harga_satuan: '1' });
    await assert.rejects(pny.posting(hanyaLihat, d.id), (e) => e.status === 403);
    await assert.rejects(pny.hapusDraft(hanyaLihat, d.id), (e) => e.status === 403);
  });
});
