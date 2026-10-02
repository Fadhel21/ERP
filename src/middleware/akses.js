// Middleware hak akses per modul per aksi. Service tetap memeriksa ulang dengan pastikanAkses().
const { punyaAkses } = require('../lib/akses');
const { GalatAkses } = require('../lib/galat');

function wajibAkses(modul, aksi = 'lihat') {
  return (req, res, next) => {
    if (req.pengguna && punyaAkses(req.pengguna.hakAkses, modul, aksi)) return next();
    next(new GalatAkses());
  };
}

module.exports = { wajibAkses };
