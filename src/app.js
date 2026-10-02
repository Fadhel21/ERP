// Menyusun aplikasi Express (tanpa listen, agar bisa dites).
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { punyaAkses } = require('./lib/akses');
const { bacaSesi, wajibLogin } = require('./middleware/auth');
const { csrf } = require('./middleware/csrf');
const { tidakDitemukan, penanganGalat } = require('./middleware/error');
const pengaturan = require('./modules/pengaturan/routes');
const beranda = require('./modules/beranda/routes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', false);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // Alpine.js butuh 'unsafe-eval' untuk mengevaluasi ekspresi di atribut x-*.
      'script-src': ["'self'", "'unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'upgrade-insecure-requests': env.produksi ? [] : null,
    },
  },
}));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.produksi ? '7d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(env.cookieSecret));
app.use(csrf);
app.use(bacaSesi);

// Helper yang tersedia di semua view.
app.locals.namaAplikasi = 'ERP';
app.use((req, res, next) => {
  res.locals.boleh = (modul, aksi = 'lihat') => !!req.pengguna && punyaAkses(req.pengguna.hakAkses, modul, aksi);
  res.locals.path = req.path;
  res.locals.menuAktif = '';
  next();
});

app.use(pengaturan.publik);
app.use(wajibLogin);
app.use(beranda);
app.use('/pengaturan', pengaturan.modul);

app.use(tidakDitemukan);
app.use(penanganGalat);

module.exports = app;
