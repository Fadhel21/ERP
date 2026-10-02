const dayjs = require('dayjs');
const { GalatBisnis } = require('../../../lib/galat');

/** Menolak transaksi bila tanggalnya berada di periode yang sudah ditutup. Bisa dipakai di dalam transaksi. */
async function pastikanPeriodeTerbuka(client, tanggal) {
  const t = dayjs(tanggal);
  if (!t.isValid()) throw new GalatBisnis('Tanggal transaksi tidak valid.');
  const { rows } = await client.query(
    'SELECT ditutup FROM periode WHERE tahun = $1 AND bulan = $2 FOR SHARE', [t.year(), t.month() + 1]);
  if (rows[0] && rows[0].ditutup) {
    throw new GalatBisnis(`Periode ${t.format('MM/YYYY')} sudah ditutup. Transaksi tidak dapat disimpan.`);
  }
}

module.exports = { pastikanPeriodeTerbuka };
