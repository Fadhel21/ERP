// Membuat peran & akun demo untuk mencoba aplikasi. JANGAN dipakai di produksi.
// Pemakaian (PowerShell): node scripts/seed-demo.js
const bcrypt = require('bcryptjs');

const PASSWORD_DEMO = 'demo1234';

// Izin tiap peran demo: { modul: [aksi] }
const SEMUA = ['lihat', 'tambah', 'ubah', 'hapus', 'posting', 'batal'];
const PERAN = [
  { nama: 'Administrator', admin: true, izin: {} },
  { nama: 'Gudang', izin: { master: ['lihat'], persediaan: SEMUA, laporan: ['lihat'] } },
  { nama: 'Pembelian', izin: { master: ['lihat', 'tambah', 'ubah'], pembelian: SEMUA, persediaan: ['lihat'], laporan: ['lihat'] } },
  { nama: 'Penjualan', izin: { master: ['lihat', 'tambah', 'ubah'], penjualan: SEMUA, persediaan: ['lihat'], laporan: ['lihat'] } },
  { nama: 'Akuntan', izin: { master: ['lihat'], akuntansi: SEMUA, laporan: ['lihat'], pembelian: ['lihat'], penjualan: ['lihat'] } },
];
const AKUN = [
  { username: 'demo.admin', nama: 'Demo Administrator', peran: 'Administrator' },
  { username: 'demo.gudang', nama: 'Demo Gudang', peran: 'Gudang' },
  { username: 'demo.pembelian', nama: 'Demo Pembelian', peran: 'Pembelian' },
  { username: 'demo.penjualan', nama: 'Demo Penjualan', peran: 'Penjualan' },
  { username: 'demo.akuntan', nama: 'Demo Akuntan', peran: 'Akuntan' },
];

async function seedDemo() {
  const env = require('../src/config/env');
  if (env.produksi) throw new Error('Akun demo tidak boleh dibuat di lingkungan produksi.');
  const { transaksi, pool } = require('../src/config/db');
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10);

  await transaksi(async (client) => {
    const idPeran = {};
    for (const p of PERAN) {
      let { rows } = await client.query(
        'SELECT id FROM peran WHERE lower(nama) = lower($1) AND deleted_at IS NULL', [p.nama]);
      if (!rows.length) {
        ({ rows } = await client.query(
          'INSERT INTO peran (nama, admin, keterangan) VALUES ($1, $2, $3) RETURNING id',
          [p.nama, !!p.admin, 'Peran demo']));
      }
      idPeran[p.nama] = rows[0].id;
      for (const [modul, daftar] of Object.entries(p.izin)) {
        for (const aksi of daftar) {
          await client.query(
            `INSERT INTO peran_izin (peran_id, modul, aksi) VALUES ($1, $2, $3)
             ON CONFLICT (peran_id, modul, aksi) WHERE deleted_at IS NULL DO NOTHING`,
            [rows[0].id, modul, aksi]);
        }
      }
    }
    for (const a of AKUN) {
      const { rowCount } = await client.query(
        `INSERT INTO pengguna (username, nama, password_hash, peran_id)
         SELECT $1::varchar, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM pengguna WHERE lower(username) = lower($1::varchar) AND deleted_at IS NULL)`,
        [a.username, a.nama, hash, idPeran[a.peran]]);
      console.log(`${rowCount ? '✔ dibuat ' : '• sudah ada'}  ${a.username.padEnd(16)} (${a.peran})`);
    }
  });
  console.log(`\nPassword semua akun demo: ${PASSWORD_DEMO}`);
  await pool.end();
}

module.exports = { AKUN, PASSWORD_DEMO };

if (require.main === module) {
  seedDemo().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
