/* Remplit les pages légales à partir de config.js */
(function () {
  var C = window.SITE_CONFIG; if (!C) return;
  var get = function (p) { return p.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, C); };
  Array.prototype.forEach.call(document.querySelectorAll("[data-c]"), function (el) {
    var v = get(el.getAttribute("data-c"));
    if (v != null && v !== "") { el.textContent = v; if (/^\[.*\]$/.test(String(v))) el.classList.add("todo"); }
  });
  // Paragraphes affichés seulement si l'option correspondante est activée dans config.js
  Array.prototype.forEach.call(document.querySelectorAll("[data-if]"), function (el) {
    el.hidden = !get(el.getAttribute("data-if"));
  });
  document.title = document.title.replace(/ELEV8 Private Driver/, C.marque.nomComplet);
})();
