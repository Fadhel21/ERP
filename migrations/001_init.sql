-- 001: Fondasi sistem — pengguna, peran, hak akses, pengaturan, penomoran, periode, audit.

-- Memperbarui kolom updated_at otomatis pada setiap UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE peran (
  id          BIGSERIAL PRIMARY KEY,
  nama        VARCHAR(50) NOT NULL,
  keterangan  TEXT,
  admin       BOOLEAN NOT NULL DEFAULT false,  -- true = semua akses
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX peran_nama_uq ON peran (lower(nama)) WHERE deleted_at IS NULL;

-- Satu baris = satu izin (peran, modul, aksi).
CREATE TABLE peran_izin (
  id          BIGSERIAL PRIMARY KEY,
  peran_id    BIGINT NOT NULL REFERENCES peran(id),
  modul       VARCHAR(30) NOT NULL,
  aksi        VARCHAR(20) NOT NULL CHECK (aksi IN ('lihat','tambah','ubah','hapus','posting','batal')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX peran_izin_uq ON peran_izin (peran_id, modul, aksi) WHERE deleted_at IS NULL;

CREATE TABLE pengguna (
  id             BIGSERIAL PRIMARY KEY,
  username       VARCHAR(50) NOT NULL,
  nama           VARCHAR(100) NOT NULL,
  email          VARCHAR(150),
  password_hash  VARCHAR(100) NOT NULL,
  peran_id       BIGINT NOT NULL REFERENCES peran(id),
  aktif          BOOLEAN NOT NULL DEFAULT true,
  login_terakhir TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX pengguna_username_uq ON pengguna (lower(username)) WHERE deleted_at IS NULL;

-- Pengaturan kunci-nilai (tarif PPN, izin stok negatif, dll). Nilai disimpan sebagai teks.
CREATE TABLE pengaturan (
  id          BIGSERIAL PRIMARY KEY,
  kunci       VARCHAR(60) NOT NULL,
  nilai       TEXT NOT NULL,
  keterangan  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX pengaturan_kunci_uq ON pengaturan (kunci) WHERE deleted_at IS NULL;

INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('nama_perusahaan',      'Perusahaan Saya', 'Nama yang tampil di aplikasi dan dokumen cetak'),
  ('ppn_persen',           '11',              'Tarif PPN dalam persen'),
  ('pembulatan_desimal',   '0',               'Jumlah desimal pembulatan pajak per baris (0 = rupiah penuh, half-up)'),
  ('izinkan_stok_negatif', 'false',           'true = stok boleh minus'),
  ('metode_persediaan',    'rata_rata',       'Metode penilaian persediaan: rata-rata bergerak');

-- Penghitung nomor dokumen per jenis per periode (YYYYMM). Dikunci dengan SELECT ... FOR UPDATE.
CREATE TABLE penghitung_dokumen (
  id          BIGSERIAL PRIMARY KEY,
  jenis       VARCHAR(10) NOT NULL,
  periode     CHAR(6) NOT NULL,
  terakhir    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX penghitung_dokumen_uq ON penghitung_dokumen (jenis, periode);

-- Periode akuntansi bulanan. Transaksi di periode tertutup ditolak.
CREATE TABLE periode (
  id           BIGSERIAL PRIMARY KEY,
  tahun        SMALLINT NOT NULL,
  bulan        SMALLINT NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  ditutup      BOOLEAN NOT NULL DEFAULT false,
  ditutup_oleh BIGINT REFERENCES pengguna(id),
  ditutup_pada TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX periode_uq ON periode (tahun, bulan);

-- Jejak audit: siapa, kapan, apa yang berubah.
CREATE TABLE jejak_audit (
  id          BIGSERIAL PRIMARY KEY,
  pengguna_id BIGINT REFERENCES pengguna(id),
  tabel       VARCHAR(60) NOT NULL,
  rekaman_id  BIGINT,
  aksi        VARCHAR(30) NOT NULL,
  sebelum     JSONB,
  sesudah     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX jejak_audit_rekaman_idx ON jejak_audit (tabel, rekaman_id);

CREATE TRIGGER trg_peran_upd BEFORE UPDATE ON peran FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_peran_izin_upd BEFORE UPDATE ON peran_izin FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pengguna_upd BEFORE UPDATE ON pengguna FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pengaturan_upd BEFORE UPDATE ON pengaturan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_penghitung_upd BEFORE UPDATE ON penghitung_dokumen FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_periode_upd BEFORE UPDATE ON periode FOR EACH ROW EXECUTE FUNCTION set_updated_at();
