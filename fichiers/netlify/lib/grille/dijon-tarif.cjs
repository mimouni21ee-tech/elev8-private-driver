/* ==========================================================================
   ELEV8 Private Driver — moteur de devis Dijon (v8 · grille officielle du 12 nov. 2026)
   --------------------------------------------------------------------------
   Fonction pure, sans dépendance : le même fichier sert côté serveur
   (fonction « devis-dijon », seule à faire foi avant tout paiement) et, dans
   le prototype, dans le navigateur pour simuler la réponse du serveur.

   TRAJETS CLASSIQUES (chaque trajet d'un aller-retour est calculé séparément)
     prix = max(minimum de la catégorie et de la période, distance_routière_km × tarif_km_applicable)
     - tarif de jour : lundi → samedi, 7 h 00 → 18 h 59, hors jours fériés ;
     - tarif majoré : 19 h 00 → 6 h 59, dimanche toute la journée, jours fériés
       français toute la journée (calculés pour chaque année, Pâques compris) ;
     - heure locale de prise en charge, fuseau Europe/Paris (heures d'été/hiver) ;
     - aucune autre majoration ; le minimum inclut les premiers kilomètres.
     Kilomètres hors charge (approche, retour à vide) : mesurés et transmis pour les
     simulations internes, JAMAIS facturés en supplément (pas de double facturation).
     Course hors de la zone de référence = « longue distance » : sur devis, sans
     paiement en ligne tant que ses règles ne sont pas validées.

   MISE À DISPOSITION
     prix = heures × tarif_horaire + max(0, km_estimés − km_inclus) × prix_km_sup
     (grille des trajets et majorations jamais appliquées)

   Montants au centime (arrondi commercial) ; acompte au centime.
   ========================================================================== */
(function (root) {
  "use strict";

  var r2 = function (n) { return Math.round((n + 1e-9) * 100) / 100; };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function minutes(hhmm) { var p = String(hhmm).split(":"); return (+p[0]) * 60 + (+p[1] || 0); }

  /* ---------- Jours fériés français (calculés, jamais une liste figée) ---------- */
  function paques(an) {                         // algorithme de Meeus / Jones / Butcher (calendrier grégorien)
    var a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(an, mois - 1, jour));
  }
  var cacheFeries = {};
  function joursFeries(an, alsaceMoselle) {
    var cle = an + (alsaceMoselle ? "am" : "");
    if (cacheFeries[cle]) return cacheFeries[cle];
    var f = {}, add = function (d, nom) { f[pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate())] = nom; };
    var fixe = function (m, j, nom) { add(new Date(Date.UTC(an, m - 1, j)), nom); };
    var p = paques(an), plus = function (n) { return new Date(p.getTime() + n * 864e5); };
    fixe(1, 1, "Jour de l'an"); fixe(5, 1, "Fête du Travail"); fixe(5, 8, "Victoire 1945"); fixe(7, 14, "Fête nationale");
    fixe(8, 15, "Assomption"); fixe(11, 1, "Toussaint"); fixe(11, 11, "Armistice 1918"); fixe(12, 25, "Noël");
    add(plus(1), "Lundi de Pâques"); add(plus(39), "Ascension"); add(plus(50), "Lundi de Pentecôte");
    if (alsaceMoselle) { add(plus(-2), "Vendredi saint"); fixe(12, 26, "Saint-Étienne"); }
    return (cacheFeries[cle] = f);
  }

  /* ---------- Heure locale de prise en charge (Europe/Paris) ----------
     « AAAA-MM-JJTHH:MM » sans fuseau = heure locale saisie par le client (déjà l'heure de Paris).
     Un instant avec fuseau (ex. « …Z » ou Date) est converti en heure de Paris, été comme hiver. */
  function heureLocale(depart, fuseau) {
    var s = typeof depart === "string" ? depart : "";
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
    if (m) return { an: +m[1], mois: +m[2], jour: +m[3], h: +m[4], min: +m[5] };
    var d = depart instanceof Date ? depart : new Date(depart);
    var parts = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: fuseau || "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    return { an: +parts.year, mois: +parts.month, jour: +parts.day, h: +parts.hour % 24, min: +parts.minute };
  }

  /* Tarif applicable : { majore, motif: "jour" | "nuit" | "dimanche" | "ferie", ferie } */
  function periodeTarifaire(depart, T) {
    var L = heureLocale(depart, T.fuseau);
    var jourSemaine = new Date(Date.UTC(L.an, L.mois - 1, L.jour)).getUTCDay();   // 0 = dimanche
    var ferie = T.majoreJoursFeries ? joursFeries(L.an, T.feriesAlsaceMoselle)[pad(L.mois) + "-" + pad(L.jour)] : null;
    var t = L.h * 60 + L.min, deJour = t >= minutes(T.jour.debut) && t < minutes(T.jour.fin);
    if (ferie) return { majore: true, motif: "ferie", ferie: ferie, local: L };
    if (T.majoreDimanche && jourSemaine === 0) return { majore: true, motif: "dimanche", local: L };
    if (!deJour) return { majore: true, motif: "nuit", local: L };
    return { majore: false, motif: "jour", local: L };
  }
  var MOTIF = { jour: "tarif de jour", nuit: "tarif de nuit", dimanche: "tarif dimanche", ferie: "tarif jour férié" };
  function libelleMotif(p) { return MOTIF[p.motif] + (p.ferie ? " (" + p.ferie + ")" : ""); }
  function euros(n) { return String(n.toFixed(2)).replace(".", ","); }

  function acompte(total, a) {
    var v = Math.min(total, Math.max(r2(total * a.taux), a.minimum));
    return { total: r2(total), acompte: r2(v), solde: r2(total - v) };
  }
  function somme(lignes) { return r2(lignes.reduce(function (s, l) { return s + (l.montant || 0); }, 0)); }
  function fraisLignes(g) { return (g.frais || []).map(function (f) { return { id: "frais", libelle: f.libelle, montant: r2(f.montant || 0) }; }); }

  /* ---------- Trajets classiques ---------- */
  function calculerTrajets(entree, g) {
    var T = g.trajets, H = T.horsCharge || {}, pas = T.arrondiDistanceKm || 0.1;
    var cats = { confort: [], van: [] }, legs = [], partiel = false;
    entree.trajets.forEach(function (leg, i) {
      var km = Math.round(leg.distanceKm / pas) * pas; km = Math.round(km * 10) / 10;
      var per = periodeTarifaire(leg.depart, T);
      var app = Math.max(0, +leg.distance_approche_km || 0), ret = Math.max(0, +leg.distance_retour_vide_km || 0);
      if ((app || ret) && !(T.longueDistance && T.longueDistance.reservableEnLigne)) partiel = true;   // sur devis
      var lib = i ? "Trajet retour" : (entree.trajets.length > 1 ? "Trajet aller" : "Trajet");
      var info = { distance_en_charge_km: km, distance_approche_km: app, distance_retour_vide_km: ret, periode: per.motif, ferie: per.ferie || null, depart: leg.depart, dureeMin: leg.dureeMin, tarifs: {} };
      ["confort", "van"].forEach(function (k) {
        var periode = per.majore ? "majore" : "jour";
        var tarif = T.tarifKm[k][periode], brut = r2(km * tarif);
        var min = typeof T.minimum[k] === "number" ? T.minimum[k] : T.minimum[k][periode];   // minimum selon la période (grille officielle)
        var prix = Math.max(min, brut);
        info.tarifs[k] = { tarif_km: tarif, montant_km: brut, minimum: min, minimum_applique: brut < min, prix: prix };
        cats[k].push({ id: i ? "retour" : "aller", libelle: lib, montant: prix,
          detail: String(km).replace(".", ",") + " km × " + euros(tarif) + " € · " + libelleMotif(per) + (brut < min ? " → minimum " + min + " € appliqué" : "") });
      });
      legs.push(info);
    });
    var out = {};
    ["confort", "van"].forEach(function (k) {
      var lignes = cats[k].concat(fraisLignes(g));
      out[k] = acompte(somme(lignes), g.acompte); out[k].lignes = lignes;
    });
    out.van.supplement = r2(out.van.total - out.confort.total);
    return {
      type: entree.type || "simple", legs: legs, partiel: partiel,
      distanceKm: legs.reduce(function (s, l) { return s + l.distance_en_charge_km; }, 0),
      dureeMin: entree.trajets.reduce(function (s, l) { return s + (l.dureeMin || 0); }, 0),
      categories: out, conditions: []
    };
  }

  /* ---------- Mise à disposition (inchangée, sans majoration) ---------- */
  function calculerMAD(entree, g) {
    var M = g.miseADisposition;
    var h = Math.max(M.dureeMinimumHeures, +entree.heures || 0);
    var km = Math.max(0, Math.round(+entree.kmEstimes || 0));
    var inclus = Math.round(M.kmInclusParHeure * h);
    var sup = Math.max(0, km - inclus);                       // seuls les km au-delà du forfait sont facturés
    var hTxt = (h % 1 ? Math.floor(h) + " h 30" : h + " h");
    var out = {};
    ["confort", "van"].forEach(function (k) {
      var taux = M.tarifHoraire[k];
      var lignes = [
        { id: "forfait", libelle: "Mise à disposition · " + hTxt, montant: r2(h * taux), detail: taux + " € / h · chauffeur et attente sur place compris" },
        { id: "km_inclus", libelle: "Kilomètres inclus", montant: 0, detail: inclus + " km compris dans le forfait", inclus: true }
      ];
      if (sup) lignes.push({ id: "km_sup", libelle: "Kilomètres supplémentaires estimés", montant: r2(sup * M.prixKmSupplementaire), detail: sup + " km × " + euros(M.prixKmSupplementaire) + " €" });
      lignes = lignes.concat(fraisLignes(g));
      out[k] = acompte(somme(lignes), g.acompte); out[k].lignes = lignes;
      out[k].tarifHoraire = taux;
      out[k].depassementTranche = r2(taux * M.depassement.trancheMinutes / 60);
    });
    out.van.supplement = r2(out.van.total - out.confort.total);
    return {
      type: "mad", heures: h, kmEstimes: km, kmInclus: inclus, kmSupplementaires: sup, partiel: false,
      prixKmSupplementaire: M.prixKmSupplementaire, trancheMinutes: M.depassement.trancheMinutes,
      categories: out,
      conditions: [
        "Heure supplémentaire : tarif horaire de la catégorie, par tranche de " + M.depassement.trancheMinutes + " min entamée.",
        "Kilomètre au-delà du forfait : " + euros(M.prixKmSupplementaire) + " €.",
        M.depassement.peagesStationnement + "."
      ]
    };
  }

  function depassementMAD(reel, devis, g) {
    var M = g.miseADisposition, cat = devis.categories[reel.categorie];
    var minSup = Math.max(0, (reel.minutesReelles || 0) - devis.heures * 60);
    var tranches = Math.ceil(minSup / M.depassement.trancheMinutes);
    var kmSup = Math.max(0, (reel.kmReels || 0) - Math.max(devis.kmInclus, devis.kmEstimes));
    return { heures: r2(tranches * cat.depassementTranche), km: r2(kmSup * M.prixKmSupplementaire), peagesStationnement: r2(reel.fraisJustifies || 0) };
  }

  function calculer(entree, g) {
    if (!entree) throw new Error("demande vide");
    var q = entree.type === "mad" ? calculerMAD(entree, g) : calculerTrajets(entree, g);
    q.statut = g.statut; q.devise = g.devise;
    return q;
  }

  var api = { calculer: calculer, calculerTrajets: calculerTrajets, calculerMAD: calculerMAD, depassementMAD: depassementMAD,
              periodeTarifaire: periodeTarifaire, libelleMotif: libelleMotif, joursFeries: joursFeries, paques: paques, heureLocale: heureLocale };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ELEV8_TARIF = api;
})(this);
