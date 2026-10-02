/** Mencatat jejak audit. Panggil di dalam transaksi yang sama dengan perubahan datanya. */
async function catatAudit(client, { penggunaId, tabel, rekamanId, aksi, sebelum = null, sesudah = null }) {
  await client.query(
    `INSERT INTO jejak_audit (pengguna_id, tabel, rekaman_id, aksi, sebelum, sesudah)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [penggunaId || null, tabel, rekamanId || null, aksi,
      sebelum && JSON.stringify(sebelum), sesudah && JSON.stringify(sesudah)]);
}

module.exports = { catatAudit };
