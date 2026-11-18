/* ==========================================================================
   ELEV8 Private Driver — page /documents (devis et factures, réservée à ELEV8)
   --------------------------------------------------------------------------
   - Les informations de la demande arrivent dans l'adresse (#d=…), depuis le lien
     de l'e-mail de demande : rien n'est ressaisi. Sans lien, le formulaire est vide
     (devis ou facture pour une réservation prise par téléphone).
   - Les PDF sont produits par /api/documents, protégée par mot de passe.
   - Partage : bouton « Partager » du téléphone (WhatsApp, Mail… avec le PDF joint),
     envoi par e-mail au client (Brevo), ou téléchargement.
   ========================================================================== */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var API = "/api/documents";
  var C = window.SITE_CONFIG || {};
  var mdp = "";
  var dernier = null;                 // dernier document produit { type, numero, fichier, blob, url, total }

  /* ---------- Mot de passe (session, ou appareil si demandé) ---------- */
  var cleStockage = "elev8-docs-acces";
  try { mdp = sessionStorage.getItem(cleStockage) || localStorage.getItem(cleStockage) || ""; } catch (e) {}

  function appel(corps) {
    corps.motDePasse = mdp;
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return { ok: false, code: "reseau" }; }).then(function (j) { j.status = r.status; return j; }); })
      .catch(function () { return { ok: false, code: "reseau", message: "Connexion impossible. Vérifiez le réseau et réessayez." }; });
  }
  function ouvrir(premier) {
    $("#lockMsg").textContent = premier ? "" : "Vérification…";
    appel({ action: "verifier" }).then(function (j) {
      if (!j.ok) {
        try { sessionStorage.removeItem(cleStockage); localStorage.removeItem(cleStockage); } catch (e) {}
        $("#lock").hidden = false; $("#docForm").hidden = true;
        $("#lockMsg").textContent = premier && j.code === "acces" ? "" : (j.message || "Accès impossible.");
        return;
      }
      $("#lock").hidden = true; $("#docForm").hidden = false;
      var m = j.emetteurIncomplet || [];
      $("#emetteurMsg").hidden = !m.length;
      if (m.length) $("#emetteurMsg").textContent = "Avant de produire un devis ou une facture, complétez dans public/config.js (rubrique legal) : " + m.join(" ; ") + ".";
    });
  }
  $("#lockForm").addEventListener("submit", function (e) {
    e.preventDefault();
    mdp = $("#d-mdp").value;
    try { ($("#d-souvenir").checked ? localStorage : sessionStorage).setItem(cleStockage, mdp); } catch (err) {}
    ouvrir(false);
  });
  if (mdp) ouvrir(true);

  /* ---------- Préremplissage depuis le lien de l'e-mail ---------- */
  function lireLien() {
    var m = /[#&]d=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    try {
      var b = m[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      var bin = atob(b), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  var today = (function () { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); })();
  var D = lireLien();
  var set = function (id, v) { if (v != null && v !== "") $(id).value = v; };
  if (D) {
    var c = D.client || {}, p = D.prestation || {};
    set("#d-ref", D.ref); set("#d-prenom", c.prenom); set("#d-nom", c.nom); set("#d-societe", c.societe);
    set("#d-email", c.email); set("#d-tel", c.telephone);
    set("#d-date", p.date); set("#d-heure", p.heure); set("#d-depart", p.depart); set("#d-destination", p.destination);
    $("#d-ar").checked = !!p.allerRetour; set("#d-dateretour", p.dateRetour); set("#d-heureretour", p.heureRetour);
    if (/classe\s*v/i.test(p.vehicule || "")) $("#d-vehicule").value = "Mercedes-Benz Classe V";
    set("#d-distance", p.distanceKm); set("#d-pax", p.passagers); set("#d-bagages", p.bagages);
    set("#d-volref", p.reference); set("#d-precisions", p.precisions);
    if (D.montant > 0) set("#d-montant", String(D.montant).replace(".", ","));
    $("#estimMsg").textContent = D.montant > 0 ? "Estimation affichée au client : " + String(D.montant).replace(".", ",") + " €. Modifiez ce montant si vous proposez un tarif ajusté."
      : "Aucune estimation automatique (trajet sur devis) : indiquez le tarif.";
    $("#sourceMsg").textContent = "Informations reprises de la demande " + (D.ref || "") + (D.recu ? ", reçue le " + D.recu : "") + ". Complétez ce qui manque, notamment l'adresse de facturation.";
    set("#d-dateprestation", p.date);
  } else {
    // Document hors site (réservation par téléphone…) : référence créée automatiquement
    var r = "E8-M-" + today.slice(2).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    set("#d-ref", r); set("#d-pax", 1); set("#d-dateprestation", today);
    $("#sourceMsg").textContent = "Document sans demande associée : renseignez les informations du client et de la prestation.";
  }
  set("#d-datepaiement", today);

  /* ---------- Affichage conditionnel ---------- */
  function majAffichage() {
    $$("[data-ar]").forEach(function (el) { el.hidden = !$("#d-ar").checked; });
    var paye = $("#d-paye").checked;
    $$("[data-paye]").forEach(function (el) { el.hidden = !paye; });
    $$("[data-nonpaye]").forEach(function (el) { el.hidden = paye; });
  }
  ["#d-ar", "#d-paye"].forEach(function (s) { $(s).addEventListener("change", majAffichage); });
  majAffichage();

  /* ---------- Données du document ---------- */
  var v = function (id) { return $(id).value.trim(); };
  function donnees() {
    return {
      ref: v("#d-ref"),
      client: { prenom: v("#d-prenom"), nom: v("#d-nom"), societe: v("#d-societe"), adresse: v("#d-adresse"),
        siren: v("#d-siren"), tvaIntra: v("#d-tvaintra"), email: v("#d-email"), telephone: v("#d-tel") },
      prestation: { designation: v("#d-designation"), date: v("#d-date"), heure: v("#d-heure"), depart: v("#d-depart"), destination: v("#d-destination"),
        allerRetour: $("#d-ar").checked, dateRetour: v("#d-dateretour"), heureRetour: v("#d-heureretour"), vehicule: v("#d-vehicule"),
        passagers: v("#d-pax"), bagages: v("#d-bagages"), precisions: v("#d-precisions"), reference: v("#d-volref"), distanceKm: v("#d-distance") },
      montant: v("#d-montant").replace(/\s|€/g, "").replace(",", "."),
      supplements: $$("[data-sup]").map(function (r) { var i = r.querySelectorAll("input"); return { libelle: i[0].value.trim(), montant: i[1].value.replace(/\s|€/g, "").replace(",", ".") }; })
        .filter(function (x) { return x.libelle && parseFloat(x.montant) > 0; }),
      devis: { valide: $("#d-valide").checked, validiteJours: v("#d-validite") },
      facture: { datePrestation: v("#d-dateprestation"), paye: $("#d-paye").checked, datePaiement: v("#d-datepaiement"),
        modePaiement: v("#d-mode"), echeanceJours: v("#d-echeance") }
    };
  }
  var CHAMPS = { "ref": "#d-ref", "client.nom": "#d-nom", "client.adresse": "#d-adresse", "prestation.designation": "#d-depart",
    "montant": "#d-montant", "facture.datePrestation": "#d-dateprestation", "facture.paiement": "#d-datepaiement" };
  var LIBELLES = { "ref": "référence", "client.nom": "nom ou société du client", "client.adresse": "adresse de facturation",
    "prestation.designation": "départ et destination (ou désignation)", "montant": "prix", "facture.datePrestation": "date de la prestation",
    "facture.paiement": "date et mode du paiement" };
  function erreur(j) {
    $$(".docs .field.is-invalid").forEach(function (f) { f.classList.remove("is-invalid"); });
    if (j.code === "champs" && j.champs) {
      j.champs.forEach(function (k) { var el = $(CHAMPS[k] || "#d-ref"); if (el) el.closest(".field").classList.add("is-invalid"); });
      var premier = $(CHAMPS[j.champs[0]] || "#d-ref"); if (premier) premier.focus();
      return "À compléter : " + j.champs.map(function (k) { return LIBELLES[k] || k; }).join(", ") + ".";
    }
    if (j.code === "acces") { $("#lock").hidden = false; $("#docForm").hidden = true; }
    return j.message || "Opération impossible pour le moment. Réessayez.";
  }

  /* ---------- Production ---------- */
  var occupe = false;
  function produire(type) {
    if (occupe) return;
    occupe = true;
    var btn = type === "facture" ? $("#btnFactureOk") : $("#btnDevis");
    btn.disabled = true; btn.setAttribute("aria-busy", "true");
    $("#formMsg").textContent = type === "facture" ? "Émission de la facture…" : "Préparation du devis…";
    appel({ action: type, doc: donnees() }).then(function (j) {
      occupe = false; btn.disabled = false; btn.removeAttribute("aria-busy");
      $("#confirmFacture").hidden = true;
      if (!j.ok || !j.pdf) { $("#formMsg").textContent = erreur(j); return; }
      $("#formMsg").textContent = "";
      var bin = atob(j.pdf), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (dernier && dernier.url) URL.revokeObjectURL(dernier.url);
      var blob = new Blob([bytes], { type: "application/pdf" });
      dernier = { type: type, numero: j.numero, fichier: j.fichier, blob: blob, url: URL.createObjectURL(blob), total: j.total };
      afficherResultat(j);
    });
  }
  /* Total affiché (trajet + suppléments) */
  function total() {
    var d = donnees(), t = (parseFloat(d.montant) || 0);
    d.supplements.forEach(function (x) { t += parseFloat(x.montant) || 0; });
    return Math.round(t * 100) / 100;
  }
  function majTotal() {
    var d = donnees();
    $("#totalMsg").textContent = d.supplements.length ? "Total TTC avec suppléments : " + fmt(total()) : "";
  }
  $("#d-montant").addEventListener("input", majTotal);
  $$("[data-sup] input").forEach(function (i) { i.addEventListener("input", majTotal); });
  $("#btnDevis").addEventListener("click", function () { produire("devis"); });
  $("#btnFacture").addEventListener("click", function () {
    var d = donnees();
    $("#confirmMontant").textContent = total() > 0 ? fmt(total()) + " TTC" : "? €";
    $("#confirmClient").textContent = d.client.societe || [d.client.prenom, d.client.nom].join(" ").trim() || "ce client";
    $("#confirmFacture").hidden = false;
    $("#btnFactureOk").focus();
  });
  $("#btnFactureOk").addEventListener("click", function () { produire("facture"); });
  $("#btnFactureNon").addEventListener("click", function () { $("#confirmFacture").hidden = true; });

  var fmt = function (n) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €"; };
  function afficherResultat(j) {
    var d = donnees(), devis = j.type === "devis";
    var provisoire = devis && !d.devis.valide;
    $("#resEyebrow").textContent = devis ? (provisoire ? "Devis provisoire" : "Devis") : (j.deja ? "Facture déjà émise" : "Facture émise");
    $("#resTitre").textContent = (devis ? "Devis " : "Facture ") + j.numero;
    $("#resInfo").textContent = (devis ? "Montant : " : "Montant facturé : ") + fmt(j.total) +
      (j.deja ? ". Cette facture avait déjà été émise le " + j.dateEmission.split("-").reverse().join("/") + " : elle est renvoyée à l'identique (une facture ne se modifie pas)." : ".");
    $("#resOuvrir").href = dernier.url;
    $("#resTelecharger").href = dernier.url; $("#resTelecharger").setAttribute("download", dernier.fichier);
    var fichier = null;
    try { fichier = new File([dernier.blob], dernier.fichier, { type: "application/pdf" }); } catch (e) {}
    $("#resPartager").hidden = !(fichier && navigator.canShare && navigator.canShare({ files: [fichier] }));
    $("#d-dest").value = d.client.email || "";
    var tel = (d.client.telephone || "").replace(/[^\d+]/g, "");
    if (/^0\d{9}$/.test(tel)) tel = "+33" + tel.slice(1);
    var texte = "Bonjour " + (d.client.prenom || "") + ",\n\nVoici votre " + (devis ? (provisoire ? "devis provisoire" : "devis") : "facture") + " " + j.numero +
      " ELEV8 Private Driver, d'un montant de " + fmt(j.total) + "." + (devis ? (provisoire ? "\nCe tarif reste à confirmer après vérification de la disponibilité." : "\nPour l'accepter, répondez simplement « J'accepte ».") : "\nMerci pour votre confiance.") + "\n\nELEV8 Private Driver";
    dernier.texte = texte;
    var waNum = tel.replace(/\D/g, "");
    $("#resWhatsApp").hidden = !waNum;
    $("#resWhatsApp").href = "https://wa.me/" + waNum + "?text=" + encodeURIComponent(texte);
    $("#resMsg").textContent = "";
    $("#docForm").hidden = true; $("#result").hidden = false;
    $("#result").scrollIntoView({ block: "start" }); $("#result").focus({ preventScroll: true });
  }
  $("#resPartager").addEventListener("click", function () {
    if (!dernier) return;
    var fichier = new File([dernier.blob], dernier.fichier, { type: "application/pdf" });
    navigator.share({ files: [fichier], title: dernier.fichier, text: dernier.texte }).catch(function () {});
  });
  $("#resEnvoyer").addEventListener("click", function () {
    if (!dernier) return;
    var btn = $("#resEnvoyer"); if (btn.disabled) return;
    btn.disabled = true; $("#resMsg").textContent = "Envoi en cours…";
    appel({ action: "envoyer", type: dernier.type, doc: donnees(), destinataire: v("#d-dest") }).then(function (j) {
      btn.disabled = false;
      $("#resMsg").textContent = j.ok ? "Envoyé à " + j.envoye + " (copie à ELEV8)." : (j.message || "Envoi impossible. Téléchargez le PDF et envoyez-le vous-même.");
    });
  });
  $("#resRetour").addEventListener("click", function () { $("#result").hidden = true; $("#docForm").hidden = false; });
})();
