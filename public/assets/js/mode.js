/* Mode « passager à bord » et introduction animée — chargé dans <head> pour choisir
   la bonne mise en page avant l'affichage (aucun clignotement).

   Mode passager : activé par le QR code ou le tag NFC des véhicules (?bord=1).

   Introduction animée (environ 2,7 secondes), commune à toutes les entrées du site
   (domaine principal, QR codes, NFC, réseaux sociaux, campagnes…) — règles :
   - rejouée à chaque ouverture ou rechargement de la page ;
   - pas rejouée lors d'une navigation interne (retour depuis une page du site, précédent/suivant) ;
   - affichée uniquement si la bonne version de la feuille de style est chargée (--elev8-css) ;
   - jamais si l'appareil demande de limiter les animations ;
   - retirée automatiquement après 2,9 s, ou dès le premier toucher / la première touche ;
   - en cas d'erreur, la page s'affiche directement, sans introduction. */
(function () {
  var CSS_VERSION = "8";   // doit correspondre à --elev8-css dans assets/css/style.css
  var root = document.documentElement;
  try {
    var bord = window.ELEV8_FORCE_BORD || /[?&]bord=1(&|$)/.test(location.search) || location.hash === "#bord";
    if (bord) root.classList.add("is-bord");
    if (!document.querySelector || window.ELEV8_NO_INTRO) return;

    var cssOk = (getComputedStyle(root).getPropertyValue("--elev8-css") || "").trim() === CSS_VERSION;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Navigation interne : arrivée depuis une autre page du site (hors rechargement),
       ou retour par les boutons précédent / suivant du navigateur. */
    var navType = "";
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      navType = nav ? nav.type : (performance.navigation ? ["navigate", "reload", "back_forward"][performance.navigation.type] || "" : "");
    } catch (e) {}
    var fromSite = false;
    try { fromSite = !!document.referrer && new URL(document.referrer).host === location.host; } catch (e) {}
    var internal = navType === "back_forward" || (fromSite && navType !== "reload");

    if (!cssOk || reduce || (internal && !window.ELEV8_FORCE_INTRO)) return;

    root.classList.add("has-intro", "intro-on");   // has-intro : rythme de la page ; intro-on : voile affiché
    var done = false, t0 = Date.now();
    var show = function () { var el = document.getElementById("intro"); if (el) el.hidden = false; else end(); };

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
    if (document.getElementById("intro")) show(); else document.addEventListener("DOMContentLoaded", show);
    setTimeout(end, 2900);                          // sécurité : l'introduction se termine toujours
  } catch (e) {
    root.classList.remove("intro-on");
    var el = document.getElementById("intro"); if (el) el.hidden = true;
  }
})();
