// Pembuat CSV sederhana tanpa library. Pemisah ";" agar langsung terbaca Excel berbahasa Indonesia.

function sel(nilai) {
  if (nilai === null || nilai === undefined) return '';
  let s = String(nilai);
  // Cegah injeksi formula saat dibuka di Excel
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** kolom: [{ judul, ambil: (baris) => nilai }] */
function buatCsv(kolom, baris) {
  const kepala = kolom.map((k) => sel(k.judul)).join(';');
  const isi = baris.map((b) => kolom.map((k) => sel(k.ambil(b))).join(';'));
  // BOM agar Excel membaca UTF-8 dengan benar
  return '﻿' + [kepala, ...isi].join('\r\n') + '\r\n';
}

module.exports = { buatCsv };
