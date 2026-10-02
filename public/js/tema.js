// Dipasang di <head> sebelum CSS agar tema & lebar sidebar terpasang sebelum halaman digambar (tanpa kedip).
(function () {
  var tema = null, ciut = null;
  try { tema = localStorage.getItem('tema'); ciut = localStorage.getItem('sidebar-ciut'); } catch (e) { /* penyimpanan diblokir */ }
  if (tema === 'gelap' || tema === 'terang') document.documentElement.setAttribute('data-tema', tema);
  if (ciut === '1') document.documentElement.setAttribute('data-ciut', '1');
  window.simpanCiut = function (v) {
    document.documentElement.toggleAttribute('data-ciut', !!v);
    try { localStorage.setItem('sidebar-ciut', v ? '1' : '0'); } catch (e) { /* abaikan */ }
  };
})();
