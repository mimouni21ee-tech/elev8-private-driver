/* Mode « passager à bord » : activé par le QR code des véhicules (?bord=1).
   Chargé dans <head> pour choisir la bonne mise en page avant l'affichage (aucun clignotement). */
(function () {
  try {
    if (window.ELEV8_FORCE_BORD || /[?&]bord=1(&|$)/.test(location.search) || location.hash === "#bord") {
      document.documentElement.classList.add("is-bord");
    }
  } catch (e) {}
})();
