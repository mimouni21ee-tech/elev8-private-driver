/* Mode « passager à bord » : activé par le QR code ou le tag NFC des véhicules (?bord=1).
   Chargé dans <head> pour choisir la bonne mise en page avant l'affichage (aucun clignotement).
   Introduction animée : ~1,5 s, une seule fois par visite, ignorée au premier toucher,
   désactivée si l'appareil demande de limiter les animations. */
(function () {
  var root = document.documentElement;
  try {
    var bord = window.ELEV8_FORCE_BORD || /[?&]bord=1(&|$)/.test(location.search) || location.hash === "#bord";
    if (!bord) return;
    root.classList.add("is-bord");

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var seen = false;
    try { seen = sessionStorage.getItem("elev8-intro") === "1"; } catch (e) {}
    if (reduce || (seen && !window.ELEV8_FORCE_INTRO)) return;
    try { sessionStorage.setItem("elev8-intro", "1"); } catch (e) {}

    root.classList.add("has-intro", "intro-on");   // has-intro : rythme de la page ; intro-on : voile affiché
    var done = false, t0 = Date.now();
    var end = function () {
      if (done) return; done = true;
      root.classList.remove("intro-on");
      ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { window.removeEventListener(ev, skip, true); });
    };
    var skip = function () {
      if (done || Date.now() - t0 > 950) return;  // après 0,95 s, la page apparaît déjà d'elle-même
      root.classList.add("intro-skip");          // fondu immédiat (0,25 s), la page s'affiche aussitôt
      setTimeout(end, 260);
    };
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { window.addEventListener(ev, skip, { capture: true, passive: true }); });
    setTimeout(end, 1750);                        // sécurité : l'introduction se termine toujours
  } catch (e) { root.classList.remove("intro-on"); }
})();
