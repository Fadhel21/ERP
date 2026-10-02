// Error yang aman ditampilkan ke pengguna (pesan dalam Bahasa Indonesia).
class GalatBisnis extends Error {
  constructor(pesan, status = 400) {
    super(pesan);
    this.name = 'GalatBisnis';
    this.status = status;
  }
}

class GalatAkses extends GalatBisnis {
  constructor(pesan = 'Anda tidak memiliki hak akses untuk tindakan ini.') {
    super(pesan, 403);
    this.name = 'GalatAkses';
  }
}

module.exports = { GalatBisnis, GalatAkses };
