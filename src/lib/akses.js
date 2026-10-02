// Logika hak akses murni (tanpa DB) agar bisa dipakai di middleware, service, dan view.
const { GalatAkses } = require('./galat');

const MODUL = ['master', 'persediaan', 'pembelian', 'penjualan', 'akuntansi', 'laporan', 'pengaturan'];
const AKSI = ['lihat', 'tambah', 'ubah', 'hapus', 'posting', 'batal'];

/**
 * hakAkses: { admin: boolean, izin: { [modul]: string[] } }
 */
function punyaAkses(hakAkses, modul, aksi) {
  if (!hakAkses) return false;
  if (hakAkses.admin) return true;
  const daftar = hakAkses.izin && hakAkses.izin[modul];
  return Array.isArray(daftar) && daftar.includes(aksi);
}

/** Dipanggil di service: melempar GalatAkses bila tidak berhak. */
function pastikanAkses(pengguna, modul, aksi) {
  if (!pengguna || !punyaAkses(pengguna.hakAkses, modul, aksi)) throw new GalatAkses();
}

module.exports = { MODUL, AKSI, punyaAkses, pastikanAkses };
