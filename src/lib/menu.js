// Struktur menu sidebar. "tersedia: false" = fitur belum dibangun (tampil dengan label "Segera").
// Ubah "tersedia" menjadi true saat fitur selesai dipindahkan.
const MENU = [
  { kode: 'beranda', label: 'Beranda', ikon: 'beranda', href: '/', tersedia: true },
  {
    kode: 'master', label: 'Master Data', ikon: 'master', seksi: 'Operasional',
    anak: [
      { label: 'Barang', ikon: 'barang', href: '/master/barang', tersedia: true },
      { label: 'Kategori Barang', ikon: 'kategori', href: '/master/kategori', tersedia: true },
      { label: 'Satuan', ikon: 'satuan', href: '/master/satuan', tersedia: true },
      { label: 'Gudang', ikon: 'gudang', href: '/master/gudang', tersedia: true },
      { label: 'Pelanggan', ikon: 'pelanggan', href: '/master/pelanggan', tersedia: true },
      { label: 'Pemasok', ikon: 'pemasok', href: '/master/pemasok', tersedia: true },
      { label: 'Bagan Akun (COA)', ikon: 'coa', href: '/master/akun', tersedia: true },
    ],
  },
  {
    kode: 'persediaan', label: 'Persediaan', ikon: 'persediaan', seksi: 'Operasional',
    anak: [
      { label: 'Kartu Stok', ikon: 'kartu-stok', href: '/persediaan/kartu-stok', tersedia: true },
      { label: 'Mutasi Antar Gudang', ikon: 'mutasi', href: '/persediaan/mutasi', tersedia: true },
      { label: 'Penyesuaian Stok', ikon: 'penyesuaian', href: '/persediaan/penyesuaian', tersedia: true },
      { label: 'Stok Opname', ikon: 'opname', href: '/persediaan/opname', tersedia: true },
    ],
  },
  {
    kode: 'pembelian', label: 'Pembelian', ikon: 'pembelian', seksi: 'Operasional',
    anak: [
      { label: 'Pesanan Pembelian (PO)', ikon: 'dokumen', href: '/pembelian/pesanan', tersedia: true },
      { label: 'Penerimaan Barang', ikon: 'terima', href: '/pembelian/penerimaan', tersedia: true },
      { label: 'Faktur Pembelian', ikon: 'faktur', href: '/pembelian/faktur', tersedia: true },
      { label: 'Uang Muka Pemasok', ikon: 'dompet', href: '/pembelian/uang-muka', tersedia: true },
      { label: 'Pembayaran Hutang', ikon: 'bayar', href: '/pembelian/pembayaran', tersedia: true },
      { label: 'Retur Pembelian', ikon: 'retur', href: '/pembelian/retur', tersedia: true },
    ],
  },
  {
    kode: 'penjualan', label: 'Penjualan', ikon: 'penjualan', seksi: 'Operasional',
    anak: [
      { label: 'Penawaran', ikon: 'penawaran', href: '/penjualan/penawaran' },
      { label: 'Pesanan Penjualan (SO)', ikon: 'pesanan', href: '/penjualan/pesanan' },
      { label: 'Surat Jalan', ikon: 'pemasok', href: '/penjualan/surat-jalan' },
      { label: 'Faktur Penjualan', ikon: 'faktur', href: '/penjualan/faktur' },
      { label: 'Penerimaan Piutang', ikon: 'piutang', href: '/penjualan/penerimaan' },
    ],
  },
  {
    kode: 'akuntansi', label: 'Akuntansi', ikon: 'akuntansi', seksi: 'Keuangan',
    anak: [
      { label: 'Jurnal Umum', ikon: 'jurnal', href: '/akuntansi/jurnal' },
      { label: 'Buku Besar', ikon: 'buku-besar', href: '/akuntansi/buku-besar' },
      { label: 'Kas & Bank', ikon: 'bank', href: '/akuntansi/kas-bank' },
      { label: 'Tutup Periode', ikon: 'periode', href: '/akuntansi/periode' },
    ],
  },
  {
    kode: 'laporan', label: 'Laporan', ikon: 'laporan', seksi: 'Keuangan',
    anak: [
      { label: 'Neraca', ikon: 'neraca', href: '/laporan/neraca' },
      { label: 'Laba Rugi', ikon: 'laba-rugi', href: '/laporan/laba-rugi' },
      { label: 'Neraca Saldo', ikon: 'neraca-saldo', href: '/laporan/neraca-saldo' },
      { label: 'Umur Piutang', ikon: 'umur', href: '/laporan/umur-piutang' },
      { label: 'Umur Hutang', ikon: 'umur', href: '/laporan/umur-hutang' },
      { label: 'Laporan Stok', ikon: 'lapisan', href: '/laporan/stok' },
      { label: 'Laporan Penjualan', ikon: 'grafik', href: '/laporan/penjualan' },
      { label: 'Laporan Pembelian', ikon: 'pembelian', href: '/laporan/pembelian' },
    ],
  },
  {
    kode: 'pengaturan', label: 'Pengaturan', ikon: 'pengaturan', seksi: 'Sistem',
    anak: [
      { label: 'Pengguna', ikon: 'pengguna', href: '/pengaturan/pengguna' },
      { label: 'Peran & Hak Akses', ikon: 'perisai', href: '/pengaturan/peran' },
      { label: 'Perusahaan & Pajak', ikon: 'gedung', href: '/pengaturan/umum' },
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

/** Breadcrumb: [{ label, href }] — modul › halaman (dokumen ditambahkan oleh view bila ada). */
function jejak(path) {
  if (path === '/') return [];
  for (const m of MENU) {
    for (const a of m.anak || []) {
      if (path === a.href || path.startsWith(a.href + '/')) {
        return [{ label: m.label, href: (m.anak.find((x) => x.tersedia) || a).href }, { label: a.label, href: a.href, ikon: a.ikon }];
      }
    }
  }
  return [];
}

module.exports = { MENU, menuUntuk, jejak };
