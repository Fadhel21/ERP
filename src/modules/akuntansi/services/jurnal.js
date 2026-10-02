// Mesin jurnal: membuat jurnal berpasangan & jurnal pembalik. Selalu dipanggil di dalam transaksi.
const { GalatBisnis } = require('../../../lib/galat');
const { keSen, dariSen } = require('../../../lib/uang');
const { nomorBerikutnya } = require('../../pengaturan/services/nomor');
const { pastikanPeriodeTerbuka } = require('../../pengaturan/services/periode');

/**
 * Menggabungkan baris dengan akun & sisi yang sama, membuang baris bernilai nol.
 * baris: [{ akun_id, debit?, kredit?, keterangan? }] — nilai berupa string desimal.
 */
function rapikanBaris(baris) {
  const peta = new Map();
  for (const b of baris) {
    const d = keSen(b.debit || '0');
    const k = keSen(b.kredit || '0');
    if (d < 0n || k < 0n) throw new GalatBisnis('Nilai debit/kredit tidak boleh negatif.');
    const bersih = d - k; // satu baris bisa saja diberi debit & kredit → ambil netonya
    if (bersih === 0n) continue;
    const sisi = bersih > 0n ? 'D' : 'K';
    const kunci = JSON.stringify([String(b.akun_id), sisi, b.keterangan || '']);
    peta.set(kunci, (peta.get(kunci) || 0n) + (bersih > 0n ? bersih : -bersih));
  }
  return [...peta.entries()].map(([kunci, sen]) => {
    const [akun_id, sisi, keterangan] = JSON.parse(kunci);
    return { akun_id, debit: sisi === 'D' ? dariSen(sen) : '0.00', kredit: sisi === 'K' ? dariSen(sen) : '0.00', keterangan: keterangan || null };
  });
}

/** Memeriksa keseimbangan (murni). Mengembalikan { totalDebit, totalKredit }. */
function periksaSeimbang(baris) {
  const d = baris.reduce((t, b) => t + keSen(b.debit), 0n);
  const k = baris.reduce((t, b) => t + keSen(b.kredit), 0n);
  if (baris.length < 2) throw new GalatBisnis('Jurnal harus memiliki minimal 2 baris.');
  if (d !== k) throw new GalatBisnis(`Jurnal tidak seimbang: debit ${dariSen(d)} ≠ kredit ${dariSen(k)}.`);
  if (d === 0n) throw new GalatBisnis('Jurnal tidak boleh bernilai nol.');
  return { totalDebit: dariSen(d), totalKredit: dariSen(k) };
}

/**
 * Membuat & memposting jurnal. Mengembalikan baris jurnal, atau null bila semua baris bernilai nol
 * (mis. penyesuaian yang nilainya 0 tidak perlu jurnal).
 */
async function buatJurnal(klien, { tanggal, keterangan, sumberJenis, sumberId, nomorSumber, baris, penggunaId, membalikId = null }) {
  await pastikanPeriodeTerbuka(klien, tanggal);
  const rapi = rapikanBaris(baris);
  if (!rapi.length) return null;
  periksaSeimbang(rapi);

  const akunIds = [...new Set(rapi.map((b) => b.akun_id))];
  const { rows: akun } = await klien.query(
    'SELECT id, kode, akun_header, aktif FROM akun WHERE id = ANY($1) AND deleted_at IS NULL', [akunIds]);
  for (const id of akunIds) {
    const a = akun.find((x) => x.id === String(id));
    if (!a) throw new GalatBisnis('Akun jurnal tidak ditemukan. Periksa pengaturan akun.');
    if (a.akun_header) throw new GalatBisnis(`Akun ${a.kode} adalah akun header dan tidak bisa dipakai di jurnal.`);
  }

  const nomor = await nomorBerikutnya(klien, 'JU', tanggal);
  const { rows } = await klien.query(
    `INSERT INTO jurnal (nomor, tanggal, keterangan, sumber_jenis, sumber_id, nomor_sumber, membalik_id, dibuat_oleh)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [nomor, tanggal, keterangan, sumberJenis, sumberId || null, nomorSumber || null, membalikId, penggunaId || null]);
  for (const b of rapi) {
    await klien.query(
      'INSERT INTO jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan) VALUES ($1, $2, $3, $4, $5)',
      [rows[0].id, b.akun_id, b.debit, b.kredit, b.keterangan]);
  }
  return rows[0];
}

/** Membuat jurnal pembalik (debit ↔ kredit) untuk jurnal yang sudah ada. */
async function balikJurnal(klien, jurnalId, { tanggal, keterangan, penggunaId }) {
  const { rows: [asal] } = await klien.query('SELECT * FROM jurnal WHERE id = $1', [jurnalId]);
  if (!asal) throw new GalatBisnis('Jurnal asal tidak ditemukan.');
  const sudah = await klien.query('SELECT nomor FROM jurnal WHERE membalik_id = $1', [jurnalId]);
  if (sudah.rows.length) throw new GalatBisnis(`Jurnal ${asal.nomor} sudah dibalik oleh ${sudah.rows[0].nomor}.`);
  const { rows: det } = await klien.query('SELECT akun_id, debit, kredit, keterangan FROM jurnal_detail WHERE jurnal_id = $1', [jurnalId]);
  return buatJurnal(klien, {
    tanggal, keterangan: keterangan || `Pembalik ${asal.nomor}: ${asal.keterangan}`,
    sumberJenis: asal.sumber_jenis, sumberId: asal.sumber_id, nomorSumber: asal.nomor_sumber,
    baris: det.map((d) => ({ akun_id: d.akun_id, debit: d.kredit, kredit: d.debit, keterangan: d.keterangan })),
    penggunaId, membalikId: asal.id,
  });
}

/** Membaca id akun dari pengaturan (nilai = kode akun). */
async function akunDariPengaturan(klien, kunci) {
  const { rows } = await klien.query(
    `SELECT a.id FROM pengaturan p JOIN akun a ON a.kode = p.nilai AND a.deleted_at IS NULL
     WHERE p.kunci = $1 AND p.deleted_at IS NULL`, [kunci]);
  if (!rows.length) throw new GalatBisnis(`Akun untuk pengaturan "${kunci}" belum diatur atau tidak ditemukan.`);
  return rows[0].id;
}

module.exports = { buatJurnal, balikJurnal, rapikanBaris, periksaSeimbang, akunDariPengaturan };
