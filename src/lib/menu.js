// Struktur menu sidebar. "tersedia: false" = fitur belum dibangun (tampil dengan label "Segera").
// Ubah "tersedia" menjadi true saat fitur selesai dipindahkan.
const MENU = [
  { kode: 'beranda', label: 'Beranda', ikon: 'beranda', href: '/', tersedia: true },
  {
    kode: 'master', label: 'Master Data', ikon: 'master',
    anak: [
      { label: 'Barang', href: '/master/barang', tersedia: true },
      { label: 'Kategori Barang', href: '/master/kategori', tersedia: true },
      { label: 'Satuan', href: '/master/satuan', tersedia: true },
      { label: 'Gudang', href: '/master/gudang', tersedia: true },
      { label: 'Pelanggan', href: '/master/pelanggan', tersedia: true },
      { label: 'Pemasok', href: '/master/pemasok', tersedia: true },
      { label: 'Bagan Akun (COA)', href: '/master/akun', tersedia: true },
    ],
  },
  {
    kode: 'persediaan', label: 'Persediaan', ikon: 'persediaan',
    anak: [
      { label: 'Kartu Stok', href: '/persediaan/kartu-stok', tersedia: true },
      { label: 'Mutasi Antar Gudang', href: '/persediaan/mutasi', tersedia: true },
      { label: 'Penyesuaian Stok', href: '/persediaan/penyesuaian', tersedia: true },
      { label: 'Stok Opname', href: '/persediaan/opname', tersedia: true },
    ],
  },
  {
    kode: 'pembelian', label: 'Pembelian', ikon: 'pembelian',
    anak: [
      { label: 'Pesanan Pembelian (PO)', href: '/pembelian/pesanan' },
      { label: 'Penerimaan Barang', href: '/pembelian/penerimaan' },
      { label: 'Faktur Pembelian', href: '/pembelian/faktur' },
      { label: 'Pembayaran Hutang', href: '/pembelian/pembayaran' },
    ],
  },
  {
    kode: 'penjualan', label: 'Penjualan', ikon: 'penjualan',
    anak: [
      { label: 'Penawaran', href: '/penjualan/penawaran' },
      { label: 'Pesanan Penjualan (SO)', href: '/penjualan/pesanan' },
      { label: 'Surat Jalan', href: '/penjualan/surat-jalan' },
      { label: 'Faktur Penjualan', href: '/penjualan/faktur' },
      { label: 'Penerimaan Piutang', href: '/penjualan/penerimaan' },
    ],
  },
  {
    kode: 'akuntansi', label: 'Akuntansi', ikon: 'akuntansi',
    anak: [
      { label: 'Jurnal Umum', href: '/akuntansi/jurnal' },
      { label: 'Buku Besar', href: '/akuntansi/buku-besar' },
      { label: 'Kas & Bank', href: '/akuntansi/kas-bank' },
      { label: 'Tutup Periode', href: '/akuntansi/periode' },
    ],
  },
  {
    kode: 'laporan', label: 'Laporan', ikon: 'laporan',
    anak: [
      { label: 'Neraca', href: '/laporan/neraca' },
      { label: 'Laba Rugi', href: '/laporan/laba-rugi' },
      { label: 'Neraca Saldo', href: '/laporan/neraca-saldo' },
      { label: 'Umur Piutang', href: '/laporan/umur-piutang' },
      { label: 'Umur Hutang', href: '/laporan/umur-hutang' },
      { label: 'Laporan Stok', href: '/laporan/stok' },
      { label: 'Laporan Penjualan', href: '/laporan/penjualan' },
      { label: 'Laporan Pembelian', href: '/laporan/pembelian' },
    ],
  },
  {
    kode: 'pengaturan', label: 'Pengaturan', ikon: 'pengaturan',
    anak: [
      { label: 'Pengguna', href: '/pengaturan/pengguna' },
      { label: 'Peran & Hak Akses', href: '/pengaturan/peran' },
      { label: 'Perusahaan & Pajak', href: '/pengaturan/umum' },
    ],
  },
];

/** Menu yang boleh dilihat pengguna, ditandai aktif berdasarkan path. */
function menuUntuk(boleh, path) {
  return MENU
    .filter((m) => m.kode === 'beranda' || boleh(m.kode, 'lihat'))
    .map((m) => {
      const anak = (m.anak || []).map((a) => ({
        ...a,
        tersedia: !!a.tersedia,
        aktif: path === a.href || path.startsWith(a.href + '/'),
      }));
      const aktif = m.href ? path === m.href : anak.some((a) => a.aktif);
      return { ...m, anak, aktif };
    });
}

module.exports = { MENU, menuUntuk };
