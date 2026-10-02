// Validasi & pembersihan masukan form master (murni, tanpa database).
const { parseDesimal } = require('../../../lib/angka');

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Mengembalikan { data, galat } — data berisi nilai siap simpan (angka sebagai string desimal),
 * galat berisi { namaField: pesan }.
 */
function bersihkan(def, masukan) {
  const data = {};
  const galat = {};

  for (const f of def.field) {
    const mentah = masukan[f.nama];
    const teks = typeof mentah === 'string' ? mentah.trim() : mentah;
    const kosong = teks === undefined || teks === null || teks === '';

    switch (f.tipe) {
      case 'boolean':
        // Checkbox: hanya terkirim bila dicentang
        data[f.nama] = teks === 'on' || teks === 'true' || teks === '1' || teks === true;
        continue;
      case 'uang':
      case 'kuantitas': {
        if (kosong) { data[f.nama] = f.bawaan ?? null; break; }
        const nilai = parseDesimal(teks, f.tipe === 'uang' ? 2 : 4);
        if (nilai === null) {
          galat[f.nama] = f.tipe === 'uang'
            ? 'Angka tidak valid (maksimal 2 desimal, gunakan koma untuk desimal).'
            : 'Angka tidak valid (maksimal 4 desimal, gunakan koma untuk desimal).';
        } else if (nilai.startsWith('-')) {
          galat[f.nama] = 'Tidak boleh negatif.';
        } else if (nilai.split('.')[0].length > (f.tipe === 'uang' ? 13 : 11)) {
          galat[f.nama] = 'Angka terlalu besar.';
        } else data[f.nama] = nilai;
        break;
      }
      case 'bilangan': {
        if (kosong) { data[f.nama] = f.bawaan ?? null; break; }
        if (!/^\d{1,6}$/.test(String(teks))) galat[f.nama] = 'Isi dengan bilangan bulat 0 atau lebih.';
        else data[f.nama] = String(Number(teks));
        break;
      }
      case 'relasi': {
        if (kosong) { data[f.nama] = null; break; }
        if (!/^\d{1,18}$/.test(String(teks))) galat[f.nama] = 'Pilihan tidak valid.';
        else data[f.nama] = String(teks);
        break;
      }
      case 'pilihan': {
        if (kosong) { data[f.nama] = null; break; }
        if (!f.opsi.some(([v]) => v === teks)) galat[f.nama] = 'Pilihan tidak valid.';
        else data[f.nama] = teks;
        break;
      }
      default: { // teks, teks_panjang
        data[f.nama] = kosong ? null : String(teks);
        if (!kosong && f.maks && String(teks).length > f.maks) galat[f.nama] = `Maksimal ${f.maks} karakter.`;
        else if (!kosong && f.email && !POLA_EMAIL.test(teks)) galat[f.nama] = 'Format email tidak valid.';
      }
    }
    if (f.wajib && (data[f.nama] === null || data[f.nama] === undefined) && !galat[f.nama]) {
      galat[f.nama] = `${f.label} wajib diisi.`;
    }
  }
  if (data.kode) data.kode = data.kode.toUpperCase();
  return { data, galat };
}

module.exports = { bersihkan };
