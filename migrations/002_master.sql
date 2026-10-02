-- 002: Master data — satuan, kategori, gudang, bagan akun, barang, pelanggan, pemasok.

CREATE TABLE satuan (
  id          BIGSERIAL PRIMARY KEY,
  kode        VARCHAR(20) NOT NULL,
  nama        VARCHAR(60) NOT NULL,
  aktif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX satuan_kode_uq ON satuan (lower(kode)) WHERE deleted_at IS NULL;

CREATE TABLE kategori_barang (
  id          BIGSERIAL PRIMARY KEY,
  kode        VARCHAR(20) NOT NULL,
  nama        VARCHAR(100) NOT NULL,
  induk_id    BIGINT REFERENCES kategori_barang(id),
  aktif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX kategori_barang_kode_uq ON kategori_barang (lower(kode)) WHERE deleted_at IS NULL;

CREATE TABLE gudang (
  id          BIGSERIAL PRIMARY KEY,
  kode        VARCHAR(20) NOT NULL,
  nama        VARCHAR(100) NOT NULL,
  alamat      TEXT,
  aktif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX gudang_kode_uq ON gudang (lower(kode)) WHERE deleted_at IS NULL;

-- Bagan akun. Akun header hanya pengelompokan dan tidak boleh dipakai di jurnal.
CREATE TABLE akun (
  id           BIGSERIAL PRIMARY KEY,
  kode         VARCHAR(20) NOT NULL,
  nama         VARCHAR(120) NOT NULL,
  jenis        VARCHAR(12) NOT NULL CHECK (jenis IN ('aset','kewajiban','ekuitas','pendapatan','hpp','beban')),
  saldo_normal CHAR(1) NOT NULL CHECK (saldo_normal IN ('D','K')),
  induk_id     BIGINT REFERENCES akun(id),
  akun_header  BOOLEAN NOT NULL DEFAULT false,
  aktif        BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX akun_kode_uq ON akun (lower(kode)) WHERE deleted_at IS NULL;

CREATE TABLE barang (
  id                    BIGSERIAL PRIMARY KEY,
  kode                  VARCHAR(30) NOT NULL,
  nama                  VARCHAR(150) NOT NULL,
  jenis                 VARCHAR(10) NOT NULL DEFAULT 'stok' CHECK (jenis IN ('stok','jasa')),
  kategori_id           BIGINT REFERENCES kategori_barang(id),
  satuan_id             BIGINT NOT NULL REFERENCES satuan(id),
  harga_beli            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (harga_beli >= 0),
  harga_jual            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (harga_jual >= 0),
  stok_minimum          NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (stok_minimum >= 0),
  kena_ppn              BOOLEAN NOT NULL DEFAULT true,
  akun_persediaan_id    BIGINT REFERENCES akun(id),
  akun_pendapatan_id    BIGINT REFERENCES akun(id),
  akun_hpp_id           BIGINT REFERENCES akun(id),
  keterangan            TEXT,
  aktif                 BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
CREATE UNIQUE INDEX barang_kode_uq ON barang (lower(kode)) WHERE deleted_at IS NULL;
CREATE INDEX barang_nama_idx ON barang (lower(nama));

CREATE TABLE pelanggan (
  id               BIGSERIAL PRIMARY KEY,
  kode             VARCHAR(30) NOT NULL,
  nama             VARCHAR(150) NOT NULL,
  alamat           TEXT,
  telepon          VARCHAR(30),
  email            VARCHAR(150),
  npwp             VARCHAR(30),
  termin_hari      INTEGER NOT NULL DEFAULT 0 CHECK (termin_hari >= 0),
  batas_kredit     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (batas_kredit >= 0),
  akun_piutang_id  BIGINT REFERENCES akun(id),
  aktif            BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX pelanggan_kode_uq ON pelanggan (lower(kode)) WHERE deleted_at IS NULL;

CREATE TABLE pemasok (
  id              BIGSERIAL PRIMARY KEY,
  kode            VARCHAR(30) NOT NULL,
  nama            VARCHAR(150) NOT NULL,
  alamat          TEXT,
  telepon         VARCHAR(30),
  email           VARCHAR(150),
  npwp            VARCHAR(30),
  termin_hari     INTEGER NOT NULL DEFAULT 0 CHECK (termin_hari >= 0),
  akun_hutang_id  BIGINT REFERENCES akun(id),
  aktif           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX pemasok_kode_uq ON pemasok (lower(kode)) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_satuan_upd BEFORE UPDATE ON satuan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kategori_upd BEFORE UPDATE ON kategori_barang FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_gudang_upd BEFORE UPDATE ON gudang FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_akun_upd BEFORE UPDATE ON akun FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_barang_upd BEFORE UPDATE ON barang FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pelanggan_upd BEFORE UPDATE ON pelanggan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pemasok_upd BEFORE UPDATE ON pemasok FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Data awal ----------
INSERT INTO satuan (kode, nama) VALUES
  ('PCS', 'Pieces'), ('UNIT', 'Unit'), ('BOX', 'Box'), ('KG', 'Kilogram'), ('LTR', 'Liter'), ('M', 'Meter');

INSERT INTO gudang (kode, nama) VALUES ('GD-UTAMA', 'Gudang Utama');

-- Template bagan akun UKM (gaya SAK EMKM). Kolom induk diisi setelahnya berdasarkan kode.
INSERT INTO akun (kode, nama, jenis, saldo_normal, akun_header) VALUES
  ('1-0000', 'ASET', 'aset', 'D', true),
  ('1-1000', 'Aset Lancar', 'aset', 'D', true),
  ('1-1100', 'Kas', 'aset', 'D', false),
  ('1-1200', 'Bank', 'aset', 'D', false),
  ('1-1300', 'Piutang Usaha', 'aset', 'D', false),
  ('1-1400', 'Persediaan Barang', 'aset', 'D', false),
  ('1-1500', 'PPN Masukan', 'aset', 'D', false),
  ('1-1600', 'Uang Muka Pembelian', 'aset', 'D', false),
  ('1-1700', 'Biaya Dibayar di Muka', 'aset', 'D', false),
  ('1-2000', 'Aset Tetap', 'aset', 'D', true),
  ('1-2100', 'Tanah', 'aset', 'D', false),
  ('1-2200', 'Bangunan', 'aset', 'D', false),
  ('1-2300', 'Kendaraan', 'aset', 'D', false),
  ('1-2400', 'Peralatan Kantor', 'aset', 'D', false),
  ('1-2900', 'Akumulasi Penyusutan', 'aset', 'K', false),
  ('2-0000', 'KEWAJIBAN', 'kewajiban', 'K', true),
  ('2-1000', 'Kewajiban Jangka Pendek', 'kewajiban', 'K', true),
  ('2-1100', 'Hutang Usaha', 'kewajiban', 'K', false),
  ('2-1200', 'PPN Keluaran', 'kewajiban', 'K', false),
  ('2-1300', 'Hutang Pajak Lainnya', 'kewajiban', 'K', false),
  ('2-1400', 'Uang Muka Penjualan', 'kewajiban', 'K', false),
  ('2-1500', 'Hutang Gaji', 'kewajiban', 'K', false),
  ('2-1600', 'Biaya Masih Harus Dibayar', 'kewajiban', 'K', false),
  ('2-2000', 'Kewajiban Jangka Panjang', 'kewajiban', 'K', true),
  ('2-2100', 'Hutang Bank', 'kewajiban', 'K', false),
  ('3-0000', 'EKUITAS', 'ekuitas', 'K', true),
  ('3-1000', 'Modal Disetor', 'ekuitas', 'K', false),
  ('3-2000', 'Laba Ditahan', 'ekuitas', 'K', false),
  ('3-3000', 'Laba Tahun Berjalan', 'ekuitas', 'K', false),
  ('3-9000', 'Ekuitas Saldo Awal', 'ekuitas', 'K', false),
  ('4-0000', 'PENDAPATAN', 'pendapatan', 'K', true),
  ('4-1000', 'Penjualan', 'pendapatan', 'K', false),
  ('4-1100', 'Retur Penjualan', 'pendapatan', 'D', false),
  ('4-1200', 'Potongan Penjualan', 'pendapatan', 'D', false),
  ('4-2000', 'Pendapatan Lain-lain', 'pendapatan', 'K', false),
  ('5-0000', 'HARGA POKOK PENJUALAN', 'hpp', 'D', true),
  ('5-1000', 'Harga Pokok Penjualan', 'hpp', 'D', false),
  ('5-2000', 'Selisih Persediaan', 'hpp', 'D', false),
  ('6-0000', 'BEBAN', 'beban', 'D', true),
  ('6-1000', 'Beban Gaji', 'beban', 'D', false),
  ('6-1100', 'Beban Sewa', 'beban', 'D', false),
  ('6-1200', 'Beban Listrik & Air', 'beban', 'D', false),
  ('6-1300', 'Beban Telepon & Internet', 'beban', 'D', false),
  ('6-1400', 'Beban Transportasi', 'beban', 'D', false),
  ('6-1500', 'Beban Perlengkapan Kantor', 'beban', 'D', false),
  ('6-1600', 'Beban Penyusutan', 'beban', 'D', false),
  ('6-1700', 'Beban Pemasaran', 'beban', 'D', false),
  ('6-1800', 'Beban Administrasi Bank', 'beban', 'D', false),
  ('6-9000', 'Beban Lain-lain', 'beban', 'D', false);

-- Induk: x-0000 untuk x-n000; x-n000 untuk x-nnnn lainnya.
UPDATE akun a SET induk_id = p.id FROM akun p
WHERE a.kode ~ '^\d-[1-9]000$' AND p.kode = left(a.kode, 2) || '0000';
UPDATE akun a SET induk_id = p.id FROM akun p
WHERE a.kode !~ '000$' AND p.kode = left(a.kode, 3) || '000';

-- Akun bawaan untuk master baru (disimpan sebagai kode akun, bisa diubah di pengaturan).
INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('akun_persediaan', '1-1400', 'Akun persediaan bawaan untuk barang baru'),
  ('akun_pendapatan', '4-1000', 'Akun pendapatan bawaan untuk barang baru'),
  ('akun_hpp',        '5-1000', 'Akun HPP bawaan untuk barang baru'),
  ('akun_piutang',    '1-1300', 'Akun piutang bawaan untuk pelanggan baru'),
  ('akun_hutang',     '2-1100', 'Akun hutang bawaan untuk pemasok baru'),
  ('akun_ppn_masukan','1-1500', 'Akun PPN Masukan'),
  ('akun_ppn_keluaran','2-1200','Akun PPN Keluaran');
