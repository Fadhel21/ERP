// Proteksi CSRF pola double-submit: token acak di signed cookie,
// harus dikirim ulang lewat field form "_csrf" atau header "X-CSRF-Token" (HTMX).
const crypto = require('crypto');
const env = require('../config/env');
const { GalatBisnis } = require('../lib/galat');

const NAMA_COOKIE = 'csrf';
const METODE_AMAN = new Set(['GET', 'HEAD', 'OPTIONS']);

function samaAman(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function csrf(req, res, next) {
  let token = req.signedCookies && req.signedCookies[NAMA_COOKIE];
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(NAMA_COOKIE, token, { httpOnly: true, signed: true, sameSite: 'lax', secure: env.produksi });
  }
  res.locals.csrfToken = token;

  if (METODE_AMAN.has(req.method)) return next();
  const dikirim = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
  if (dikirim && req.signedCookies[NAMA_COOKIE] && samaAman(dikirim, token)) return next();
  next(new GalatBisnis('Sesi formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.', 403));
}

module.exports = { csrf, samaAman };
