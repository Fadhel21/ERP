// Pesan sekali tampil (flash) lewat signed cookie berumur pendek — dipakai setelah redirect.
const env = require('../config/env');

const NAMA = 'pesan';

function pesan(req, res, next) {
  const ada = req.signedCookies && req.signedCookies[NAMA];
  res.locals.pesanFlash = null;
  if (ada) {
    try { res.locals.pesanFlash = JSON.parse(ada); } catch (e) { /* abaikan */ }
    res.clearCookie(NAMA);
  }
  /** res.flash('sukses' | 'galat', 'Teks pesan') */
  res.flash = (jenis, teks) => {
    res.cookie(NAMA, JSON.stringify({ jenis, pesan: String(teks).slice(0, 300) }), {
      httpOnly: true, signed: true, sameSite: 'lax', secure: env.produksi, maxAge: 60 * 1000,
    });
  };
  next();
}

module.exports = { pesan };
