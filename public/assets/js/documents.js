/* ==========================================================================
   ELEV8 Private Driver — page /documents (devis et factures, réservée à ELEV8)
   --------------------------------------------------------------------------
   - Chaque demande du site est enregistrée côté serveur. Le lien de l'e-mail ne contient
     qu'un identifiant opaque (?r=…) : après connexion, la demande est chargée et préremplit
     tout (récapitulatif, tarif proposé). Une demande peut aussi être rouverte par sa référence.
     Sans demande, le formulaire reste disponible pour une saisie manuelle (réservation par téléphone…).
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
  var session = "";
  var dernier = null;                 // dernier document produit { type, numero, fichier, blob, url, total }

  /* ---------- Session d'administration (jeton signé ; le mot de passe n'est jamais conservé) ---------- */
  var cleStockage = "elev8-docs-session";
  try {
    localStorage.removeItem("elev8-docs-acces"); sessionStorage.removeItem("elev8-docs-acces");   // ancienne version : mot de passe stocké
    session = sessionStorage.getItem(cleStockage) || localStorage.getItem(cleStockage) || "";
  } catch (e) {}

  function appel(corps) {
    if (session && corps.action !== "connexion") corps.session = session;
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () {
          // Réponse qui n'est pas celle de la fonction (page 404, erreur Netlify…) : on affiche le code HTTP
          return { ok: false, code: "reponse", message: "Le service des documents ne répond pas correctement (erreur " + r.status + "). Vérifiez que le dernier déploiement Netlify est publié, puis réessayez." };
        }).then(function (j) { j.status = r.status; return j; });
      })
      .catch(function () { return { ok: false, code: "reseau", message: "Connexion impossible. Vérifiez le réseau et réessayez." }; });
  }
  function oublierSession() { session = ""; try { sessionStorage.removeItem(cleStockage); localStorage.removeItem(cleStockage); } catch (e) {} }
  function verrouiller(message) { $("#lock").hidden = false; $("#docForm").hidden = true; $("#result").hidden = true; $("#lockMsg").textContent = message || ""; }
  function apresConnexion(j) {
    $("#lock").hidden = true; $("#docForm").hidden = false;
    var m = j.emetteurIncomplet || [];
    $("#emetteurMsg").hidden = !m.length;
    if (m.length) $("#emetteurMsg").textContent = "Avant de produire un devis ou une facture, complétez dans public/config.js (rubrique legal) : " + m.join(" ; ") + ".";
    chargerDepuisLien();
  }
  $("#lockForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("#lockMsg").textContent = "Vérification…";
    var garder = $("#d-souvenir").checked;
    appel({ action: "connexion", motDePasse: $("#d-mdp").value, resterConnecte: garder }).then(function (j) {
      $("#d-mdp").value = "";
      if (!j.ok || !j.session) { oublierSession(); verrouiller(j.message || ("Accès impossible (erreur " + (j.status || "réseau") + ").")); return; }
      session = j.session;
      try { (garder ? localStorage : sessionStorage).setItem(cleStockage, session); } catch (err) {}
      apresConnexion(j);
    });
  });
  if (session) appel({ action: "verifier" }).then(function (j) {
    if (!j.ok) { oublierSession(); verrouiller(j.code === "acces" ? "" : j.message); return; }
    apresConnexion(j);
  });

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
  var set = function (id, v) { $(id).value = v == null ? "" : v; };
  var estimInitiale = null;           // estimation affichée au client (proposition de départ du tarif)
  var demandeChargee = null;

  /* Remplit tout le formulaire à partir d'une demande (enregistrée côté serveur, ou ancien lien #d=) */
  function remplir(D, facture) {
    var c = D.client || {}, p = D.prestation || {}, e = D.estimation || null;
    var montant = e ? e.montant : D.montant, distance = e ? e.distanceKm : p.distanceKm;
    demandeChargee = D; estimInitiale = montant > 0 ? montant : null;
    set("#d-ref", D.ref); set("#d-prenom", c.prenom); set("#d-nom", c.nom); set("#d-societe", c.societe);
    set("#d-email", c.email); set("#d-tel", c.telephone);
    set("#d-date", p.date); set("#d-heure", p.heure); set("#d-depart", p.depart); set("#d-destination", p.destination);
    $("#d-ar").checked = !!p.allerRetour; set("#d-dateretour", p.dateRetour); set("#d-heureretour", p.heureRetour);
    // Catégorie de véhicule (anciennes et nouvelles appellations)
    var vSel = $("#d-vehicule");
    vSel.value = vSel.options[/classe\s*v|\bvan\b/i.test(p.vehicule || "") ? 1 : 0].value;
    set("#d-distance", distance); set("#d-pax", p.passagers || 1); set("#d-bagages", p.bagages);
    set("#d-volref", p.reference); set("#d-precisions", p.precisions);
    set("#d-montant", montant > 0 ? String(montant).replace(".", ",") : "");
    $("#estimMsg").textContent = montant > 0 ? "Estimation affichée au client : " + String(montant).replace(".", ",") + " €. Confirmez-la ou modifiez-la (tarif ajusté)."
      : "Aucune estimation automatique (trajet sur devis) : indiquez le tarif.";
    set("#d-dateprestation", p.date && p.date <= today ? p.date : "");
    $("#d-ref").readOnly = true;
    $("#d-chercher").value = D.ref || "";
    var recu = D.recu ? (/^\d{4}-/.test(D.recu) ? new Date(D.recu).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : D.recu) : "";
    $("#sourceMsg").textContent = "Demande " + D.ref + (recu ? " reçue le " + recu : "") + " chargée : il ne reste qu'à confirmer le tarif et, pour une facture, l'adresse de facturation.";
    afficherRecap(D, montant, distance, facture);
    $("#edition").open = false;
    $("#editionTitre").textContent = "Modifier les informations du client ou du trajet (facultatif)";
    majAffichage(); reinitValidation(); majTotal();
  }
  function afficherRecap(D, montant, distance, facture) {
    var c = D.client || {}, p = D.prestation || {};
    var dl = function (rows) { return "<dl class=\"recap__list\">" + rows.filter(function (r) { return r[1] !== "" && r[1] != null; }).map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") + "</dl>"; };
    var quand = function (d, h) { if (!d) return ""; var x = new Date(d + "T12:00:00"); return x.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + (h ? " à " + h.replace(":", "h") : ""); };
    $("#recapDemande").innerHTML =
      "<p class=\"eyebrow\">Demande " + esc(D.ref) + (D.origine ? " · " + esc(D.origine) : "") + "</p>" +
      (facture ? "<p class=\"docs__alerte docs__alerte--info\">Facture " + esc(facture.numero) + " déjà émise le " + esc(facture.dateEmission.split("-").reverse().join("/")) + " pour cette demande : la redemander renverra la même (aucun doublon).</p>" : "") +
      "<div class=\"docs__recap-grid\"><div><h2 class=\"docs__recap-titre\">Client</h2>" + dl([
        ["Client", [c.prenom, c.nom].join(" ").trim()], ["Société", c.societe], ["Téléphone", c.telephone], ["E-mail", c.email]]) +
      "</div><div><h2 class=\"docs__recap-titre\">Trajet</h2>" + dl([
        ["Prestation", p.type], ["Date", quand(p.date, p.heure)], ["Départ", p.depart], ["Destination", p.destination],
        ["Retour", p.allerRetour ? quand(p.dateRetour, p.heureRetour) || "Aller-retour" : ""],
        ["Véhicule", p.vehicule], ["Passagers", p.passagers ? String(p.passagers) + (p.bagages !== "" && p.bagages != null ? " · bagages : " + p.bagages : "") : ""],
        ["Vol / train", p.reference], ["Distance", distance ? String(distance).replace(".", ",") + " km" : ""],
        ["Estimation", montant > 0 ? String(montant).replace(".", ",") + " €" : "Sur devis"],
        ["Informations", p.precisions]]) + "</div></div>";
    $("#recapDemande").hidden = false;
  }
  var esc = function (x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); };

  /* Chargement automatique (lien de l'e-mail) ou par référence */
  var params = new URLSearchParams(location.search);
  var idLien = params.get("r") || "";
  var etape = params.get("etape") || (/[#&]etape=validation/.test(location.hash) ? "validation" : "");
  function charger(corps, auto) {
    $("#sourceMsg").textContent = "Chargement de la demande…";
    return appel(Object.assign({ action: "charger" }, corps)).then(function (j) {
      if (!j.ok) {
        if (j.code === "acces") { oublierSession(); verrouiller(j.message); return; }
        $("#sourceMsg").textContent = (j.message || "Demande introuvable.") + (auto ? "" : "");
        $("#sourceMsg").classList.add("docs__msg--erreur");
        return;
      }
      $("#sourceMsg").classList.remove("docs__msg--erreur");
      remplir(j.demande, j.facture);
      afficherPaiement(j.paiement, j.paiementEnLigne);
      preremplirFactureStripe(j.paiement);
      $("#d-reglement").value = "auto";                                       // règlement du devis : selon la réservation
      if (etape === "validation") $("#validation").scrollIntoView({ block: "start" });
      else $("#recapDemande").scrollIntoView({ block: "start" });
    });
  }
  function chargerDepuisLien() {
    if (idLien) return charger({ id: idLien }, true);
    var ancien = lireLien();                       // anciens e-mails (avant le 19 nov.) : données dans l'adresse
    if (ancien) { remplir(ancien, null); if (etape === "validation") $("#validation").scrollIntoView({ block: "start" }); }
  }
  $("#btnCharger").addEventListener("click", function () {
    var ref = v("#d-chercher").toUpperCase();
    if (!ref) { $("#d-chercher").focus(); return; }
    etape = ""; charger({ ref: ref }, false);
  });
  $("#d-chercher").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("#btnCharger").click(); } });

  // Document hors site (réservation par téléphone…) : référence créée automatiquement
  set("#d-ref", "E8-M-" + today.slice(2).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase());
  set("#d-pax", 1); set("#d-dateprestation", today);
  $("#sourceMsg").textContent = idLien ? "" : "Ouvrez une demande par sa référence, ou saisissez un document sans demande (réservation par téléphone…).";
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
      devis: { valide: $("#d-valide").checked, validiteJours: v("#d-validite"), reglement: v("#d-reglement") || "auto" },
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
     Ordre imposé : 1 disponibilité vérifiée → 2 tarif définitif validé → 3 lien de paiement sécurisé
     (facultatif, collé à la main, jamais généré ici) → 4 message, relu et modifiable avant l'envoi.
     Le champ du lien reste fermé tant que 1 et 2 ne sont pas cochés ; toute modification du montant
     annule la validation du tarif et celle du lien (le lien a été créé pour un montant précis).
     Rien n'est envoyé automatiquement. Un paiement ne confirme jamais la réservation :
     « Réservation confirmée » exige un règlement vérifié. Textes : assets/js/messages-client.js. */
  var M = window.ELEV8Messages;
  var MARQUE = "ELEV8 Private Driver";
  var SITE = (C.site && C.site.url) || "https://elev8privatedriver.com";
  var MAIL_ELEV8 = (C.contact && C.contact.email) || "contact@elev8privatedriver.com";
  var montantValide = null;           // montant pour lequel la case « tarif validé » a été cochée
  function estAjuste() {
    // Un supplément ajouté ne change pas la nature du message : seul le prix du trajet est comparé à l'estimation
    var base = parseFloat(donnees().montant) || 0;
    return !!(estimInitiale && base > 0 && Math.abs(base - estimInitiale) >= 0.01);
  }
  // Nouvelle demande chargée : tout est à revérifier (disponibilité, tarif, lien)
  function reinitValidation() {
    ["#v-dispo", "#v-tarif", "#v-lien-ok", "#v-regle"].forEach(function (s) { $(s).checked = false; });
    $("#v-lien").value = ""; $("#v-type").value = "proposition"; montantValide = null; masquerApercu(); majValidation();
  }
  function masquerApercu() { $("#apercu").hidden = true; }
  function majValidation() {
    var type = $("#v-type").value, t = total();
    // Montant modifié après validation : on annule la validation du tarif et du lien
    if ($("#v-tarif").checked && montantValide !== t) {
      $("#v-tarif").checked = false; $("#v-lien-ok").checked = false; montantValide = null; masquerApercu();
      $("#formMsg").textContent = "Le montant a changé : validez de nouveau le tarif et vérifiez que le lien de paiement correspond au nouveau montant.";
    }
    $$("[data-vt=validation]").forEach(function (el) { el.hidden = type === "reservation"; });
    $$("[data-vt=reservation]").forEach(function (el) { el.hidden = type !== "reservation"; });
    var pret = $("#v-dispo").checked && $("#v-tarif").checked;
    $("#v-lien").disabled = !pret;
    $("#stripeLien").hidden = !paiementEnLigne || type === "reservation" || !demandeChargee || !demandeChargee.ref;
    $("#btnStripe").disabled = !pret || !(t > 0);
    $("#v-lien-aide").textContent = pret
      ? "Créez le lien dans l'espace sécurisé de votre prestataire (Caisse d'Épargne, Indy…), pour " + (t > 0 ? fmt(t) + " TTC" : "le montant validé") + ", puis collez-le ici."
      : "Créez le lien dans l'espace sécurisé de votre prestataire, pour le montant validé, puis collez-le ici. Disponible après les étapes 1 et 2.";
    var lien = v("#v-lien"), L = M.lienPaiement(lien);
    if (type !== "reservation") {
      $$("[data-lien]").forEach(function (el) { el.hidden = !lien; });
      $$("[data-sanslien]").forEach(function (el) { el.hidden = !!lien; });
    }
    $("#v-lien-domaine").textContent = L.ok ? " (" + L.domaine + ")" : "";
    $("#v-montant").textContent = t > 0 ? fmt(t) + " TTC" : "— (à saisir en rubrique 3)";
    $("#v-lien-montant").textContent = t > 0 ? fmt(t) + " TTC" : "—";
    $("#v-ajuste").textContent = estAjuste() ? "ajusté (estimation : " + fmt(estimInitiale) + ")" : (estimInitiale ? "= estimation" : "");
  }
  $("#v-tarif").addEventListener("change", function () {
    montantValide = this.checked ? total() : null;
    if (!this.checked) { $("#v-lien-ok").checked = false; masquerApercu(); }
    $("#formMsg").textContent = ""; majValidation();
  });
  $("#v-dispo").addEventListener("change", function () { if (!this.checked) masquerApercu(); majValidation(); });
  $("#v-lien").addEventListener("input", function () { $("#v-lien-ok").checked = false; masquerApercu(); majValidation(); });
  ["#v-type", "#v-sanslien", "#v-lien-ok", "#v-regle"].forEach(function (s) { $(s).addEventListener("change", function () { masquerApercu(); majValidation(); }); });
  $("#d-montant").addEventListener("input", majValidation);
  $$("[data-sup] input").forEach(function (i) { i.addEventListener("input", majValidation); });
  majValidation();

  /* ---------- Paiement en ligne (Stripe, mode test) ----------
     L'état affiché vient du serveur, lui-même informé UNIQUEMENT par les notifications signées de Stripe.
     Aucune course n'est « attribuée » sans confirmation effective d'un chauffeur. */
  var paiementEnLigne = false, paiementCourant = null;
  function dateHeure(iso) { return iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : ""; }
  function afficherPaiement(P, actif) {
    paiementEnLigne = !!actif; paiementCourant = P || null;
    var bloc = $("#paiementBloc");
    bloc.hidden = !paiementEnLigne;
    $("#pMsg").textContent = "";
    if (!paiementEnLigne) { majValidation(); return; }
    if (!P) {
      $("#pStatut").textContent = "Aucun paiement en ligne pour cette demande";
      $("#pDetail").textContent = "Demande à valider manuellement (sur devis, demande particulière ou prise en charge proche). Après validation du tarif (rubrique 5), créez le lien de paiement Stripe.";
      $("#pChauffeur").hidden = true; $("#pAnnuler").hidden = true; $("#pHisto").innerHTML = ""; majValidation(); return;
    }
    $("#pStatut").textContent = P.etapeLibelle + (P.statut !== "paye" ? " · " + P.statutLibelle : "") + (P.litige ? " · LITIGE" : "");
    var d = ["Montant : " + fmt(P.montant) + " TTC", "Lien : " + location.origin + P.lien];
    if (P.statut === "en_attente") d.push("Valable jusqu'au " + dateHeure(P.valableJusqu));
    if (P.devis) d.push("Devis " + P.devis.numero + " envoyé le " + dateHeure(P.devis.le));
    if (P.payeLe) d.push("Payé le " + dateHeure(P.payeLe));
    if (P.factures && P.factures.acompte) d.push("Facture d'acompte " + P.factures.acompte + " émise (100 %, reste à payer 0,00 €)");
    if (P.rembourse > 0) d.push("Remboursé : " + fmt(P.rembourse));
    if (P.motifVerification) d.push("À vérifier : " + P.motifVerification);
    if (P.chauffeur) d.push("Chauffeur : " + P.chauffeur.prenom + " · " + P.chauffeur.vehicule + (P.chauffeur.plaque ? " · " + P.chauffeur.plaque : ""));
    if (P.statut === "paye") d.push("HUBER : " + (P.huber && P.huber.etat === "en_attente_api" ? "transmission automatique dès que son API sera disponible (aucune publication pour l'instant)" : (P.huber && P.huber.etat) || "—"));
    $("#pDetail").textContent = d.join(" · ");
    $("#pChauffeur").hidden = !(P.statut === "paye" && P.etape === "payee_attente_attribution");
    $("#btnDevisEnvoye").hidden = !P.devis;
    $("#btnFactureAcompte").hidden = !(P.factures && P.factures.acompte);
    var annulable = ["attente_paiement", "payee_attente_attribution", "chauffeur_confirme"].indexOf(P.etape) >= 0 && ["en_attente", "expire", "paye", "a_verifier", "rembourse_partiel"].indexOf(P.statut) >= 0;
    $("#pAnnuler").hidden = !annulable;
    $("#btnSansChauffeur").hidden = ["paye", "a_verifier", "rembourse_partiel"].indexOf(P.statut) < 0;
    $("#pHisto").innerHTML = (P.historique || []).slice().reverse().map(function (h) { return "<li>" + esc(dateHeure(h.le)) + " — " + esc(h.quoi) + "</li>"; }).join("");
    majValidation();
  }
  function actionPaiement(corps, ok) {
    $("#pMsg").textContent = "En cours…";
    corps.ref = demandeChargee && demandeChargee.ref;
    return appel(corps).then(function (j) {
      if (j.code === "acces") { oublierSession(); verrouiller(j.message); return; }
      if (!j.ok) { $("#pMsg").textContent = j.message || "Opération impossible."; return; }
      afficherPaiement(j.paiement, true);
      $("#pMsg").textContent = ok(j);
      return j;
    });
  }
  /* ---------- Facture d'une course payée par Stripe : mode, date et référence repris du paiement ----------
     Le serveur refait les mêmes contrôles avant toute émission (montant encaissé, date, référence). */
  var MODE_STRIPE = "paiement en ligne Stripe";
  var paiementFacture = null;
  function dateParis(iso) {
    var p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  }
  function preremplirFactureStripe(P) {
    // Devis d'une réservation avec paiement en ligne (lien envoyé, payé ou remboursé) : montant fixé par le paiement
    if (P && ["annule", "remplace", "expire"].indexOf(P.statut) < 0) {
      $("#d-valide").checked = true;
      if (!donnees().supplements.length && Math.abs(total() - P.montant) >= 0.005) { $("#d-montant").value = String(P.montant).replace(".", ","); majTotal(); }
    }
    paiementFacture = P && P.payeLe && ["paye", "rembourse_partiel", "rembourse"].indexOf(P.statut) >= 0 ? P : null;
    if (paiementFacture && P.statut !== "rembourse") {
      $("#d-paye").checked = true;
      $("#d-mode").value = MODE_STRIPE;
      $("#d-datepaiement").value = dateParis(P.payeLe);
      $("#d-refpaiement").value = P.paymentIntent || "";
      var pr = demandeChargee && demandeChargee.prestation;                 // date de la course réservée (modifiable)
      if (!v("#d-dateprestation") && pr && /^\d{4}-\d{2}-\d{2}$/.test(pr.date || "")) $("#d-dateprestation").value = pr.date;
      majAffichage();
    }
    coherenceFacture();
  }
  function coherenceFacture() {
    var el = $("#stripeFactureMsg"), P = paiementFacture, mode = $("#d-mode").value, m = "", alerte = false;
    if (P) {
      var encaisse = Math.round((P.montant - (P.rembourse || 0)) * 100) / 100;
      if (P.statut === "rembourse") { m = "Course remboursée intégralement par Stripe : aucune facture à émettre."; alerte = true; }
      else if (mode !== MODE_STRIPE) { m = "Cette réservation a été payée en ligne par Stripe : choisissez « Paiement en ligne Stripe »."; alerte = true; }
      else if (Math.abs(total() - encaisse) >= 0.005) { m = "Le total de la facture (" + fmt(total()) + ") diffère du montant encaissé par Stripe (" + fmt(encaisse) + (P.rembourse > 0 ? ", après remboursement de " + fmt(P.rembourse) : "") + ")."; alerte = true; }
      else m = "Payée par Stripe le " + new Date(P.payeLe).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) + " : " + fmt(encaisse) + " encaissés, référence " + (P.paymentIntent || "—") + ". Mode, date et référence sont repris automatiquement.";
    } else if (mode === MODE_STRIPE && demandeChargee && demandeChargee.ref) {
      m = "Aucun paiement Stripe confirmé pour cette réservation : choisissez un autre mode de paiement."; alerte = true;
    }
    el.textContent = m; el.hidden = !m;
    el.classList.toggle("docs__msg--erreur", alerte);
  }
  ["#d-mode", "#d-paye"].forEach(function (s) { $(s).addEventListener("change", coherenceFacture); });
  $("#d-montant").addEventListener("input", coherenceFacture);
  $$("[data-sup] input").forEach(function (i) { i.addEventListener("input", coherenceFacture); });

  $("#btnStripe").addEventListener("click", function () {
    if (!demandeChargee || !demandeChargee.ref) return;
    var t = total();
    if (!confirm("Valider " + fmt(t) + " TTC pour " + demandeChargee.ref + " : le devis PDF et le bouton « Accepter le devis et payer en ligne » seront envoyés automatiquement au client (copie à ELEV8). Tout lien précédent non payé sera désactivé.")) return;
    var D0 = donnees();
    actionPaiement({ action: "paiement-lien", montant: t, detail: { montant: D0.montant, supplements: D0.supplements } }, function (j) {
      $("#v-lien").value = location.origin + j.paiement.lien;
      $("#v-lien-ok").checked = true; majValidation();
      return (j.devis ? "Devis " + j.devis + " envoyé " + (j.sansEmailClient ? "à ELEV8 (client sans e-mail : transmettez-le)" : "au client, copie à ELEV8") : "Lien créé (devis PDF non produit : vérifiez les informations légales)") +
        " — " + fmt(j.paiement.montant) + " TTC. Le message de l'étape 4 reste disponible (WhatsApp, par exemple).";
    });
  });
  $("#btnChauffeur").addEventListener("click", function () {
    var c = { prenom: v("#c-prenom"), vehicule: v("#c-vehicule"), plaque: v("#c-plaque") };
    if (!c.prenom || !c.vehicule) { $("#pMsg").textContent = "Indiquez le prénom du chauffeur et le véhicule."; return; }
    if (!confirm("Confirmer que " + c.prenom + " a accepté la course ? Le client recevra sa confirmation par e-mail.")) return;
    actionPaiement({ action: "chauffeur-confirme", chauffeur: c }, function (j) { return j.mail ? "Chauffeur confirmé : le client a reçu sa confirmation." : "Chauffeur confirmé (e-mail du client absent ou non envoyé : prévenez-le par téléphone ou WhatsApp)."; });
  });
  function annuler(motif) {
    var P = paiementCourant || {};
    var paye = ["paye", "a_verifier", "rembourse_partiel"].indexOf(P.statut) >= 0;
    if (!confirm((paye ? "Annuler la course et REMBOURSER intégralement " + fmt(P.montant) + " au client ?" : "Annuler la demande et désactiver le lien de paiement ?") + " Le client sera prévenu par e-mail.")) return;
    actionPaiement({ action: "annuler-course", motif: motif }, function (j) { return j.rembourse ? "Remboursement intégral demandé à Stripe : il sera confirmé par notification." : "Lien désactivé, client prévenu."; });
  }
  $("#btnIndispo").addEventListener("click", function () { annuler("indisponible"); });
  /* Devis tel qu'il a été envoyé au client (document figé, relu sur le serveur) */
  function telechargerEnregistre(action, libelle) {
    if (!demandeChargee || !demandeChargee.ref) return;
    $("#pMsg").textContent = "Préparation : " + libelle + "…";
    appel({ action: action, ref: demandeChargee.ref }).then(function (j) {
      if (!j.ok || !j.pdf) { $("#pMsg").textContent = j.message || "Document introuvable."; return; }
      var bin = atob(j.pdf), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); a.download = j.fichier;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      $("#pMsg").textContent = j.numero + " téléchargé.";
    });
  }
  $("#btnDevisEnvoye").addEventListener("click", function () { telechargerEnregistre("devis-envoye", "devis envoyé"); });
  $("#btnFactureAcompte").addEventListener("click", function () { telechargerEnregistre("facture-acompte", "facture d'acompte"); });
  $("#btnSansChauffeur").addEventListener("click", function () { annuler("sans_chauffeur"); });

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
    var type = $("#v-type").value, I = infos(), lien = v("#v-lien"), L = M.lienPaiement(lien);
    var erreurs = [];
    if (!I.ref) erreurs.push("la référence");
    if (!(I.total > 0)) erreurs.push("le tarif (rubrique 3)");
    if (!I.p.date || !I.p.depart || !I.p.destination) erreurs.push("la date, le départ et la destination");
    if (type === "reservation") {
      if (!$("#v-regle").checked) erreurs.push("la case « règlement vérifié »");
    } else {
      if (!$("#v-dispo").checked) erreurs.push("1. la case « disponibilité vérifiée »");
      if (!$("#v-tarif").checked || montantValide !== I.total) erreurs.push("2. la validation du tarif définitif");
      if (lien && !L.ok) erreurs.push("3. un lien de paiement valide, commençant par https:// (ou videz le champ)");
      if (lien && L.ok && !$("#v-lien-ok").checked) erreurs.push("3. la case « lien vérifié » (ou videz le champ du lien)");
    }
    if (erreurs.length) return { erreur: "À compléter avant de préparer le message : " + erreurs.join(", ") + "." };
    return M.composer({
      type: type === "reservation" ? "reservation" : "proposition", ajuste: estAjuste(), estimInitiale: estimInitiale,
      ref: I.ref, prenom: I.prenom, date: I.date, heure: I.heure, depart: I.p.depart, destination: I.p.destination, retour: I.retour,
      vehicule: I.vehicule, passagers: I.passagers, supplements: I.sup, total: I.total,
      lien: type !== "reservation" && L.ok && $("#v-lien-ok").checked ? L.lien : "",
      sansLien: $("#v-sanslien").value, marque: MARQUE, email: MAIL_ELEV8, site: SITE
    });
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
