// Parsing & format angka desimal sebagai STRING — tidak pernah lewat float JavaScript.

/**
 * Mengubah masukan pengguna menjadi string desimal kanonik ("1500000.50").
 * Menerima format Indonesia ("1.500.000,50") maupun titik desimal ("1500000.50").
 * Mengembalikan null bila tidak valid.
 */
function parseDesimal(masukan, desimal) {
  if (masukan === undefined || masukan === null) return null;
  let s = String(masukan).trim().replace(/\s|Rp/gi, '');
  if (s === '') return null;
  if (s.includes(',')) {
    // Format Indonesia: titik = ribuan, koma = desimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.500.000" → titik sebagai pemisah ribuan
    s = s.replace(/\./g, '');
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const [, tanda, bulat, pecahan = ''] = m;
  if (pecahan.length > desimal) return null;
  const b = bulat.replace(/^0+(?=\d)/, '');
  return `${tanda}${b}${desimal ? '.' + pecahan.padEnd(desimal, '0') : ''}`;
}

/** Format string desimal ke gaya Indonesia: "1500000.50" → "1.500.000,50". */
function formatDesimal(nilai, desimal = 2) {
  if (nilai === null || nilai === undefined || nilai === '') return '';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(nilai));
  if (!m) return String(nilai);
  const [, tanda, bulat, pecahan = ''] = m;
  const ribuan = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const p = pecahan.padEnd(desimal, '0').slice(0, desimal);
  return `${tanda}${ribuan}${desimal ? ',' + p : ''}`;
}

/** Kuantitas: tampilkan tanpa nol berlebih ("12.5000" → "12,5"). */
function formatKuantitas(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return '';
  const s = formatDesimal(nilai, 4);
  return s.includes(',') ? s.replace(/,?0+$/, '') : s;
}

module.exports = { parseDesimal, formatDesimal, formatKuantitas };
