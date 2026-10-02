// Tes yang membutuhkan database tes: penomoran, tutup periode, transaksi, login & hak akses lewat HTTP.
const { alasanLewati, siapkanDb } = require('./bantuan');
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

let pool;
let db;
let server;
let dasar;

test('fondasi (database)', { skip: alasanLewati }, async (t) => {
  pool = await siapkanDb();
  db = require('../src/config/db');
  const hash = await bcrypt.hash('rahasia123', 4);
  const admin = await pool.query(`INSERT INTO peran (nama, admin) VALUES ('Administrator', true) RETURNING id`);
  const kasir = await pool.query(`INSERT INTO peran (nama) VALUES ('Kasir') RETURNING id`);
  await pool.query(`INSERT INTO peran_izin (peran_id, modul, aksi) VALUES ($1, 'penjualan', 'lihat')`, [kasir.rows[0].id]);
  await pool.query(`INSERT INTO pengguna (username, nama, password_hash, peran_id) VALUES
    ('admin', 'Admin', $1, $2), ('kasir', 'Kasir', $1, $3)`, [hash, admin.rows[0].id, kasir.rows[0].id]);

  const app = require('../src/app');
  await new Promise((r) => { server = app.listen(0, r); });
  dasar = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  const { nomorBerikutnya } = require('../src/modules/pengaturan/services/nomor');
  const { pastikanPeriodeTerbuka } = require('../src/modules/pengaturan/services/periode');

  await t.test('nomor dokumen berurutan dan reset per bulan', async () => {
    const n1 = await db.transaksi((c) => nomorBerikutnya(c, 'PO', '2026-10-05'));
    const n2 = await db.transaksi((c) => nomorBerikutnya(c, 'PO', '2026-10-20'));
    const n3 = await db.transaksi((c) => nomorBerikutnya(c, 'PO', '2026-11-01'));
    const n4 = await db.transaksi((c) => nomorBerikutnya(c, 'SO', '2026-10-01'));
    assert.deepEqual([n1, n2, n3, n4], ['PO/2026/10/0001', 'PO/2026/10/0002', 'PO/2026/11/0001', 'SO/2026/10/0001']);
  });

  await t.test('nomor dokumen tidak ganda saat bersamaan', async () => {
    const hasil = await Promise.all(Array.from({ length: 8 }, () =>
      db.transaksi((c) => nomorBerikutnya(c, 'FJ', '2026-10-10'))));
    assert.equal(new Set(hasil).size, 8);
    assert.deepEqual([...hasil].sort(), Array.from({ length: 8 }, (_, i) => `FJ/2026/10/${String(i + 1).padStart(4, '0')}`));
  });

  await t.test('nomor tidak terpakai bila transaksi gagal (rollback)', async () => {
    await assert.rejects(db.transaksi(async (c) => {
      await nomorBerikutnya(c, 'DO', '2026-10-01');
      throw new Error('gagal disengaja');
    }));
    const n = await db.transaksi((c) => nomorBerikutnya(c, 'DO', '2026-10-01'));
    assert.equal(n, 'DO/2026/10/0001');
  });

  await t.test('transaksi di periode tertutup ditolak', async () => {
    await pool.query('INSERT INTO periode (tahun, bulan, ditutup) VALUES (2026, 9, true), (2026, 10, false)');
    await assert.rejects(db.transaksi((c) => pastikanPeriodeTerbuka(c, '2026-09-30')), /sudah ditutup/);
    await db.transaksi((c) => pastikanPeriodeTerbuka(c, '2026-10-01'));
    await db.transaksi((c) => pastikanPeriodeTerbuka(c, '2026-12-01')); // belum ada baris = terbuka
  });

  // --- HTTP ---
  async function masuk(username, password) {
    const halaman = await fetch(`${dasar}/login`);
    const csrfCookie = halaman.headers.getSetCookie().find((c) => c.startsWith('csrf='));
    const token = decodeURIComponent(csrfCookie.split(';')[0].split('=')[1]).slice(2).split('.')[0];
    const res = await fetch(`${dasar}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie.split(';')[0] },
      body: new URLSearchParams({ _csrf: token, username, password }),
    });
    const sesi = res.headers.getSetCookie().find((c) => c.startsWith('sesi='));
    return { res, cookie: [csrfCookie.split(';')[0], sesi && sesi.split(';')[0]].filter(Boolean).join('; '), token };
  }

  await t.test('halaman wajib login', async () => {
    const res = await fetch(`${dasar}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
  });

  await t.test('login salah ditolak, login benar berhasil', async () => {
    const salah = await masuk('admin', 'keliru');
    assert.equal(salah.res.status, 401);
    const benar = await masuk('admin', 'rahasia123');
    assert.equal(benar.res.status, 302);
    const beranda = await fetch(`${dasar}/`, { headers: { Cookie: benar.cookie } });
    assert.equal(beranda.status, 200);
    assert.match(await beranda.text(), /Selamat (pagi|siang|sore|malam)/);
  });

  await t.test('POST tanpa token CSRF ditolak', async () => {
    const res = await fetch(`${dasar}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=admin&password=rahasia123',
    });
    assert.equal(res.status, 403);
  });

  await t.test('sidebar hanya menampilkan modul yang diizinkan', async () => {
    const { cookie } = await masuk('kasir', 'rahasia123');
    const html = await (await fetch(`${dasar}/`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /Penjualan/);
    assert.doesNotMatch(html, /Akuntansi/);
  });
});
