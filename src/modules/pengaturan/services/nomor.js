// Penomoran dokumen: KODE/YYYY/MM/0001, berurutan per jenis per bulan.
const dayjs = require('dayjs');

/**
 * Wajib dipanggil di dalam transaksi (client dari db.transaksi).
 * Baris penghitung dikunci FOR UPDATE sehingga dua transaksi bersamaan tidak mendapat nomor sama.
 */
async function nomorBerikutnya(client, jenis, tanggal) {
  const t = dayjs(tanggal);
  const periode = t.format('YYYYMM');
  await client.query(
    `INSERT INTO penghitung_dokumen (jenis, periode) VALUES ($1, $2)
     ON CONFLICT (jenis, periode) DO NOTHING`, [jenis, periode]);
  const { rows } = await client.query(
    'SELECT id, terakhir FROM penghitung_dokumen WHERE jenis = $1 AND periode = $2 FOR UPDATE',
    [jenis, periode]);
  const urut = rows[0].terakhir + 1;
  await client.query('UPDATE penghitung_dokumen SET terakhir = $1 WHERE id = $2', [urut, rows[0].id]);
  return `${jenis}/${t.format('YYYY')}/${t.format('MM')}/${String(urut).padStart(4, '0')}`;
}

module.exports = { nomorBerikutnya };
