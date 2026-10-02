// Menjalankan file migrasi SQL bernomor (migrations/NNN_nama.sql) yang belum pernah dijalankan.
// Tiap file dijalankan dalam transaksinya sendiri. Migrasi lama tidak boleh diedit.
const fs = require('fs');
const path = require('path');

async function jalankanMigrasi({ diam = false } = {}) {
  const { pool, transaksi } = require('../src/config/db');
  const folder = path.join(__dirname, '..', 'migrations');

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrasi (
    nama VARCHAR(200) PRIMARY KEY,
    dijalankan_pada TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await pool.query('SELECT nama FROM schema_migrasi');
  const sudah = new Set(rows.map((r) => r.nama));

  const berkas = fs.readdirSync(folder).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  let jumlah = 0;
  for (const nama of berkas) {
    if (sudah.has(nama)) continue;
    const sql = fs.readFileSync(path.join(folder, nama), 'utf8');
    await transaksi(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrasi (nama) VALUES ($1)', [nama]);
    });
    if (!diam) console.log(`✔ ${nama}`);
    jumlah++;
  }
  if (!diam) console.log(jumlah ? `${jumlah} migrasi dijalankan.` : 'Tidak ada migrasi baru.');
}

module.exports = { jalankanMigrasi };

if (require.main === module) {
  jalankanMigrasi()
    .then(() => require('../src/config/db').pool.end())
    .catch((err) => {
      console.error('Migrasi gagal:', err.message);
      process.exit(1);
    });
}
