// Perhitungan baris dokumen: bruto, diskon %, DPP, PPN — dengan BigInt (tanpa float).
// Aturan (disetujui): harga belum termasuk PPN; diskon % per baris; diskon & PPN dibulatkan
// half-up per baris ke `desimal` angka di belakang koma (pengaturan pembulatan_desimal, bawaan 0 = rupiah penuh).
const { keSen, dariSen } = require('./uang');

/** "12.5" → 12.5 × 10^skala sebagai BigInt. Melempar error bila format tidak valid. */
function keSkala(nilai, skala) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(nilai ?? '0').trim());
  if (!m || (m[2] && m[2].length > skala)) throw new Error(`Angka tidak valid: ${nilai}`);
  return BigInt(m[1] + (m[2] || '').padEnd(skala, '0'));
}

/** Pembagian bilangan tak-negatif dengan pembulatan half-up. */
function bagiBulat(pembilang, penyebut) {
  return (pembilang * 2n + penyebut) / (penyebut * 2n);
}

/**
 * opsi: { qty (≤4 desimal), harga (≤2 desimal), diskonPersen (≤2 desimal), kenaPpn, tarifPpn (persen, ≤2 desimal), desimal (0–2) }
 * Mengembalikan string desimal 2 angka: { bruto, diskon, dpp, ppn, total }.
 */
function hitungBaris({ qty, harga, diskonPersen = '0', kenaPpn = true, tarifPpn = '0', desimal = 0 }) {
  const q = keSkala(qty, 4);                    // qty × 10^4
  const h = keSen(harga);                       // harga dalam sen
  if (h < 0n) throw new Error('Harga tidak boleh negatif');
  const d = keSkala(diskonPersen, 2);           // persen × 100
  if (d > 10000n) throw new Error('Diskon maksimal 100%');
  const t = keSkala(tarifPpn, 2);               // persen × 100
  const unit = 10n ** BigInt(2 - Number(desimal)); // satuan pembulatan dalam sen (0 desimal → 100 sen)

  const bruto = bagiBulat(q * h, 10000n);                         // sen, dibulatkan ke sen
  const diskon = bagiBulat(bruto * d, 10000n * unit) * unit;      // bruto × d% → dibulatkan ke unit
  const dpp = bruto - diskon;
  const ppn = kenaPpn ? bagiBulat(dpp * t, 10000n * unit) * unit : 0n;
  return { bruto: dariSen(bruto), diskon: dariSen(diskon), dpp: dariSen(dpp), ppn: dariSen(ppn), total: dariSen(dpp + ppn) };
}

/** Menjumlahkan hasil beberapa baris. */
function jumlahkanBaris(daftar) {
  const total = { bruto: 0n, diskon: 0n, dpp: 0n, ppn: 0n, total: 0n };
  for (const b of daftar) for (const k of Object.keys(total)) total[k] += keSen(b[k]);
  return Object.fromEntries(Object.entries(total).map(([k, v]) => [k, dariSen(v)]));
}

module.exports = { hitungBaris, jumlahkanBaris };
