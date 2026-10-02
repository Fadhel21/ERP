// Penanganan 404 dan error terpusat.
function tidakDitemukan(req, res) {
  res.status(404).render('galat', { judul: 'Tidak ditemukan', status: 404, pesan: 'Halaman yang Anda cari tidak ada.' });
}

// eslint-disable-next-line no-unused-vars
function penanganGalat(err, req, res, next) {
  const status = err.status || 500;
  // Pesan error internal tidak ditampilkan ke pengguna.
  const pesan = status < 500 ? err.message : 'Terjadi kesalahan pada server. Silakan coba lagi.';
  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);

  if (req.get('HX-Request')) {
    // Untuk HTMX: kirim potongan notifikasi yang ditempel ke wadah #notifikasi.
    res.set('HX-Retarget', '#notifikasi').set('HX-Reswap', 'innerHTML');
    return res.status(status).render('partials/notifikasi', { jenis: 'galat', pesan });
  }
  res.status(status).render('galat', { judul: 'Terjadi kesalahan', status, pesan });
}

module.exports = { tidakDitemukan, penanganGalat };
