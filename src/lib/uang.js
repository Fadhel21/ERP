// Aritmetika uang dalam satuan sen (BigInt) — tanpa float. Masukan/keluaran berupa string desimal.

/** "1500.5" → 150050n. Melempar error bila format tidak valid atau lebih dari 2 desimal. */
function keSen(nilai) {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(nilai ?? '0').trim());
  if (!m) throw new Error(`Nilai uang tidak valid: ${nilai}`);
  const sen = BigInt(m[2]) * 100n + BigInt((m[3] || '').padEnd(2, '0') || '0');
  return m[1] ? -sen : sen;
}

/** 150050n → "1500.50" */
function dariSen(sen) {
  const negatif = sen < 0n;
  const a = negatif ? -sen : sen;
  return `${negatif ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

function jumlah(daftar) {
  return dariSen(daftar.reduce((t, v) => t + keSen(v), 0n));
}

module.exports = { keSen, dariSen, jumlah };
