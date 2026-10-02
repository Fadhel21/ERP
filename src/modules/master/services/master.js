// Service generik master data. Semua SQL master ada di sini.
// Identifier (tabel/kolom) hanya dari definisi.js; nilai dari pengguna selalu lewat parameter $n.
const db = require('../../../config/db');
const { pastikanAkses } = require('../../../lib/akses');
const { GalatBisnis } = require('../../../lib/galat');
const { catatAudit } = require('../../pengaturan/services/audit');
const { bersihkan } = require('./validasi');

const PER_HALAMAN = 25;

class GalatValidasi extends GalatBisnis {
  constructor(galat) {
    super('Periksa kembali isian yang ditandai.', 422);
    this.galat = galat;
  }
}

function polaCari(q) {
  return `%${String(q).toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

/** Kolom label relasi untuk daftar: (SELECT label FROM tabel WHERE id = t.kolom) AS kolom__label */
function kolomLabelRelasi(def) {
  return def.field
    .filter((f) => f.tipe === 'relasi' && def.daftar.includes(f.nama))
    .map((f) => `(SELECT ${f.relasi.label} FROM ${f.relasi.tabel} r WHERE r.id = t.${f.nama}) AS ${f.nama}__label`);
}

async function daftar(pengguna, def, { q = '', hal = 1, semua = false } = {}) {
  pastikanAkses(pengguna, 'master', 'lihat');
  const syarat = ['t.deleted_at IS NULL'];
  const param = [];
  if (!semua) syarat.push('t.aktif');
  if (q) {
    param.push(polaCari(q));
    syarat.push(`(lower(t.kode) LIKE $${param.length} OR lower(t.nama) LIKE $${param.length})`);
  }
  const where = syarat.join(' AND ');
  const total = Number((await db.query(`SELECT count(*) FROM ${def.tabel} t WHERE ${where}`, param)).rows[0].count);
  const jumlahHal = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const halaman = Math.min(Math.max(1, Number(hal) || 1), jumlahHal);
  const ekstra = kolomLabelRelasi(def);
  const { rows } = await db.query(
    `SELECT t.*${ekstra.length ? ', ' + ekstra.join(', ') : ''} FROM ${def.tabel} t
     WHERE ${where} ORDER BY t.kode LIMIT ${PER_HALAMAN} OFFSET ${(halaman - 1) * PER_HALAMAN}`, param);
  return { baris: rows, total, hal: halaman, jumlahHal, perHalaman: PER_HALAMAN };
}

/** Semua baris (untuk ekspor CSV), tanpa paging. */
async function semuaUntukEkspor(pengguna, def, { q = '', semua = false } = {}) {
  pastikanAkses(pengguna, 'master', 'lihat');
  const syarat = ['t.deleted_at IS NULL'];
  const param = [];
  if (!semua) syarat.push('t.aktif');
  if (q) {
    param.push(polaCari(q));
    syarat.push(`(lower(t.kode) LIKE $1 OR lower(t.nama) LIKE $1)`);
  }
  const labelSemua = def.field.filter((f) => f.tipe === 'relasi')
    .map((f) => `(SELECT ${f.relasi.label} FROM ${f.relasi.tabel} r WHERE r.id = t.${f.nama}) AS ${f.nama}__label`);
  const { rows } = await db.query(
    `SELECT t.*${labelSemua.length ? ', ' + labelSemua.join(', ') : ''} FROM ${def.tabel} t
     WHERE ${syarat.join(' AND ')} ORDER BY t.kode`, param);
  return rows;
}

async function ambil(pengguna, def, id) {
  pastikanAkses(pengguna, 'master', 'lihat');
  if (!/^\d{1,18}$/.test(String(id))) throw new GalatBisnis('Data tidak ditemukan.', 404);
  const { rows } = await db.query(`SELECT * FROM ${def.tabel} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows.length) throw new GalatBisnis(`Data ${def.judulTunggal} tidak ditemukan.`, 404);
  return rows[0];
}

/** Opsi dropdown untuk setiap field relasi. Nilai yang sedang dipakai tetap muncul walau sudah nonaktif. */
async function opsiRelasi(def, rekaman = {}) {
  const hasil = {};
  for (const f of def.field.filter((x) => x.tipe === 'relasi')) {
    const param = [];
    let tambahan = '';
    if (rekaman[f.nama]) {
      param.push(rekaman[f.nama]);
      tambahan = ` OR id = $1`;
    }
    const { rows } = await db.query(
      `SELECT id, ${f.relasi.label} AS label FROM ${f.relasi.tabel}
       WHERE deleted_at IS NULL AND ((${f.relasi.syarat || 'true'})${tambahan})
       ORDER BY kode`, param);
    hasil[f.nama] = rows.filter((r) => !(f.bukanDiriSendiri && rekaman.id && r.id === String(rekaman.id)));
  }
  return hasil;
}

/** Nilai awal form tambah: bawaan field + kode otomatis + akun bawaan dari pengaturan. */
async function nilaiAwal(def) {
  const awal = {};
  for (const f of def.field) if (f.bawaan !== undefined) awal[f.nama] = f.bawaan;
  if (def.prefiksKode) awal.kode = await kodeBerikutnya(db, def);
  const akunField = def.field.filter((f) => f.bawaanAkun);
  if (akunField.length) {
    const { rows } = await db.query(
      `SELECT p.kunci, a.id FROM pengaturan p JOIN akun a ON a.kode = p.nilai AND a.deleted_at IS NULL
       WHERE p.kunci = ANY($1) AND p.deleted_at IS NULL`, [akunField.map((f) => f.bawaanAkun)]);
    for (const f of akunField) {
      const r = rows.find((x) => x.kunci === f.bawaanAkun);
      if (r) awal[f.nama] = r.id;
    }
  }
  return awal;
}

/** Kode otomatis berikutnya: PREFIKS-00001 (berdasarkan angka terbesar yang sudah ada). */
async function kodeBerikutnya(klien, def) {
  const { rows } = await klien.query(
    `SELECT COALESCE(max(substring(kode FROM '^' || $1 || '-(\\d+)$')::bigint), 0) + 1 AS n
     FROM ${def.tabel} WHERE kode ~ ('^' || $1 || '-\\d+$')`, [def.prefiksKode]);
  return `${def.prefiksKode}-${String(rows[0].n).padStart(5, '0')}`;
}

/** Memastikan id relasi ada & memenuhi syarat (kecuali nilainya tidak berubah dari sebelumnya). */
async function periksaRelasi(klien, def, data, lama, galat) {
  for (const f of def.field.filter((x) => x.tipe === 'relasi')) {
    const nilai = data[f.nama];
    if (!nilai || galat[f.nama]) continue;
    if (f.bukanDiriSendiri && lama && String(lama.id) === nilai) {
      galat[f.nama] = 'Tidak boleh memilih dirinya sendiri.';
      continue;
    }
    if (lama && String(lama[f.nama]) === nilai) continue;
    const { rows } = await klien.query(
      `SELECT 1 FROM ${f.relasi.tabel} WHERE id = $1 AND deleted_at IS NULL AND (${f.relasi.syarat || 'true'})`, [nilai]);
    if (!rows.length) galat[f.nama] = 'Pilihan tidak tersedia atau sudah nonaktif.';
  }
}

async function jumlahRujukan(klien, def, id) {
  const ditemukan = [];
  for (const [tabel, kolom, label] of def.referensi) {
    const { rows } = await klien.query(
      `SELECT count(*) FROM ${tabel} WHERE ${kolom} = $1 AND deleted_at IS NULL`, [id]);
    const n = Number(rows[0].count);
    if (n) ditemukan.push(`${n} ${label}`);
  }
  return ditemukan;
}

/** Aturan khusus bagan akun. */
async function validasiAkun(klien, data, lama, galat) {
  if (!lama) return;
  if (data.akun_header && !lama.akun_header) {
    const dipakai = (await jumlahRujukan(klien, { referensi: require('../definisi').DEFINISI.akun.referensi.slice(1) }, lama.id));
    if (dipakai.length) galat.akun_header = `Tidak bisa dijadikan header: akun dipakai oleh ${dipakai.join(', ')}.`;
  }
  if (!data.akun_header && lama.akun_header) {
    const { rows } = await klien.query('SELECT count(*) FROM akun WHERE induk_id = $1 AND deleted_at IS NULL', [lama.id]);
    if (Number(rows[0].count)) galat.akun_header = 'Tidak bisa dijadikan akun biasa: masih memiliki sub akun.';
  }
}

/** Tambah (id kosong) atau ubah data master. Mengembalikan baris tersimpan. */
async function simpan(pengguna, def, masukan, id = null) {
  pastikanAkses(pengguna, 'master', id ? 'ubah' : 'tambah');
  // Kode otomatis bila dikosongkan pada master yang memakai prefiks
  if (!id && def.prefiksKode && !String(masukan.kode || '').trim()) {
    masukan = { ...masukan, kode: await kodeBerikutnya(db, def) };
  }
  const { data, galat } = bersihkan(def, masukan);

  return db.transaksi(async (klien) => {
    let lama = null;
    if (id) {
      const r = await klien.query(`SELECT * FROM ${def.tabel} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!r.rows.length) throw new GalatBisnis(`Data ${def.judulTunggal} tidak ditemukan.`, 404);
      lama = r.rows[0];
    }
    await periksaRelasi(klien, def, data, lama, galat);
    if (def.tabel === 'akun') await validasiAkun(klien, data, lama, galat);
    if (def.tabel === 'barang' && lama && lama.jenis === 'stok' && data.jenis === 'jasa') {
      const { rows } = await klien.query('SELECT 1 FROM mutasi_stok WHERE barang_id = $1 LIMIT 1', [lama.id]);
      if (rows.length) galat.jenis = 'Barang sudah memiliki mutasi stok sehingga tidak bisa diubah menjadi jasa.';
    }
    if (!galat.kode && data.kode) {
      const r = await klien.query(
        `SELECT 1 FROM ${def.tabel} WHERE lower(kode) = lower($1) AND deleted_at IS NULL AND id <> $2`,
        [data.kode, id || 0]);
      if (r.rows.length) galat.kode = `Kode ${data.kode} sudah dipakai.`;
    }
    if (Object.keys(galat).length) throw new GalatValidasi(galat);

    const kolom = def.field.map((f) => f.nama);
    const nilai = kolom.map((k) => data[k]);
    let baru;
    try {
      if (id) {
        const set = kolom.map((k, i) => `${k} = $${i + 1}`).join(', ');
        baru = (await klien.query(
          `UPDATE ${def.tabel} SET ${set} WHERE id = $${kolom.length + 1} RETURNING *`, [...nilai, id])).rows[0];
      } else {
        const ph = kolom.map((_, i) => `$${i + 1}`).join(', ');
        baru = (await klien.query(
          `INSERT INTO ${def.tabel} (${kolom.join(', ')}) VALUES (${ph}) RETURNING *`, nilai)).rows[0];
      }
    } catch (err) {
      if (err.code === '23505') throw new GalatValidasi({ kode: `Kode ${data.kode} sudah dipakai.` });
      throw err;
    }
    await catatAudit(klien, {
      penggunaId: pengguna.id, tabel: def.tabel, rekamanId: baru.id,
      aksi: id ? 'ubah' : 'tambah', sebelum: lama, sesudah: baru,
    });
    return baru;
  });
}

/** Soft delete. Ditolak bila data masih dirujuk data lain. */
async function hapus(pengguna, def, id) {
  pastikanAkses(pengguna, 'master', 'hapus');
  return db.transaksi(async (klien) => {
    const r = await klien.query(`SELECT * FROM ${def.tabel} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    if (!r.rows.length) throw new GalatBisnis(`Data ${def.judulTunggal} tidak ditemukan.`, 404);
    const dipakai = await jumlahRujukan(klien, def, id);
    if (dipakai.length) {
      throw new GalatBisnis(`${r.rows[0].kode} tidak bisa dihapus karena masih dipakai oleh ${dipakai.join(', ')}. Nonaktifkan saja.`, 409);
    }
    await klien.query(`UPDATE ${def.tabel} SET deleted_at = now() WHERE id = $1`, [id]);
    await catatAudit(klien, {
      penggunaId: pengguna.id, tabel: def.tabel, rekamanId: id, aksi: 'hapus', sebelum: r.rows[0],
    });
    return r.rows[0];
  });
}

module.exports = { daftar, semuaUntukEkspor, ambil, opsiRelasi, nilaiAwal, simpan, hapus, GalatValidasi };
