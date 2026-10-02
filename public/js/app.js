// Perilaku global ringan: ganti tema dan integrasi HTMX.
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
