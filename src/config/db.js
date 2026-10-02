// Koneksi PostgreSQL dan helper transaksi.
const { Pool, types } = require('pg');
const env = require('./env');

// NUMERIC (1700) dan BIGINT (20) dikembalikan sebagai string agar tidak kehilangan presisi.
// Jangan diubah ke parseFloat: perhitungan uang dilakukan di SQL.
types.setTypeParser(1700, (v) => v);
types.setTypeParser(20, (v) => v);
// DATE (1082) sebagai string 'YYYY-MM-DD' agar tidak bergeser zona waktu.
types.setTypeParser(1082, (v) => v);

// Pool dibuat saat pertama dipakai.
let _pool = null;
function ambilPool() {
  if (!_pool) _pool = new Pool({ connectionString: env.databaseUrl, max: 10 });
  return _pool;
}

/** Query biasa di luar transaksi. */
function query(sql, params) {
  return ambilPool().query(sql, params);
}

/**
 * Menjalankan fn(client) di dalam satu BEGIN ... COMMIT.
 * Bila fn melempar error, seluruh perubahan di-ROLLBACK lalu error diteruskan.
 * Semua service yang menyentuh lebih dari satu tabel WAJIB memakai helper ini.
 */
async function transaksi(fn) {
  const client = await ambilPool().connect();
  try {
    await client.query('BEGIN');
    const hasil = await fn(client);
    await client.query('COMMIT');
    return hasil;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  get pool() { return ambilPool(); },
  query,
  transaksi,
};
