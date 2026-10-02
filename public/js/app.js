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
