// Opsi dropdown untuk form persediaan.
const db = require('../../../config/db');

async function gudang() {
  return (await db.query(`SELECT id, kode, nama FROM gudang WHERE aktif AND deleted_at IS NULL ORDER BY kode`)).rows;
}

/** Barang stok aktif + HPP terakhir (bawaan harga penyesuaian masuk). */
async function barangStok() {
  return (await db.query(
    `SELECT b.id, b.kode, b.nama, s.kode AS satuan,
            coalesce(nullif(sb.hpp_terakhir, 0), b.harga_beli) AS harga
     FROM barang b JOIN satuan s ON s.id = b.satuan_id LEFT JOIN saldo_barang sb ON sb.barang_id = b.id
     WHERE b.aktif AND b.deleted_at IS NULL AND b.jenis = 'stok' ORDER BY b.kode`)).rows;
}

async function akunPosting() {
  return (await db.query(
    `SELECT id, kode, nama FROM akun WHERE aktif AND NOT akun_header AND deleted_at IS NULL ORDER BY kode`)).rows;
}

async function kategori() {
  return (await db.query(`SELECT id, kode, nama FROM kategori_barang WHERE aktif AND deleted_at IS NULL ORDER BY kode`)).rows;
}

module.exports = { gudang, barangStok, akunPosting, kategori };
