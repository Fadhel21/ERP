// Angka ringkasan untuk dashboard beranda. Semua nilai uang/qty tetap string desimal.
const db = require('../../../config/db');
const { punyaAkses } = require('../../../lib/akses');

const LABEL_TABEL = {
  barang: 'Barang', kategori_barang: 'Kategori', satuan: 'Satuan', gudang: 'Gudang', pelanggan: 'Pelanggan', pemasok: 'Pemasok', akun: 'Akun',
  penyesuaian_stok: 'Penyesuaian stok', transfer_gudang: 'Mutasi gudang', stok_opname: 'Stok opname',
  pesanan_pembelian: 'PO', penerimaan_barang: 'Penerimaan barang', faktur_pembelian: 'Faktur pembelian',
  uang_muka_pembelian: 'Uang muka', pembayaran_hutang: 'Pembayaran hutang', retur_pembelian: 'Retur pembelian',
};
const LABEL_AKSI = { tambah: 'membuat', ubah: 'mengubah', hapus: 'menghapus', posting: 'memposting', batal: 'membatalkan' };

async function ringkasan(pengguna) {
  const boleh = (m) => punyaAkses(pengguna.hakAkses, m, 'lihat');
  const hasil = { persediaan: null, pembelian: null, aktivitas: [] };

  if (boleh('persediaan')) {
    const { rows: [n] } = await db.query(`SELECT coalesce(sum(nilai), 0) AS nilai, count(*) FILTER (WHERE qty > 0) AS jenis FROM saldo_barang`);
    const { rows: kurang } = await db.query(
      `SELECT b.id, b.kode, b.nama, s.kode AS satuan, coalesce(sb.qty, 0) AS qty, b.stok_minimum
       FROM barang b JOIN satuan s ON s.id = b.satuan_id LEFT JOIN saldo_barang sb ON sb.barang_id = b.id
       WHERE b.deleted_at IS NULL AND b.aktif AND b.jenis = 'stok' AND b.stok_minimum > 0 AND coalesce(sb.qty, 0) < b.stok_minimum
       ORDER BY coalesce(sb.qty, 0) / b.stok_minimum, b.kode LIMIT 50`);
    hasil.persediaan = { nilai: n.nilai, jenisAda: n.jenis, kurang: kurang.slice(0, 5), jumlahKurang: kurang.length };
  }

  if (boleh('pembelian')) {
    const { rows: [h] } = await db.query(
      `SELECT coalesce(sum(total - dibayar - diretur), 0) AS hutang,
              count(*) FILTER (WHERE jatuh_tempo < current_date) AS lewat,
              coalesce(sum(total - dibayar - diretur) FILTER (WHERE jatuh_tempo < current_date), 0) AS nilai_lewat,
              count(*) FILTER (WHERE jatuh_tempo BETWEEN current_date AND current_date + 7) AS segera
       FROM faktur_pembelian WHERE status = 'diposting' AND deleted_at IS NULL AND total - dibayar - diretur > 0`);
    const { rows: [po] } = await db.query(
      `SELECT count(*) AS n FROM pesanan_pembelian WHERE status = 'diposting' AND status_terima <> 'selesai' AND deleted_at IS NULL`);
    const { rows: jatuhTempo } = await db.query(
      `SELECT f.id, f.nomor, f.jatuh_tempo, ps.nama AS pemasok_nama, f.total - f.dibayar - f.diretur AS sisa, f.jatuh_tempo < current_date AS lewat
       FROM faktur_pembelian f JOIN pemasok ps ON ps.id = f.pemasok_id
       WHERE f.status = 'diposting' AND f.deleted_at IS NULL AND f.total - f.dibayar - f.diretur > 0
       ORDER BY f.jatuh_tempo, f.id LIMIT 5`);
    // Pembelian (faktur diposting) 6 bulan terakhir, termasuk bulan kosong
    const { rows: bulanan } = await db.query(
      `SELECT to_char(b.bulan, 'YYYY-MM') AS bulan, coalesce(sum(f.total), 0) AS total
       FROM generate_series(date_trunc('month', current_date) - interval '5 month', date_trunc('month', current_date), interval '1 month') AS b(bulan)
       LEFT JOIN faktur_pembelian f ON date_trunc('month', f.tanggal) = b.bulan AND f.status = 'diposting' AND f.deleted_at IS NULL
       GROUP BY b.bulan ORDER BY b.bulan`);
    hasil.pembelian = { ...h, poTerbuka: po.n, jatuhTempo, bulanan };
  }

  const { rows: aktivitas } = await db.query(
    `SELECT a.tabel, a.aksi, a.created_at, p.nama AS pengguna_nama,
            coalesce(a.sesudah->>'nomor', a.sebelum->>'nomor', a.sesudah->>'kode', a.sebelum->>'kode') AS rujukan
     FROM jejak_audit a LEFT JOIN pengguna p ON p.id = a.pengguna_id
     ORDER BY a.id DESC LIMIT 8`);
  hasil.aktivitas = aktivitas.map((a) => ({
    ...a, tabelLabel: LABEL_TABEL[a.tabel] || a.tabel, aksiLabel: LABEL_AKSI[a.aksi] || a.aksi,
  }));
  return hasil;
}

module.exports = { ringkasan };
