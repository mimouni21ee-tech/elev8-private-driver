/* ==========================================================================
   ELEV8 Private Driver — page /documents (devis et factures, réservée à ELEV8)
   --------------------------------------------------------------------------
   - Les informations de la demande arrivent dans l'adresse (#d=…), depuis le lien
     de l'e-mail de demande : rien n'est ressaisi. Sans lien, le formulaire est vide
     (devis ou facture pour une réservation prise par téléphone).
   - Les PDF sont produits par la fonction Netlify /documents-api, protégée par mot de passe.
   - Partage : bouton « Partager » du téléphone (WhatsApp, Mail… avec le PDF joint),
     envoi par e-mail au client (Brevo), ou téléchargement.
   ========================================================================== */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var API = "/documents-api";      // surtout pas sous /api/ : netlify.toml y renvoie tout en 404
  var C = window.SITE_CONFIG || {};
  var mdp = "";
  var dernier = null;                 // dernier document produit { type, numero, fichier, blob, url, total }

  /* ---------- Mot de passe (session, ou appareil si demandé) ---------- */
  var cleStockage = "elev8-docs-acces";
  try { mdp = sessionStorage.getItem(cleStockage) || localStorage.getItem(cleStockage) || ""; } catch (e) {}

  function appel(corps) {
    corps.motDePasse = mdp;
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () {
          // Réponse qui n'est pas celle de la fonction (page 404, erreur Netlify…) : on affiche le code HTTP
          return { ok: false, code: "reponse", message: "Le service des documents ne répond pas correctement (erreur " + r.status + "). Vérifiez que le dernier déploiement Netlify est publié, puis réessayez." };
        }).then(function (j) { j.status = r.status; return j; });
      })
      .catch(function () { return { ok: false, code: "reseau", message: "Connexion impossible. Vérifiez le réseau et réessayez." }; });
  }
  function ouvrir(premier) {
    $("#lockMsg").textContent = premier ? "" : "Vérification…";
    appel({ action: "verifier" }).then(function (j) {
      if (!j.ok) {
        try { sessionStorage.removeItem(cleStockage); localStorage.removeItem(cleStockage); } catch (e) {}
        $("#lock").hidden = false; $("#docForm").hidden = true;
        $("#lockMsg").textContent = premier && j.code === "acces" ? "" : (j.message || ("Accès impossible (erreur " + (j.status || "réseau") + ")."));
        return;
      }
      $("#lock").hidden = true; $("#docForm").hidden = false;
      if (/[#&]etape=validation/.test(location.hash)) $("#validation").scrollIntoView({ block: "start" });
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
    // Catégorie de véhicule (anciennes et nouvelles appellations)
    var vSel = $("#d-vehicule");
    vSel.value = vSel.options[/classe\s*v|\bvan\b/i.test(p.vehicule || "") ? 1 : 0].value;
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
        modePaiement: v("#d-mode"), referencePaiement: v("#d-refpaiement"), echeanceJours: v("#d-echeance") }
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
  if (C.legal && C.legal.facturation === "indy") {
    $("#btnFacture").disabled = true;
    $("#indyMsg").textContent = "Les factures sont établies dans Indy (réglage legal.facturation de config.js) : aucune facture n'est créée ici, pour éviter une double numérotation. Le devis reste disponible.";
  }
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

  /* ---------- Validation du tarif : message au client (e-mail et WhatsApp) ----------
     Rien n'est envoyé automatiquement : le message s'ouvre dans la messagerie ou dans WhatsApp,
     à relire et modifier. Le lien de paiement Indy n'est ajouté que s'il est renseigné ET vérifié.
     Un paiement ne confirme jamais la réservation : « Réservation confirmée » exige un règlement vérifié. */
  var estimInitiale = D && D.montant > 0 ? D.montant : null;
  var MARQUE = "ELEV8 Private Driver";
  var SITE = (C.site && C.site.url) || "https://elev8privatedriver.com";
  var MAIL_ELEV8 = (C.contact && C.contact.email) || "contact@elev8privatedriver.com";
  function lienValide(u) { return /^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(u) && u.length <= 500; }
  function majValidation() {
    var type = $("#v-type").value, lien = v("#v-lien");
    $$("[data-vt=validation]").forEach(function (el) { el.hidden = type === "reservation"; });
    $$("[data-vt=reservation]").forEach(function (el) { el.hidden = type !== "reservation"; });
    if (type !== "reservation") {
      $$("[data-lien]").forEach(function (el) { el.hidden = !lien; });
      $$("[data-sanslien]").forEach(function (el) { el.hidden = !!lien; });
    }
    $("#v-lien-montant").textContent = total() > 0 ? fmt(total()) : "—";
  }
  // Type proposé selon l'écart avec l'estimation (modifiable)
  function typeAuto() {
    if ($("#v-type").value === "reservation") return;
    var t = total();
    $("#v-type").value = estimInitiale && t > 0 && Math.abs(t - estimInitiale) >= 0.01 ? "ajuste" : "confirmation";
  }
  ["#v-type", "#v-lien"].forEach(function (s) { $(s).addEventListener("input", majValidation); $(s).addEventListener("change", majValidation); });
  $("#d-montant").addEventListener("input", function () { typeAuto(); majValidation(); });
  $$("[data-sup] input").forEach(function (i) { i.addEventListener("input", function () { typeAuto(); majValidation(); }); });
  typeAuto(); majValidation();

  function infos() {
    var d = donnees(), p = d.prestation;
    var heure = function (h) { return h ? h.replace(":", "h") : ""; };
    var dateLongue = function (iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
      var x = new Date(iso + "T12:00:00");
      return x.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    };
    return { d: d, p: p, prenom: d.client.prenom, ref: d.ref, date: dateLongue(p.date), heure: heure(p.heure),
      retour: p.allerRetour ? (dateLongue(p.dateRetour) + (p.heureRetour ? " à " + heure(p.heureRetour) : "")) : "",
      vehicule: p.vehicule, passagers: p.passagers, sup: d.supplements, total: total() };
  }
  function composer() {
    var type = $("#v-type").value, I = infos(), lien = v("#v-lien");
    var erreurs = [];
    if (!I.ref) erreurs.push("la référence");
    if (!(I.total > 0)) erreurs.push("le tarif (rubrique 3)");
    if (!I.p.date || !I.p.depart || !I.p.destination) erreurs.push("la date, le départ et la destination");
    if (type !== "reservation" && !$("#v-dispo").checked) erreurs.push("la case « disponibilité vérifiée »");
    if (type === "reservation" && !$("#v-regle").checked) erreurs.push("la case « règlement vérifié »");
    var lienOk = type !== "reservation" && lien && $("#v-lien-ok").checked && lienValide(lien);
    if (type !== "reservation" && lien && !lienValide(lien)) erreurs.push("un lien de paiement valide (commençant par https://)");
    if (type !== "reservation" && lien && lienValide(lien) && !$("#v-lien-ok").checked) erreurs.push("la case « lien vérifié » (ou videz le champ du lien)");
    if (erreurs.length) return { erreur: "À compléter avant de préparer le message : " + erreurs.join(", ") + "." };

    var bonjour = I.prenom ? "Bonjour " + I.prenom + "," : "Bonjour,";
    var montant = fmt(I.total) + " TTC";
    var lignes = ["Référence : " + I.ref, "Date : " + I.date, "Heure de prise en charge : " + I.heure,
      "Adresse de départ : " + I.p.depart, "Adresse de destination : " + I.p.destination];
    if (I.retour) lignes.push("Retour : " + I.retour + (I.p.destination && I.p.depart ? " (de " + I.p.destination + " à " + I.p.depart + ")" : ""));
    lignes.push("Véhicule : " + I.vehicule, "Passagers : " + (I.passagers || "—"));
    I.sup.forEach(function (x) { lignes.push("Supplément : " + x.libelle + " — " + fmt(parseFloat(x.montant)) + " TTC"); });
    var signature = "Cordialement,\n\n" + MARQUE + "\n" + MAIL_ELEV8 + "\n" + SITE;
    var objet, corps, wa;
    if (type === "reservation") {
      objet = MARQUE + " — Réservation confirmée | " + I.ref;
      corps = bonjour + "\n\nNous avons bien reçu votre règlement de " + montant + " et vous en remercions.\n\n" +
        "Votre réservation est définitivement confirmée :\n\n" + lignes.join("\n") + "\nMontant réglé : " + montant + "\n\n" +
        "Votre chauffeur vous attendra à l'adresse et à l'heure indiquées. Pour toute question ou modification, répondez simplement à ce message.\n\n" + signature;
      wa = bonjour + "\nVotre réservation ELEV8 Private Driver est confirmée. Règlement de " + montant + " bien reçu, merci.\n" +
        "Réf. " + I.ref + " · " + I.date + " à " + I.heure + "\nDépart : " + I.p.depart + "\nDestination : " + I.p.destination +
        (I.retour ? "\nRetour : " + I.retour : "") + "\n\n" + MARQUE;
    } else {
      var ajuste = type === "ajuste";
      var paiementMail, paiementWa;
      if (lienOk) {
        paiementMail = "Pour accepter ce tarif et finaliser votre réservation, vous pouvez procéder directement au paiement sécurisé :\n\n" + lien +
          "\n\nVotre réservation sera définitivement confirmée après vérification du règlement et réception de notre confirmation.";
        paiementWa = "Paiement sécurisé : " + lien + "\nVotre réservation sera confirmée après vérification du règlement.";
      } else if ($("#v-sanslien").value === "virement") {
        paiementMail = "Pour accepter ce tarif et finaliser votre réservation, il vous suffit de répondre « J'accepte » à ce message. Le règlement s'effectue par virement bancaire, selon les conditions convenues.\n\nVotre réservation sera définitivement confirmée à réception de votre accord et de notre confirmation.";
        paiementWa = "Pour accepter ce tarif, répondez simplement « J'accepte ». Règlement par virement bancaire, selon les conditions convenues.";
      } else {
        paiementMail = "Pour accepter ce tarif et finaliser votre réservation, il vous suffit de répondre « J'accepte » à ce message.\n\nVotre réservation sera définitivement confirmée à réception de votre accord et de notre confirmation.";
        paiementWa = "Pour accepter ce tarif, répondez simplement « J'accepte ».";
      }
      objet = MARQUE + " — Validation de votre trajet | " + I.ref;
      corps = bonjour + "\n\nMerci pour votre demande de réservation auprès d'" + MARQUE + ".\n\n" +
        (ajuste ? "Nous avons vérifié votre demande. Après vérification, le tarif a été ajusté ; voici les informations de votre trajet :"
                : "Nous avons vérifié votre demande et sommes heureux de vous confirmer les informations suivantes :") + "\n\n" +
        lignes.join("\n") + "\n\nTarif définitif : " + montant + (ajuste && estimInitiale ? " (estimation initiale : " + fmt(estimInitiale) + ")" : "") + "\n\n" +
        "Votre chauffeur est disponible pour cette prestation.\n\n" + paiementMail + "\n\n" +
        "Nous restons à votre disposition pour toute question.\n\n" + signature;
      wa = bonjour + "\n" + (ajuste ? "Après vérification, voici le tarif définitif de votre trajet ELEV8 Private Driver." : "Votre trajet ELEV8 Private Driver est validé, votre chauffeur est disponible.") +
        "\nRéf. " + I.ref + " · " + I.date + " à " + I.heure + "\nDépart : " + I.p.depart + "\nDestination : " + I.p.destination +
        (I.retour ? "\nRetour : " + I.retour : "") + "\nVéhicule : " + I.vehicule +
        "\nTarif définitif : " + montant + (ajuste && estimInitiale ? " (estimation : " + fmt(estimInitiale) + ")" : "") +
        "\n\n" + paiementWa + "\n\n" + MARQUE;
    }
    return { objet: objet, corps: corps, wa: wa };
  }
  function telWa() {
    var t = v("#d-tel").replace(/[^\d+]/g, "");
    if (/^0\d{9}$/.test(t)) t = "+33" + t.slice(1);
    return t.replace(/\D/g, "");
  }
  function majLiens() {
    var email = v("#d-email");
    var okMail = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(email);
    $("#m-dest").textContent = okMail ? "destinataire : " + email : "adresse e-mail du client absente : complétez-la (rubrique 1) ou utilisez WhatsApp";
    var a = $("#m-ouvrir");
    if (okMail) { a.href = "mailto:" + encodeURIComponent(email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent($("#m-objet").value) + "&body=" + encodeURIComponent($("#m-corps").value); a.removeAttribute("aria-disabled"); }
    else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
    var n = telWa(), w = $("#m-wa-ouvrir");
    if (n) { w.href = "https://wa.me/" + n + "?text=" + encodeURIComponent($("#m-wa").value); w.removeAttribute("aria-disabled"); }
    else { w.removeAttribute("href"); w.setAttribute("aria-disabled", "true"); }
  }
  $("#btnMessage").addEventListener("click", function () {
    var r = composer();
    if (r.erreur) { $("#apercu").hidden = true; $("#formMsg").textContent = r.erreur; return; }
    $("#formMsg").textContent = "";
    $("#m-objet").value = r.objet; $("#m-corps").value = r.corps; $("#m-wa").value = r.wa;
    $("#m-msg").textContent = "Relisez et modifiez si besoin, puis ouvrez l'e-mail ou WhatsApp : rien n'est envoyé automatiquement.";
    $("#apercu").hidden = false; majLiens();
    $("#apercu").scrollIntoView({ block: "start" });
  });
  ["#m-objet", "#m-corps", "#m-wa", "#d-email", "#d-tel"].forEach(function (s) { $(s).addEventListener("input", majLiens); });
  function copier(texte) {
    (navigator.clipboard ? navigator.clipboard.writeText(texte) : Promise.reject()).then(function () { $("#m-msg").textContent = "Copié."; },
      function () { $("#m-msg").textContent = "Copie impossible : sélectionnez le texte et copiez-le manuellement."; });
  }
  $("#m-copier").addEventListener("click", function () { copier("Objet : " + $("#m-objet").value + "\n\n" + $("#m-corps").value); });
  $("#m-wa-copier").addEventListener("click", function () { copier($("#m-wa").value); });
})();
