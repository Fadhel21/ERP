// Definisi master data. Nama tabel & kolom HANYA berasal dari file ini (tidak pernah dari input pengguna).
//
// Tipe field: teks, teks_panjang, uang (NUMERIC 15,2), kuantitas (NUMERIC 15,4), bilangan (INTEGER),
//             boolean, pilihan (opsi tetap), relasi (FK ke tabel lain).
// prefiksKode: bila diisi, kode diisi otomatis (mis. BRG-00001) namun tetap boleh diubah.
// referensi: [tabel, kolom, label] — data tidak boleh dihapus bila masih dirujuk.

const AKUN_POSTING = { tabel: 'akun', label: "kode || ' · ' || nama", syarat: 'akun_header = false AND aktif' };

const JENIS_AKUN = [
  ['aset', 'Aset'], ['kewajiban', 'Kewajiban'], ['ekuitas', 'Ekuitas'],
  ['pendapatan', 'Pendapatan'], ['hpp', 'Harga Pokok'], ['beban', 'Beban'],
];

const kode = (maks = 20) => ({ nama: 'kode', label: 'Kode', tipe: 'teks', wajib: true, maks });
const aktif = { nama: 'aktif', label: 'Aktif', tipe: 'boolean', bawaan: true, bantuan: 'Data nonaktif tidak muncul di pilihan transaksi.' };

const DEFINISI = {
  barang: {
    tabel: 'barang', judul: 'Barang', judulTunggal: 'barang', prefiksKode: 'BRG',
    field: [
      kode(30),
      { nama: 'nama', label: 'Nama barang', tipe: 'teks', wajib: true, maks: 150 },
      { nama: 'jenis', label: 'Jenis', tipe: 'pilihan', wajib: true, bawaan: 'stok', opsi: [['stok', 'Barang stok'], ['jasa', 'Jasa (tanpa stok)']] },
      { nama: 'kategori_id', label: 'Kategori', tipe: 'relasi', relasi: { tabel: 'kategori_barang', label: "kode || ' · ' || nama", syarat: 'aktif' } },
      { nama: 'satuan_id', label: 'Satuan', tipe: 'relasi', wajib: true, relasi: { tabel: 'satuan', label: "kode || ' · ' || nama", syarat: 'aktif' } },
      { nama: 'harga_beli', label: 'Harga beli', tipe: 'uang', bawaan: '0' },
      { nama: 'harga_jual', label: 'Harga jual', tipe: 'uang', bawaan: '0' },
      { nama: 'stok_minimum', label: 'Stok minimum', tipe: 'kuantitas', bawaan: '0', bantuan: 'Pengingat dikirim bila stok di bawah angka ini.' },
      { nama: 'kena_ppn', label: 'Kena PPN', tipe: 'boolean', bawaan: true },
      { nama: 'akun_persediaan_id', label: 'Akun persediaan', tipe: 'relasi', relasi: AKUN_POSTING, bawaanAkun: 'akun_persediaan', grup: 'Akun' },
      { nama: 'akun_pendapatan_id', label: 'Akun pendapatan', tipe: 'relasi', relasi: AKUN_POSTING, bawaanAkun: 'akun_pendapatan', grup: 'Akun' },
      { nama: 'akun_hpp_id', label: 'Akun HPP', tipe: 'relasi', relasi: AKUN_POSTING, bawaanAkun: 'akun_hpp', grup: 'Akun' },
      { nama: 'keterangan', label: 'Keterangan', tipe: 'teks_panjang', maks: 1000 },
      aktif,
    ],
    daftar: ['kode', 'nama', 'kategori_id', 'satuan_id', 'harga_beli', 'harga_jual', 'stok_minimum', 'aktif'],
    referensi: [],
  },
  kategori: {
    tabel: 'kategori_barang', judul: 'Kategori Barang', judulTunggal: 'kategori',
    field: [
      kode(),
      { nama: 'nama', label: 'Nama kategori', tipe: 'teks', wajib: true, maks: 100 },
      { nama: 'induk_id', label: 'Induk kategori', tipe: 'relasi', relasi: { tabel: 'kategori_barang', label: "kode || ' · ' || nama", syarat: 'aktif' }, bukanDiriSendiri: true },
      aktif,
    ],
    daftar: ['kode', 'nama', 'induk_id', 'aktif'],
    referensi: [['barang', 'kategori_id', 'barang'], ['kategori_barang', 'induk_id', 'sub kategori']],
  },
  satuan: {
    tabel: 'satuan', judul: 'Satuan', judulTunggal: 'satuan',
    field: [kode(), { nama: 'nama', label: 'Nama satuan', tipe: 'teks', wajib: true, maks: 60 }, aktif],
    daftar: ['kode', 'nama', 'aktif'],
    referensi: [['barang', 'satuan_id', 'barang']],
  },
  gudang: {
    tabel: 'gudang', judul: 'Gudang', judulTunggal: 'gudang',
    field: [
      kode(),
      { nama: 'nama', label: 'Nama gudang', tipe: 'teks', wajib: true, maks: 100 },
      { nama: 'alamat', label: 'Alamat', tipe: 'teks_panjang', maks: 500 },
      aktif,
    ],
    daftar: ['kode', 'nama', 'alamat', 'aktif'],
    referensi: [],
  },
  pelanggan: {
    tabel: 'pelanggan', judul: 'Pelanggan', judulTunggal: 'pelanggan', prefiksKode: 'PLG',
    field: [
      kode(30),
      { nama: 'nama', label: 'Nama pelanggan', tipe: 'teks', wajib: true, maks: 150 },
      { nama: 'alamat', label: 'Alamat', tipe: 'teks_panjang', maks: 500 },
      { nama: 'telepon', label: 'Telepon', tipe: 'teks', maks: 30, inputmode: 'tel' },
      { nama: 'email', label: 'Email', tipe: 'teks', maks: 150, email: true },
      { nama: 'npwp', label: 'NPWP', tipe: 'teks', maks: 30 },
      { nama: 'termin_hari', label: 'Termin (hari)', tipe: 'bilangan', bawaan: '0', bantuan: '0 = tunai.' },
      { nama: 'batas_kredit', label: 'Batas kredit', tipe: 'uang', bawaan: '0', bantuan: '0 = tanpa batas.' },
      { nama: 'akun_piutang_id', label: 'Akun piutang', tipe: 'relasi', relasi: AKUN_POSTING, bawaanAkun: 'akun_piutang', grup: 'Akun' },
      aktif,
    ],
    daftar: ['kode', 'nama', 'telepon', 'termin_hari', 'batas_kredit', 'aktif'],
    referensi: [],
  },
  pemasok: {
    tabel: 'pemasok', judul: 'Pemasok', judulTunggal: 'pemasok', prefiksKode: 'PMS',
    field: [
      kode(30),
      { nama: 'nama', label: 'Nama pemasok', tipe: 'teks', wajib: true, maks: 150 },
      { nama: 'alamat', label: 'Alamat', tipe: 'teks_panjang', maks: 500 },
      { nama: 'telepon', label: 'Telepon', tipe: 'teks', maks: 30, inputmode: 'tel' },
      { nama: 'email', label: 'Email', tipe: 'teks', maks: 150, email: true },
      { nama: 'npwp', label: 'NPWP', tipe: 'teks', maks: 30 },
      { nama: 'termin_hari', label: 'Termin (hari)', tipe: 'bilangan', bawaan: '0', bantuan: '0 = tunai.' },
      { nama: 'akun_hutang_id', label: 'Akun hutang', tipe: 'relasi', relasi: AKUN_POSTING, bawaanAkun: 'akun_hutang', grup: 'Akun' },
      aktif,
    ],
    daftar: ['kode', 'nama', 'telepon', 'termin_hari', 'aktif'],
    referensi: [],
  },
  akun: {
    tabel: 'akun', judul: 'Bagan Akun (COA)', judulTunggal: 'akun', urut: 'kode',
    field: [
      { ...kode(), bantuan: 'Contoh: 1-1100' },
      { nama: 'nama', label: 'Nama akun', tipe: 'teks', wajib: true, maks: 120 },
      { nama: 'jenis', label: 'Jenis', tipe: 'pilihan', wajib: true, opsi: JENIS_AKUN },
      { nama: 'saldo_normal', label: 'Saldo normal', tipe: 'pilihan', wajib: true, opsi: [['D', 'Debit'], ['K', 'Kredit']] },
      { nama: 'induk_id', label: 'Akun induk', tipe: 'relasi', relasi: { tabel: 'akun', label: "kode || ' · ' || nama", syarat: 'akun_header' }, bukanDiriSendiri: true },
      { nama: 'akun_header', label: 'Akun header', tipe: 'boolean', bawaan: false, bantuan: 'Akun header hanya untuk pengelompokan, tidak bisa dipakai di transaksi.' },
      aktif,
    ],
    daftar: ['kode', 'nama', 'jenis', 'saldo_normal', 'akun_header', 'aktif'],
    referensi: [
      ['akun', 'induk_id', 'sub akun'],
      ['barang', 'akun_persediaan_id', 'barang'], ['barang', 'akun_pendapatan_id', 'barang'], ['barang', 'akun_hpp_id', 'barang'],
      ['pelanggan', 'akun_piutang_id', 'pelanggan'], ['pemasok', 'akun_hutang_id', 'pemasok'],
    ],
  },
};

// Urutan tampil di menu & navigasi tab
const URUTAN = ['barang', 'kategori', 'satuan', 'gudang', 'pelanggan', 'pemasok', 'akun'];

function ambilDefinisi(nama) {
  return Object.prototype.hasOwnProperty.call(DEFINISI, nama) ? DEFINISI[nama] : null;
}

module.exports = { DEFINISI, URUTAN, ambilDefinisi };
