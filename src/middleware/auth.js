// Autentikasi: JWT disimpan di signed cookie "sesi".
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const authService = require('../modules/pengaturan/services/auth');

const NAMA_COOKIE = 'sesi';

function opsiCookie() {
  return {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: env.produksi,
    maxAge: env.lamaSesiJam * 3600 * 1000,
  };
}

function buatSesi(res, penggunaId) {
  const token = jwt.sign({ sub: String(penggunaId) }, env.jwtSecret, { expiresIn: `${env.lamaSesiJam}h` });
  res.cookie(NAMA_COOKIE, token, opsiCookie());
}

function hapusSesi(res) {
  res.clearCookie(NAMA_COOKIE, { ...opsiCookie(), maxAge: undefined });
}

/** Membaca sesi (bila ada) dan mengisi req.pengguna & res.locals.pengguna. */
async function bacaSesi(req, res, next) {
  req.pengguna = null;
  const token = req.signedCookies && req.signedCookies[NAMA_COOKIE];
  if (token) {
    try {
      const data = jwt.verify(token, env.jwtSecret);
      req.pengguna = await authService.muatPengguna(data.sub);
    } catch (err) {
      if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') return next(err);
    }
    if (!req.pengguna) hapusSesi(res);
  }
  res.locals.pengguna = req.pengguna;
  next();
}

/** Wajib login; bila belum, arahkan ke halaman login. */
function wajibLogin(req, res, next) {
  if (req.pengguna) return next();
  if (req.get('HX-Request')) {
    res.set('HX-Redirect', '/login');
    return res.status(401).end();
  }
  res.redirect(`/login?kembali=${encodeURIComponent(req.originalUrl)}`);
}

module.exports = { buatSesi, hapusSesi, bacaSesi, wajibLogin };
