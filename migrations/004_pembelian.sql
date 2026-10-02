-- 004: Pembelian — PO, penerimaan barang, faktur, uang muka, pembayaran hutang, retur.
-- Semua dokumen: draft → diposting → batal. Nomor diberikan saat posting.

-- Akun penampung barang diterima belum difaktur (GRNI)
INSERT INTO akun (kode, nama, jenis, saldo_normal, akun_header, induk_id)
SELECT '2-1700', 'Barang Diterima Belum Difaktur', 'kewajiban', 'K', false, id FROM akun WHERE kode = '2-1000';

INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('akun_grni',            '2-1700', 'Akun barang diterima belum difaktur'),
  ('akun_uang_muka_beli',  '1-1600', 'Akun uang muka pembelian'),
  ('prefiks_akun_kas',     '1-11,1-12', 'Awalan kode akun yang boleh dipilih sebagai kas/bank (dipisah koma)');

-- ========== PESANAN PEMBELIAN ==========
CREATE TABLE pesanan_pembelian (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  pemasok_id       BIGINT NOT NULL REFERENCES pemasok(id),
  tanggal_kirim    DATE,
  pakai_ppn        BOOLEAN NOT NULL DEFAULT true,
  ppn_persen       NUMERIC(5,2) NOT NULL DEFAULT 0,      -- disalin dari pengaturan saat dokumen dibuat
  total_dpp        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_ppn        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total            NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan       TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  status_terima    VARCHAR(10) NOT NULL DEFAULT 'belum' CHECK (status_terima IN ('belum','sebagian','selesai')),
  diposting_oleh   BIGINT REFERENCES pengguna(id),
  diposting_pada   TIMESTAMPTZ,
  dibatalkan_oleh  BIGINT REFERENCES pengguna(id),
  dibatalkan_pada  TIMESTAMPTZ,
  alasan_batal     TEXT,
  dibuat_oleh      BIGINT REFERENCES pengguna(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX pesanan_pembelian_nomor_uq ON pesanan_pembelian (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE pesanan_pembelian_detail (
  id             BIGSERIAL PRIMARY KEY,
  po_id          BIGINT NOT NULL REFERENCES pesanan_pembelian(id),
  barang_id      BIGINT NOT NULL REFERENCES barang(id),
  qty            NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  harga          NUMERIC(15,2) NOT NULL CHECK (harga >= 0),
  diskon_persen  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (diskon_persen BETWEEN 0 AND 100),
  kena_ppn       BOOLEAN NOT NULL DEFAULT true,
  bruto          NUMERIC(15,2) NOT NULL DEFAULT 0,
  diskon         NUMERIC(15,2) NOT NULL DEFAULT 0,
  dpp            NUMERIC(15,2) NOT NULL DEFAULT 0,
  ppn            NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  qty_diterima   NUMERIC(15,4) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  CHECK (qty_diterima >= 0 AND qty_diterima <= qty)
);
CREATE INDEX pesanan_pembelian_detail_idx ON pesanan_pembelian_detail (po_id);

-- ========== PENERIMAAN BARANG ==========
CREATE TABLE penerimaan_barang (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  pemasok_id       BIGINT NOT NULL REFERENCES pemasok(id),
  po_id            BIGINT NOT NULL REFERENCES pesanan_pembelian(id),
  gudang_id        BIGINT NOT NULL REFERENCES gudang(id),
  no_surat_jalan   VARCHAR(50),
  total_nilai      NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan       TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  jurnal_id        BIGINT REFERENCES jurnal(id),
  jurnal_batal_id  BIGINT REFERENCES jurnal(id),
  diposting_oleh   BIGINT REFERENCES pengguna(id),
  diposting_pada   TIMESTAMPTZ,
  dibatalkan_oleh  BIGINT REFERENCES pengguna(id),
  dibatalkan_pada  TIMESTAMPTZ,
  alasan_batal     TEXT,
  dibuat_oleh      BIGINT REFERENCES pengguna(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX penerimaan_barang_nomor_uq ON penerimaan_barang (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE penerimaan_barang_detail (
  id                BIGSERIAL PRIMARY KEY,
  penerimaan_id     BIGINT NOT NULL REFERENCES penerimaan_barang(id),
  po_detail_id      BIGINT NOT NULL REFERENCES pesanan_pembelian_detail(id),
  barang_id         BIGINT NOT NULL REFERENCES barang(id),
  qty               NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  nilai             NUMERIC(15,2) NOT NULL DEFAULT 0,   -- DPP qty ini pada harga & diskon PO
  faktur_detail_id  BIGINT,                             -- terisi saat difakturkan (diposting)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX penerimaan_barang_detail_idx ON penerimaan_barang_detail (penerimaan_id);

-- ========== FAKTUR PEMBELIAN ==========
CREATE TABLE faktur_pembelian (
  id                 BIGSERIAL PRIMARY KEY,
  nomor              VARCHAR(30),
  tanggal            DATE NOT NULL,
  pemasok_id         BIGINT NOT NULL REFERENCES pemasok(id),
  no_faktur_pemasok  VARCHAR(50),
  no_faktur_pajak    VARCHAR(50),
  jatuh_tempo        DATE NOT NULL,
  pakai_ppn          BOOLEAN NOT NULL DEFAULT true,
  ppn_persen         NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_dpp          NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_ppn          NUMERIC(15,2) NOT NULL DEFAULT 0,
  total              NUMERIC(15,2) NOT NULL DEFAULT 0,
  dibayar            NUMERIC(15,2) NOT NULL DEFAULT 0,
  diretur            NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan         TEXT,
  status             VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  jurnal_id          BIGINT REFERENCES jurnal(id),
  jurnal_batal_id    BIGINT REFERENCES jurnal(id),
  diposting_oleh     BIGINT REFERENCES pengguna(id),
  diposting_pada     TIMESTAMPTZ,
  dibatalkan_oleh    BIGINT REFERENCES pengguna(id),
  dibatalkan_pada    TIMESTAMPTZ,
  alasan_batal       TEXT,
  dibuat_oleh        BIGINT REFERENCES pengguna(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  CHECK (dibayar >= 0 AND diretur >= 0 AND dibayar + diretur <= total)
);
CREATE UNIQUE INDEX faktur_pembelian_nomor_uq ON faktur_pembelian (nomor) WHERE nomor IS NOT NULL;
CREATE INDEX faktur_pembelian_pemasok_idx ON faktur_pembelian (pemasok_id, status);

CREATE TABLE faktur_pembelian_detail (
  id                     BIGSERIAL PRIMARY KEY,
  faktur_id              BIGINT NOT NULL REFERENCES faktur_pembelian(id),
  penerimaan_detail_id   BIGINT NOT NULL REFERENCES penerimaan_barang_detail(id),
  barang_id              BIGINT NOT NULL REFERENCES barang(id),
  qty                    NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  harga                  NUMERIC(15,2) NOT NULL CHECK (harga >= 0),
  diskon_persen          NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (diskon_persen BETWEEN 0 AND 100),
  kena_ppn               BOOLEAN NOT NULL DEFAULT true,
  bruto                  NUMERIC(15,2) NOT NULL DEFAULT 0,
  diskon                 NUMERIC(15,2) NOT NULL DEFAULT 0,
  dpp                    NUMERIC(15,2) NOT NULL DEFAULT 0,
  ppn                    NUMERIC(15,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(15,2) NOT NULL DEFAULT 0,
  nilai_terima           NUMERIC(15,2) NOT NULL DEFAULT 0,   -- nilai penerimaan (GRNI) yang ditutup
  qty_diretur            NUMERIC(15,4) NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  CHECK (qty_diretur >= 0 AND qty_diretur <= qty)
);
CREATE INDEX faktur_pembelian_detail_idx ON faktur_pembelian_detail (faktur_id);
ALTER TABLE penerimaan_barang_detail
  ADD CONSTRAINT penerimaan_detail_faktur_fk FOREIGN KEY (faktur_detail_id) REFERENCES faktur_pembelian_detail(id);

-- ========== UANG MUKA PEMBELIAN ==========
CREATE TABLE uang_muka_pembelian (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  pemasok_id       BIGINT NOT NULL REFERENCES pemasok(id),
  akun_kas_id      BIGINT NOT NULL REFERENCES akun(id),
  jumlah           NUMERIC(15,2) NOT NULL CHECK (jumlah > 0),
  dipakai          NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan       TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  jurnal_id        BIGINT REFERENCES jurnal(id),
  jurnal_batal_id  BIGINT REFERENCES jurnal(id),
  diposting_oleh   BIGINT REFERENCES pengguna(id),
  diposting_pada   TIMESTAMPTZ,
  dibatalkan_oleh  BIGINT REFERENCES pengguna(id),
  dibatalkan_pada  TIMESTAMPTZ,
  alasan_batal     TEXT,
  dibuat_oleh      BIGINT REFERENCES pengguna(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CHECK (dipakai >= 0 AND dipakai <= jumlah)
);
CREATE UNIQUE INDEX uang_muka_pembelian_nomor_uq ON uang_muka_pembelian (nomor) WHERE nomor IS NOT NULL;

-- ========== PEMBAYARAN HUTANG ==========
CREATE TABLE pembayaran_hutang (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  pemasok_id       BIGINT NOT NULL REFERENCES pemasok(id),
  metode           VARCHAR(10) NOT NULL CHECK (metode IN ('kas','uang_muka')),
  akun_kas_id      BIGINT REFERENCES akun(id),
  uang_muka_id     BIGINT REFERENCES uang_muka_pembelian(id),
  total            NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan       TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  jurnal_id        BIGINT REFERENCES jurnal(id),
  jurnal_batal_id  BIGINT REFERENCES jurnal(id),
  diposting_oleh   BIGINT REFERENCES pengguna(id),
  diposting_pada   TIMESTAMPTZ,
  dibatalkan_oleh  BIGINT REFERENCES pengguna(id),
  dibatalkan_pada  TIMESTAMPTZ,
  alasan_batal     TEXT,
  dibuat_oleh      BIGINT REFERENCES pengguna(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CHECK ((metode = 'kas' AND akun_kas_id IS NOT NULL) OR (metode = 'uang_muka' AND uang_muka_id IS NOT NULL))
);
CREATE UNIQUE INDEX pembayaran_hutang_nomor_uq ON pembayaran_hutang (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE pembayaran_hutang_detail (
  id             BIGSERIAL PRIMARY KEY,
  pembayaran_id  BIGINT NOT NULL REFERENCES pembayaran_hutang(id),
  faktur_id      BIGINT NOT NULL REFERENCES faktur_pembelian(id),
  jumlah         NUMERIC(15,2) NOT NULL CHECK (jumlah > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX pembayaran_hutang_detail_idx ON pembayaran_hutang_detail (pembayaran_id);
CREATE INDEX pembayaran_hutang_faktur_idx ON pembayaran_hutang_detail (faktur_id);

-- ========== RETUR PEMBELIAN ==========
CREATE TABLE retur_pembelian (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  pemasok_id       BIGINT NOT NULL REFERENCES pemasok(id),
  faktur_id        BIGINT NOT NULL REFERENCES faktur_pembelian(id),
  gudang_id        BIGINT NOT NULL REFERENCES gudang(id),
  total_dpp        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_ppn        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total            NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan       TEXT,
  status           VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  jurnal_id        BIGINT REFERENCES jurnal(id),
  jurnal_batal_id  BIGINT REFERENCES jurnal(id),
  diposting_oleh   BIGINT REFERENCES pengguna(id),
  diposting_pada   TIMESTAMPTZ,
  dibatalkan_oleh  BIGINT REFERENCES pengguna(id),
  dibatalkan_pada  TIMESTAMPTZ,
  alasan_batal     TEXT,
  dibuat_oleh      BIGINT REFERENCES pengguna(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX retur_pembelian_nomor_uq ON retur_pembelian (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE retur_pembelian_detail (
  id                 BIGSERIAL PRIMARY KEY,
  retur_id           BIGINT NOT NULL REFERENCES retur_pembelian(id),
  faktur_detail_id   BIGINT NOT NULL REFERENCES faktur_pembelian_detail(id),
  barang_id          BIGINT NOT NULL REFERENCES barang(id),
  qty                NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  dpp                NUMERIC(15,2) NOT NULL DEFAULT 0,
  ppn                NUMERIC(15,2) NOT NULL DEFAULT 0,
  total              NUMERIC(15,2) NOT NULL DEFAULT 0,
  nilai_hpp          NUMERIC(15,2) NOT NULL DEFAULT 0,   -- nilai persediaan yang keluar (terisi saat posting)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX retur_pembelian_detail_idx ON retur_pembelian_detail (retur_id);

-- Trigger updated_at untuk semua tabel baru
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pesanan_pembelian','pesanan_pembelian_detail','penerimaan_barang','penerimaan_barang_detail',
    'faktur_pembelian','faktur_pembelian_detail','uang_muka_pembelian','pembayaran_hutang','pembayaran_hutang_detail',
    'retur_pembelian','retur_pembelian_detail'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
