// Membaca dan memvalidasi variabel lingkungan sekali saat aplikasi mulai.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

function wajib(nama) {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`Variabel lingkungan ${nama} belum diisi di .env`);
  return nilai;
}

const produksi = process.env.NODE_ENV === 'production';

module.exports = {
  produksi,
  port: Number(process.env.PORT || 3000),
  // Dibaca saat pertama dipakai, agar tes tanpa database tetap bisa jalan.
  get databaseUrl() {
    return process.env.NODE_ENV === 'test' ? wajib('DATABASE_URL_TES') : wajib('DATABASE_URL');
  },
  jwtSecret: wajib('JWT_SECRET'),
  cookieSecret: wajib('COOKIE_SECRET'),
  smtpUrl: process.env.SMTP_URL || '',
  // Lama sesi login (jam)
  lamaSesiJam: 8,
};
