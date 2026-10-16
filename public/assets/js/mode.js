/* Mode « passager à bord » : activé par le QR code ou le tag NFC des véhicules (?bord=1).
   Chargé dans <head> pour choisir la bonne mise en page avant l'affichage (aucun clignotement).

   Introduction animée (environ 2,7 secondes) — règles de sécurité :
   - affichée uniquement si la bonne version de la feuille de style est chargée (--elev8-css) ;
   - une seule fois par visite, jamais si l'appareil demande de limiter les animations ;
   - retirée automatiquement après 2,9 s, ou dès le premier toucher ;
   - en cas d'erreur, la page s'affiche directement, sans introduction. */
(function () {
  var CSS_VERSION = "7";   // doit correspondre à --elev8-css dans assets/css/style.css
  var root = document.documentElement;
  try {
    var bord = window.ELEV8_FORCE_BORD || /[?&]bord=1(&|$)/.test(location.search) || location.hash === "#bord";
    if (!bord) return;
    root.classList.add("is-bord");

    var cssOk = (getComputedStyle(root).getPropertyValue("--elev8-css") || "").trim() === CSS_VERSION;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var seen = false;
    try { seen = sessionStorage.getItem("elev8-intro") === "1"; } catch (e) {}
    if (!cssOk || reduce || (seen && !window.ELEV8_FORCE_INTRO)) return;
    try { sessionStorage.setItem("elev8-intro", "1"); } catch (e) {}

    root.classList.add("has-intro", "intro-on");   // has-intro : rythme de la page ; intro-on : voile affiché
    var done = false, t0 = Date.now();
    var show = function () { var el = document.getElementById("intro"); if (el) el.hidden = false; };
    if (document.getElementById("intro")) show(); else document.addEventListener("DOMContentLoaded", show);

    var end = function () {
      if (done) return; done = true;
      root.classList.remove("intro-on");
      var el = document.getElementById("intro"); if (el) el.hidden = true;
      ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { window.removeEventListener(ev, skip, true); });
    };
    var skip = function () {
      if (done || Date.now() - t0 > 2200) return;  // après 2,2 s, la page apparaît déjà d'elle-même
      root.classList.add("intro-skip");            // fondu immédiat (0,2 s), la page s'affiche aussitôt
      setTimeout(end, 220);
    };
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { window.addEventListener(ev, skip, { capture: true, passive: true }); });
    setTimeout(end, 2900);                          // sécurité : l'introduction se termine toujours
  } catch (e) {
    root.classList.remove("intro-on");
    var el = document.getElementById("intro"); if (el) el.hidden = true;
  }
})();
