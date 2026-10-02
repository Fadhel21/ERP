-- 003: Persediaan (kartu stok, saldo, penyesuaian, transfer, opname) + mesin jurnal inti.

-- Mencegah perubahan/penghapusan baris yang bersifat catatan permanen.
CREATE OR REPLACE FUNCTION tolak_ubah() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % hanya boleh ditambah; koreksi lewat transaksi pembalik.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- ========== JURNAL ==========
CREATE TABLE jurnal (
  id            BIGSERIAL PRIMARY KEY,
  nomor         VARCHAR(30) NOT NULL,
  tanggal       DATE NOT NULL,
  keterangan    TEXT NOT NULL,
  sumber_jenis  VARCHAR(30) NOT NULL,          -- mis. 'penyesuaian_stok', 'jurnal_umum'
  sumber_id     BIGINT,
  nomor_sumber  VARCHAR(30),
  membalik_id   BIGINT REFERENCES jurnal(id),  -- diisi bila jurnal ini membalik jurnal lain
  dibuat_oleh   BIGINT REFERENCES pengguna(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX jurnal_nomor_uq ON jurnal (nomor);
CREATE UNIQUE INDEX jurnal_membalik_uq ON jurnal (membalik_id) WHERE membalik_id IS NOT NULL;
CREATE INDEX jurnal_tanggal_idx ON jurnal (tanggal);
CREATE INDEX jurnal_sumber_idx ON jurnal (sumber_jenis, sumber_id);

CREATE TABLE jurnal_detail (
  id          BIGSERIAL PRIMARY KEY,
  jurnal_id   BIGINT NOT NULL REFERENCES jurnal(id),
  akun_id     BIGINT NOT NULL REFERENCES akun(id),
  debit       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  kredit      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (kredit >= 0),
  keterangan  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  CHECK ((debit > 0 AND kredit = 0) OR (kredit > 0 AND debit = 0))
);
CREATE INDEX jurnal_detail_jurnal_idx ON jurnal_detail (jurnal_id);
CREATE INDEX jurnal_detail_akun_idx ON jurnal_detail (akun_id);

CREATE TRIGGER trg_jurnal_tetap BEFORE UPDATE OR DELETE ON jurnal FOR EACH ROW EXECUTE FUNCTION tolak_ubah();
CREATE TRIGGER trg_jurnal_detail_tetap BEFORE UPDATE OR DELETE ON jurnal_detail FOR EACH ROW EXECUTE FUNCTION tolak_ubah();

-- Pengaman terakhir: total debit harus = total kredit, diperiksa saat COMMIT.
CREATE OR REPLACE FUNCTION cek_jurnal_seimbang() RETURNS trigger AS $$
DECLARE d NUMERIC; k NUMERIC; n INT;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(kredit), 0), count(*) INTO d, k, n
  FROM jurnal_detail WHERE jurnal_id = NEW.jurnal_id;
  IF d <> k THEN
    RAISE EXCEPTION 'Jurnal % tidak seimbang: debit % ≠ kredit %', NEW.jurnal_id, d, k;
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'Jurnal % harus memiliki minimal 2 baris', NEW.jurnal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_jurnal_seimbang AFTER INSERT ON jurnal_detail
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cek_jurnal_seimbang();

-- ========== SALDO & KARTU STOK ==========
-- Saldo global per barang (dasar HPP rata-rata bergerak, berlaku untuk semua gudang).
CREATE TABLE saldo_barang (
  id            BIGSERIAL PRIMARY KEY,
  barang_id     BIGINT NOT NULL REFERENCES barang(id),
  qty           NUMERIC(15,4) NOT NULL DEFAULT 0,
  nilai         NUMERIC(15,2) NOT NULL DEFAULT 0,
  hpp_terakhir  NUMERIC(15,2) NOT NULL DEFAULT 0,
  tanggal_akhir DATE,                           -- tanggal mutasi terakhir (penolak tanggal mundur)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX saldo_barang_uq ON saldo_barang (barang_id);

-- Saldo qty per barang per gudang.
CREATE TABLE saldo_stok (
  id          BIGSERIAL PRIMARY KEY,
  barang_id   BIGINT NOT NULL REFERENCES barang(id),
  gudang_id   BIGINT NOT NULL REFERENCES gudang(id),
  qty         NUMERIC(15,4) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX saldo_stok_uq ON saldo_stok (barang_id, gudang_id);

-- Kartu stok: setiap barang masuk/keluar. Hanya boleh ditambah.
CREATE TABLE mutasi_stok (
  id                BIGSERIAL PRIMARY KEY,
  tanggal           DATE NOT NULL,
  barang_id         BIGINT NOT NULL REFERENCES barang(id),
  gudang_id         BIGINT NOT NULL REFERENCES gudang(id),
  qty_masuk         NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (qty_masuk >= 0),
  qty_keluar        NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (qty_keluar >= 0),
  nilai_masuk       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (nilai_masuk >= 0),
  nilai_keluar      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (nilai_keluar >= 0),
  harga_satuan      NUMERIC(15,2) NOT NULL DEFAULT 0,
  saldo_qty_gudang  NUMERIC(15,4) NOT NULL,     -- saldo qty di gudang ini sesudah mutasi
  saldo_qty         NUMERIC(15,4) NOT NULL,     -- saldo qty global sesudah mutasi
  saldo_nilai       NUMERIC(15,2) NOT NULL,     -- saldo nilai global sesudah mutasi
  sumber_jenis      VARCHAR(30) NOT NULL,
  sumber_id         BIGINT NOT NULL,
  nomor_sumber      VARCHAR(30),
  keterangan        TEXT,
  dibuat_oleh       BIGINT REFERENCES pengguna(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CHECK ((qty_masuk > 0 AND qty_keluar = 0) OR (qty_keluar > 0 AND qty_masuk = 0))
);
CREATE INDEX mutasi_stok_kartu_idx ON mutasi_stok (barang_id, gudang_id, tanggal, id);
CREATE INDEX mutasi_stok_sumber_idx ON mutasi_stok (sumber_jenis, sumber_id);
CREATE TRIGGER trg_mutasi_stok_tetap BEFORE UPDATE OR DELETE ON mutasi_stok FOR EACH ROW EXECUTE FUNCTION tolak_ubah();

-- ========== DOKUMEN PERSEDIAAN ==========
-- Kolom status bersama: draft → diposting → batal. Nomor diberikan saat posting (tanpa celah).
CREATE TABLE penyesuaian_stok (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  jenis            VARCHAR(12) NOT NULL CHECK (jenis IN ('saldo_awal','masuk','keluar')),
  gudang_id        BIGINT NOT NULL REFERENCES gudang(id),
  akun_lawan_id    BIGINT REFERENCES akun(id),
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
CREATE UNIQUE INDEX penyesuaian_stok_nomor_uq ON penyesuaian_stok (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE penyesuaian_stok_detail (
  id              BIGSERIAL PRIMARY KEY,
  penyesuaian_id  BIGINT NOT NULL REFERENCES penyesuaian_stok(id),
  barang_id       BIGINT NOT NULL REFERENCES barang(id),
  qty             NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  harga_satuan    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (harga_satuan >= 0),
  nilai           NUMERIC(15,2) NOT NULL DEFAULT 0,   -- terisi saat posting
  keterangan      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX penyesuaian_stok_detail_idx ON penyesuaian_stok_detail (penyesuaian_id);

CREATE TABLE transfer_gudang (
  id                BIGSERIAL PRIMARY KEY,
  nomor             VARCHAR(30),
  tanggal           DATE NOT NULL,
  gudang_asal_id    BIGINT NOT NULL REFERENCES gudang(id),
  gudang_tujuan_id  BIGINT NOT NULL REFERENCES gudang(id),
  keterangan        TEXT,
  status            VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diposting','batal')),
  diposting_oleh    BIGINT REFERENCES pengguna(id),
  diposting_pada    TIMESTAMPTZ,
  dibatalkan_oleh   BIGINT REFERENCES pengguna(id),
  dibatalkan_pada   TIMESTAMPTZ,
  alasan_batal      TEXT,
  dibuat_oleh       BIGINT REFERENCES pengguna(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CHECK (gudang_asal_id <> gudang_tujuan_id)
);
CREATE UNIQUE INDEX transfer_gudang_nomor_uq ON transfer_gudang (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE transfer_gudang_detail (
  id           BIGSERIAL PRIMARY KEY,
  transfer_id  BIGINT NOT NULL REFERENCES transfer_gudang(id),
  barang_id    BIGINT NOT NULL REFERENCES barang(id),
  qty          NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  nilai        NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX transfer_gudang_detail_idx ON transfer_gudang_detail (transfer_id);

CREATE TABLE stok_opname (
  id               BIGSERIAL PRIMARY KEY,
  nomor            VARCHAR(30),
  tanggal          DATE NOT NULL,
  gudang_id        BIGINT NOT NULL REFERENCES gudang(id),
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
CREATE UNIQUE INDEX stok_opname_nomor_uq ON stok_opname (nomor) WHERE nomor IS NOT NULL;

CREATE TABLE stok_opname_detail (
  id             BIGSERIAL PRIMARY KEY,
  opname_id      BIGINT NOT NULL REFERENCES stok_opname(id),
  barang_id      BIGINT NOT NULL REFERENCES barang(id),
  qty_sistem     NUMERIC(15,4) NOT NULL DEFAULT 0,  -- diperbarui ke saldo terkini saat posting
  qty_fisik      NUMERIC(15,4) CHECK (qty_fisik >= 0),
  qty_selisih    NUMERIC(15,4) NOT NULL DEFAULT 0,
  nilai_selisih  NUMERIC(15,2) NOT NULL DEFAULT 0,
  keterangan     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX stok_opname_detail_uq ON stok_opname_detail (opname_id, barang_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_saldo_barang_upd BEFORE UPDATE ON saldo_barang FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_saldo_stok_upd BEFORE UPDATE ON saldo_stok FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_penyesuaian_upd BEFORE UPDATE ON penyesuaian_stok FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_penyesuaian_det_upd BEFORE UPDATE ON penyesuaian_stok_detail FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transfer_upd BEFORE UPDATE ON transfer_gudang FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transfer_det_upd BEFORE UPDATE ON transfer_gudang_detail FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_opname_upd BEFORE UPDATE ON stok_opname FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_opname_det_upd BEFORE UPDATE ON stok_opname_detail FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('akun_selisih_persediaan', '5-2000', 'Akun lawan penyesuaian & stok opname'),
  ('akun_saldo_awal',         '3-9000', 'Akun lawan saldo awal persediaan');
