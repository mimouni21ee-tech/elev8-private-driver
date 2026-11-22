/* ==========================================================================
   ELEV8 Private Driver — consentement cookies et mesure Google Ads
   --------------------------------------------------------------------------
   Rien ne se passe tant que suivi.googleAds.id est vide dans config.js :
   aucun bandeau, aucune balise, aucun cookie.

   Une fois l'identifiant renseigné (« AW-… ») :
     - un bandeau demande l'accord du visiteur (« Tout refuser » / « Accepter »,
       même présentation, conformément aux recommandations de la CNIL) ;
     - la balise Google (gtag.js) n'est chargée QU'APRÈS « Accepter »
       (Consent Mode v2, mode « basique » : aucun appel à Google avant l'accord) ;
     - la personnalisation publicitaire reste refusée (pas de remarketing) ;
     - le choix est mémorisé dans le navigateur (localStorage) pour 6 mois,
       puis redemandé ; le lien « Gestion des cookies » permet d'en changer.

   Conversions envoyées (uniquement après accord, sans aucune donnée personnelle) :
     elev8_demande_envoyee → conversionDemande (valeur = estimation, ou valeurParDefaut si « sur devis »,
                             référence de la demande en transaction_id pour éviter les doublons)
     elev8_clic_appel      → conversionAppel     (facultatif)
     elev8_clic_whatsapp   → conversionWhatsApp  (facultatif)
   Les événements proviennent de reservation.js (événement navigateur « elev8:suivi »).
   ========================================================================== */
(function () {
  "use strict";
  var C = window.SITE_CONFIG || {};
  var G = (C.suivi && C.suivi.googleAds) || {};
  var ID = String(G.id || "").trim();
  if (!/^AW-\d{6,14}$/.test(ID)) return;                  // pas d'identifiant valide : le site reste sans cookie

  var CLE = "elev8_consentement", VERSION = 1;
  var DUREE = Math.max(1, Number(G.dureeConsentementJours) || 182) * 864e5;
  var label = function (v) { v = String(v || "").trim(); return /^[A-Za-z0-9_-]{4,64}$/.test(v) ? v : ""; };
  var LABELS = {
    elev8_demande_envoyee: label(G.conversionDemande),
    elev8_clic_appel: label(G.conversionAppel),
    elev8_clic_whatsapp: label(G.conversionWhatsApp)
  };
  var DEFAUT = Number(G.valeurParDefaut) > 0 ? Number(G.valeurParDefaut) : 0;

  var etat = null;            // "accepte" | "refuse" | null (pas encore de choix)
  var charge = false;         // balise Google déjà chargée sur cette page
  var enAttente = [];         // conversions survenues avant le choix (envoyées seulement si « Accepter »)

  /* ---------- Mémoire du choix ---------- */
  function lire() {
    try {
      var c = JSON.parse(localStorage.getItem(CLE) || "null");
      if (!c || c.v !== VERSION || (c.choix !== "accepte" && c.choix !== "refuse")) return null;
      if (!(Date.now() - Number(c.t) < DUREE)) { localStorage.removeItem(CLE); return null; }
      return c.choix;
    } catch (e) { return null; }
  }
  function ecrire(choix) {
    try { localStorage.setItem(CLE, JSON.stringify({ v: VERSION, choix: choix, t: Date.now() })); } catch (e) {}
  }

  /* ---------- Balise Google (chargée uniquement après accord) ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  function charger() {
    if (charge) return;
    charge = true;
    window.gtag = gtag;
    gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
    gtag("consent", "update", { ad_storage: "granted", ad_user_data: "granted" });
    gtag("js", new Date());
    gtag("config", ID, { allow_ad_personalization_signals: false, allow_google_signals: false });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID);
    s.setAttribute("data-elev8-gtag", "");
    document.head.appendChild(s);
  }
  function supprimerCookiesGoogle() {
    var hotes = [location.hostname], parties = location.hostname.split(".");
    if (parties.length > 2) hotes.push(parties.slice(-2).join("."));
    (document.cookie || "").split(";").forEach(function (c) {
      var nom = c.split("=")[0].trim();
      if (!/^_gcl_|^_gac_|^FPGCL/.test(nom)) return;
      document.cookie = nom + "=; Max-Age=0; path=/";
      hotes.forEach(function (h) { document.cookie = nom + "=; Max-Age=0; path=/; domain=." + h; });
    });
  }

  /* ---------- Conversions ---------- */
  function envoyer(p) { if (etat === "accepte" && charge) gtag("event", "conversion", p); }
  document.addEventListener("elev8:suivi", function (e) {
    var d = (e && e.detail) || {}, lab = LABELS[d.event];
    if (!lab) return;
    var p = { send_to: ID + "/" + lab };
    if (d.event === "elev8_demande_envoyee") {
      var v = Number(d.value) > 0 ? Number(d.value) : DEFAUT;
      if (v > 0) { p.value = Math.round(v * 100) / 100; p.currency = "EUR"; }
      if (d.elev8_reference) p.transaction_id = String(d.elev8_reference);
    }
    if (etat === "accepte") envoyer(p);
    else if (etat === null) enAttente.push(p);
  });

  /* ---------- Bandeau ---------- */
  var bandeau = null;
  var lienConf = "/confidentialite.html#cookies";
  function fermer() { if (bandeau) { bandeau.hidden = true; } }
  function choisir(choix) {
    var avant = etat;
    etat = choix; ecrire(choix); fermer();
    if (choix === "accepte") {
      charger();
      enAttente.splice(0).forEach(envoyer);
    } else {
      enAttente = [];
      if (charge) gtag("consent", "update", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      supprimerCookiesGoogle();
      if (avant === "accepte" && charge) { try { location.reload(); } catch (e) {} }   // décharge la balise
    }
    try { document.dispatchEvent(new CustomEvent("elev8:consentement", { detail: { choix: choix } })); } catch (e) {}
  }
  function ouvrir() {
    if (!bandeau) {
      bandeau = document.createElement("div");
      bandeau.className = "consent";
      bandeau.setAttribute("role", "dialog");
      bandeau.setAttribute("aria-live", "polite");
      bandeau.setAttribute("aria-labelledby", "consentTitre");
      bandeau.setAttribute("aria-describedby", "consentTexte");
      bandeau.innerHTML =
        '<div class="consent__in">' +
          '<p class="consent__titre" id="consentTitre">Mesure de nos annonces</p>' +
          '<p class="consent__texte" id="consentTexte">Avec votre accord, ELEV8 utilise des cookies Google Ads pour savoir quelles annonces ' +
          'amènent des demandes de réservation. Aucune publicité personnalisée ne vous est proposée à partir de ce site, ' +
          'et vous pouvez changer d’avis à tout moment (« Gestion des cookies »). ' +
          '<a href="' + lienConf + '">En savoir plus</a></p>' +
          '<div class="consent__btns">' +
            '<button type="button" class="consent__btn" data-consent="refuse">Tout refuser</button>' +
            '<button type="button" class="consent__btn" data-consent="accepte">Accepter</button>' +
          '</div>' +
        '</div>';
      bandeau.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-consent]") : null;
        if (b) choisir(b.getAttribute("data-consent"));
      });
      document.body.appendChild(bandeau);
    }
    bandeau.hidden = false;
  }

  function demarrer() {
    // Liens « Gestion des cookies » (pied de page, politique de confidentialité)
    Array.prototype.forEach.call(document.querySelectorAll("[data-cookies]"), function (a) {
      a.hidden = false;
      a.addEventListener("click", function (e) { e.preventDefault(); ouvrir(); });
    });
    etat = lire();
    if (etat === "accepte") charger();
    else if (etat === null) ouvrir();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();

  // Accès pour les tests et le dépannage (aucune donnée personnelle)
  window.ELEV8_CONSENTEMENT = { etat: function () { return etat; }, ouvrir: ouvrir };
})();
