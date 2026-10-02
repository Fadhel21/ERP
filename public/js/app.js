// Perilaku global ringan: ganti tema, integrasi HTMX, dan komponen Alpine.

/**
 * Editor baris dokumen (Alpine): x-data="barisDokumen(barisAwal, { pakaiHarga })".
 * Dimuat sebelum alpine.min.js (urutan defer) sehingga tersedia saat Alpine mulai.
 */
window.barisDokumen = function (awal, opsi) {
  var urut = awal.length;
  return {
    baris: awal,
    pakaiHarga: !!(opsi && opsi.pakaiHarga),
    tambah: function () {
      this.baris.push({ k: ++urut, barang_id: '', qty: '', harga_satuan: '', galat: {} });
      var self = this;
      this.$nextTick(function () {
        var pilihan = self.$root.querySelectorAll('select[name=barang_id]');
        if (pilihan.length) pilihan[pilihan.length - 1].focus();
      });
    },
    hapus: function (i) {
      if (this.baris.length > 1) this.baris.splice(i, 1);
    },
    // Isi harga bawaan (HPP terakhir / harga beli) saat barang dipilih dan harga masih kosong
    isiHarga: function (b, select) {
      b.galat.barang_id = '';
      var opt = select.selectedOptions[0];
      if (this.pakaiHarga && opt && !b.harga_satuan) b.harga_satuan = opt.dataset.harga || '';
    },
    satuan: function (id) {
      if (!id) return '';
      var opt = this.$root.querySelector('select[name=barang_id] option[value="' + id + '"]');
      return opt ? opt.dataset.satuan : '';
    },
  };
};

/**
 * Pratinjau selisih opname (tampilan saja; nilai resmi dihitung server saat posting).
 * Memakai BigInt berskala 4 desimal — tanpa float.
 */
function keSkala4(s) {
  s = String(s == null ? '' : s).trim().replace(/\s/g, '');
  if (s === '') return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  var m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  var v = BigInt(m[2] + (m[3] || '').padEnd(4, '0'));
  return m[1] ? -v : v;
}
function formatSkala4(v) {
  var neg = v < 0n; if (neg) v = -v;
  var bulat = (v / 10000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  var pecahan = (v % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return (neg ? '-' : '+') + bulat + (pecahan ? ',' + pecahan : '');
}
window.selisihTeks = function (fisik, sistem) {
  var f = keSkala4(fisik), s = keSkala4(sistem);
  if (f === null || s === null || f === s) return '';
  return formatSkala4(f - s);
};
window.selisihKelas = function (fisik, sistem) {
  var t = window.selisihTeks(fisik, sistem);
  return t === '' ? '' : t.charAt(0) === '-' ? 'keluar' : 'masuk';
};

/** Masukan gaya Indonesia → BigInt berskala n desimal (null bila tidak valid). */
function keSkala(s, n) {
  s = String(s == null ? '' : s).trim().replace(/\s|Rp/gi, '');
  if (s === '') return 0n;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  var m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[2] && m[2].length > n)) return null;
  return BigInt(m[1] + (m[2] || '').padEnd(n, '0'));
}
function bagiBulat(a, b) { return (a * 2n + b) / (b * 2n); }
function formatSen(sen) {
  var neg = sen < 0n; if (neg) sen = -sen;
  var bulat = (sen / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + bulat + ',' + (sen % 100n).toString().padStart(2, '0');
}

/**
 * Form dokumen ber-harga & diskon dengan pratinjau DPP/PPN/total (sama dengan src/lib/pajak.js).
 * opsi: { tarif: '11', desimal: 0, pakaiPpn: true }
 */
window.formHarga = function (awal, opsi) {
  var d = window.barisDokumen(awal, { pakaiHarga: true });
  d.tarif = opsi.tarif; d.desimal = Number(opsi.desimal || 0); d.pakaiPpn = !!opsi.pakaiPpn;
  d.isiHarga = function (b, select) {
    b.galat.barang_id = '';
    var opt = select.selectedOptions[0];
    if (opt && !b.harga) b.harga = opt.dataset.harga || '';
  };
  d.kenaPpn = function (b) {
    if (b.ppnBarang !== undefined) return this.pakaiPpn && !!b.ppnBarang;
    var opt = this.$root.querySelector('select[name=barang_id] option[value="' + b.barang_id + '"]');
    return this.pakaiPpn && (!opt || opt.dataset.ppn === '1');
  };
  d.hitung = function (b) {
    var q = keSkala(b.qty, 4), h = keSkala(b.harga, 2), ds = keSkala(b.diskon_persen, 2), t = keSkala(this.tarif, 2);
    if (q === null || h === null || ds === null || t === null || ds > 10000n) return null;
    var unit = 10n ** BigInt(2 - this.desimal);
    var bruto = bagiBulat(q * h, 10000n);
    var diskon = bagiBulat(bruto * ds, 10000n * unit) * unit;
    var dpp = bruto - diskon;
    var ppn = this.kenaPpn(b) ? bagiBulat(dpp * t, 10000n * unit) * unit : 0n;
    return { dpp: dpp, ppn: ppn, total: dpp + ppn };
  };
  d.totalBaris = function (b) { var r = this.hitung(b); return r ? formatSen(r.total) : '—'; };
  d.jumlah = function (kunci) {
    var t = 0n, self = this;
    this.baris.forEach(function (b) { if (b.pilih === false) return; var r = self.hitung(b); if (r) t += r[kunci]; });
    return formatSen(t);
  };
  return d;
};

(function () {
  function temaSekarang() {
    var t = document.documentElement.getAttribute('data-tema');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'gelap' : 'terang';
  }

  document.addEventListener('click', function (e) {
    var tombol = e.target.closest('[data-ganti-tema]');
    if (!tombol) return;
    var baru = temaSekarang() === 'gelap' ? 'terang' : 'gelap';
    document.documentElement.setAttribute('data-tema', baru);
    try { localStorage.setItem('tema', baru); } catch (err) { /* abaikan */ }
  });

  // Tampilkan respons error HTMX (4xx/5xx) — server mengirim potongan notifikasi.
  document.addEventListener('htmx:beforeSwap', function (e) {
    if (e.detail.xhr.status >= 400) {
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });

  // Konfirmasi tindakan berbahaya: <button hx-post="..." data-konfirmasi="Yakin?">
  document.addEventListener('htmx:confirm', function (e) {
    var pesan = e.target.getAttribute('data-konfirmasi');
    if (!pesan) return;
    e.preventDefault();
    if (window.confirm(pesan)) e.detail.issueRequest(true);
  });
})();
