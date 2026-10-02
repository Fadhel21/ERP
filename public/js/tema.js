// Dipasang di <head> sebelum CSS agar tema terpasang sebelum halaman digambar (tanpa kedip).
(function () {
  var tema = null;
  try { tema = localStorage.getItem('tema'); } catch (e) { /* penyimpanan diblokir */ }
  if (tema === 'gelap' || tema === 'terang') document.documentElement.setAttribute('data-tema', tema);
})();
