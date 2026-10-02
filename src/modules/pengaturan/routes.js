const express = require('express');
const auth = require('./controllers/auth');

// Rute publik (tanpa login).
const publik = express.Router();
publik.get('/login', auth.formLogin);
publik.post('/login', auth.prosesLogin);
publik.post('/logout', auth.logout);

// Rute modul pengaturan (wajib login) — diisi pada tahap berikutnya.
const modul = express.Router();

module.exports = { publik, modul };
