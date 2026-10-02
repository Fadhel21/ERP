const authService = require('../services/auth');
const env = require('../../../config/env');
const { buatSesi, hapusSesi } = require('../../../middleware/auth');
const demo = require('../../../../scripts/seed-demo');

// Daftar akun demo hanya ditampilkan di luar produksi.
const akunDemo = env.produksi ? [] : demo.AKUN.map((a) => ({ ...a, password: demo.PASSWORD_DEMO }));

// Pembatas percobaan login sederhana di memori: 10 gagal per 15 menit per IP.
const BATAS = 10;
const JENDELA_MS = 15 * 60 * 1000;
const percobaan = new Map();

function terkunci(ip) {
  const p = percobaan.get(ip);
  if (!p) return false;
  if (Date.now() - p.mulai > JENDELA_MS) {
    percobaan.delete(ip);
    return false;
  }
  return p.jumlah >= BATAS;
}

function catatGagal(ip) {
  const p = percobaan.get(ip);
  if (!p || Date.now() - p.mulai > JENDELA_MS) percobaan.set(ip, { mulai: Date.now(), jumlah: 1 });
  else p.jumlah++;
}

// Hanya izinkan pengalihan ke path lokal, cegah open redirect.
function tujuanAman(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

function formLogin(req, res) {
  if (req.pengguna) return res.redirect('/');
  res.render('login', { judul: 'Masuk', akunDemo, galat: null, username: '', kembali: tujuanAman(req.query.kembali) });
}

async function prosesLogin(req, res, next) {
  try {
    const { username = '', password = '' } = req.body;
    const kembali = tujuanAman(req.body.kembali);
    const tampilGalat = (pesan) => res.status(401).render('login', { judul: 'Masuk', akunDemo, galat: pesan, username, kembali });

    if (terkunci(req.ip)) return tampilGalat('Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
    const pengguna = await authService.verifikasiLogin(username.trim(), password);
    if (!pengguna) {
      catatGagal(req.ip);
      return tampilGalat('Username atau password salah.');
    }
    percobaan.delete(req.ip);
    buatSesi(res, pengguna.id);
    res.redirect(kembali);
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  hapusSesi(res);
  res.redirect('/login');
}

module.exports = { formLogin, prosesLogin, logout, tujuanAman };
