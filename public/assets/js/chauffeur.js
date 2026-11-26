/* ==========================================================================
   ELEV8 — espace chauffeur (/chauffeur) : saisie d'une course sur place,
   prix de la grille, lien de paiement Stripe (QR code / SMS), encaissement
   hors Stripe (Tap to Pay Indy, TPE, espèces), « Course terminée ».
   Session : localStorage (jeton signé par le serveur, prolongé automatiquement).
   ========================================================================== */
(function () {
  "use strict";
  var API = "/chauffeur-api";
  var CLE = "elev8.chauffeur.session", CLE_APP = "elev8.chauffeur.apporteurs";
  var $ = function (s) { return document.querySelector(s); };
  var etat = { stripe: false, moyens: [], estimation: null, course: null, suivi: 0, wake: null };

  /* ---------- Stockage local (protégé : certains modes privés le refusent) ---------- */
  function lireLocal(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function ecrireLocal(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* ignoré */ } }

  /* ---------- Appel de l'API ---------- */
  function api(action, data) {
    var corps = Object.assign({ action: action, session: lireLocal(CLE) }, data || {});
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), cache: "no-store" })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, message: "Réponse illisible." }; }).then(function (j) {
          if (j && j.session) ecrireLocal(CLE, j.session);
          if (r.status === 401 && action !== "connexion") { ecrireLocal(CLE, ""); afficherLock("Session expirée : saisissez le mot de passe."); }
          j.status = r.status; return j;
        });
      })
      .catch(function () { return { ok: false, status: 0, message: "Pas de réseau. Réessayez." }; });
  }

  /* ---------- Formats ---------- */
  function eur(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €"; }
  function num(v) { var n = parseFloat(String(v || "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : NaN; }
  function heureFr(iso) { return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }); }
  function dateHeureFr(iso) { return new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(el, t, info) { el.textContent = t || ""; el.classList.toggle("is-info", !!info); }
  function occupe(btn, oui) { btn.classList.toggle("is-busy", !!oui); }

  /* ---------- Vues ---------- */
  var VUES = ["vueLock", "vueSaisie", "vueCourse", "vueCompteur", "vueJour"];
  function montrer(id) {
    VUES.forEach(function (v) { $("#" + v).hidden = v !== id; });
    $("#onglets").hidden = id === "vueLock";
    document.querySelectorAll(".ch-tab").forEach(function (t) { t.classList.toggle("is-on", t.getAttribute("data-vue") === id); });
    if (id !== "vueCourse") arreterSuivi();
    window.scrollTo(0, 0);
  }
  function afficherLock(t) { montrer("vueLock"); msg($("#lockMsg"), t || ""); }
  function ouvert(j) {
    etat.stripe = !!j.stripe; etat.moyens = j.moyens || [];
    if (j.tarifs) { etat.tarifs = j.tarifs; afficherTarifs(); }
    $("#badgeTest").hidden = !j.test;
    if (window.Compteur && window.Compteur.reprendre()) return;      // course au compteur en cours : on la reprend
    montrer("vueSaisie");
  }

  $("#lockForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = e.submitter || $("#lockForm button"); occupe(b, true);
    api("connexion", { motDePasse: $("#mdp").value }).then(function (j) {
      occupe(b, false);
      if (!j.ok) { msg($("#lockMsg"), j.message || "Connexion impossible."); return; }
      $("#mdp").value = ""; ouvert(j);
    });
  });
  document.querySelectorAll(".ch-tab").forEach(function (t) {
    t.addEventListener("click", function () {
      var v = t.getAttribute("data-vue");
      if (v === "vueJour") chargerJour();
      montrer(v);
    });
  });

  /* ---------- Saisie ---------- */
  function quand() { return document.querySelector('input[name="quand"]:checked').value; }
  function vehicule() { return document.querySelector('input[name="vehicule"]:checked').value; }
  function trajet() {
    return { depart: $("#f-from").value.trim(), destination: $("#f-to").value.trim(), vehicule: vehicule(), passagers: $("#passagers").value,
      quand: quand(), date: $("#date").value, heure: $("#heure").value };
  }
  document.querySelectorAll('input[name="quand"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var tard = quand() === "plus_tard";
      $("#blocPlusTard").hidden = !tard;
      if (tard && !$("#date").value) {
        var d = new Date(Date.now() + 3600000), p = function (n) { return ("0" + n).slice(-2); };
        $("#date").value = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
        $("#heure").value = p(d.getHours()) + ":" + p(Math.floor(d.getMinutes() / 5) * 5);
      }
      invaliderPrix();
    });
  });
  ["#f-from", "#f-to", "#passagers", "#date", "#heure"].forEach(function (s) { $(s).addEventListener("change", invaliderPrix); });
  document.querySelectorAll('input[name="vehicule"]').forEach(function (r) { r.addEventListener("change", invaliderPrix); });
  function invaliderPrix() {
    if (!etat.estimation) return;
    etat.estimation = null;
    $("#prixGrille").textContent = "—"; $("#prixDetail").textContent = "Trajet modifié : recalculez le prix.";
  }

  // Ma position (GPS) → adresse
  $("#btnPosition").addEventListener("click", function () {
    var b = this;
    if (!navigator.geolocation) { msg($("#prixMsg"), "Position indisponible sur ce téléphone."); return; }
    occupe(b, true); msg($("#prixMsg"), "Recherche de votre position…", true);
    navigator.geolocation.getCurrentPosition(function (pos) {
      api("position", { lat: pos.coords.latitude, lon: pos.coords.longitude }).then(function (j) {
        occupe(b, false);
        if (!j.ok) { msg($("#prixMsg"), "Position trouvée, mais pas l'adresse exacte : saisissez-la (nom de l'hôtel, rue…)."); return; }
        $("#f-from").value = j.adresse; msg($("#prixMsg"), "Position : " + j.adresse + " (précisez le nom de l'hôtel si besoin).", true);
        invaliderPrix();
        if (!$("#f-to").value.trim()) $("#f-to").focus();
      });
    }, function (err) {
      occupe(b, false);
      msg($("#prixMsg"), erreurGps(err));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });

  // Prix de la grille
  $("#btnPrix").addEventListener("click", function () {
    var t = trajet(), b = this;
    if (t.depart.length < 3 || t.destination.length < 3) { msg($("#prixMsg"), "Indiquez la prise en charge et la destination."); return; }
    occupe(b, true); msg($("#prixMsg"), "Calcul du prix…", true);
    api("estimer", t).then(function (j) {
      occupe(b, false);
      if (!j.ok) { msg($("#prixMsg"), j.message || "Calcul impossible."); return; }
      msg($("#prixMsg"), "");
      var e = etat.estimation = j.estimation;
      $("#blocPrix").hidden = false; $("#blocClient").hidden = false;
      if (e.statut === "estimation") {
        $("#prixGrille").textContent = eur(e.montant);
        $("#prixDetail").textContent = [e.distanceKm ? String(e.distanceKm).replace(".", ",") + " km" : "", e.dureeMin ? "≈ " + e.dureeMin + " min" : "", (e.vehicule || "").split(" — ")[0]].filter(Boolean).join(" · ");
        $("#montant").value = String(e.montant.toFixed(2)).replace(".", ",");
      } else {
        $("#prixGrille").textContent = "Prix libre";
        $("#prixDetail").textContent = e.message || "Fixez le prix avec le client.";
        $("#montant").value = "";
      }
      majMotif();
      $("#blocPrix").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  function majMotif() {
    var e = etat.estimation, m = num($("#montant").value);
    var diff = e && e.statut === "estimation" && isFinite(m) && Math.abs(m - e.montant) >= 0.005;
    $("#blocMotif").hidden = !diff;
  }
  $("#montant").addEventListener("input", majMotif);

  // Apporteurs déjà utilisés (mémorisés sur ce téléphone)
  function apporteurs() { try { return JSON.parse(lireLocal(CLE_APP) || "[]"); } catch (e) { return []; } }
  function majApporteurs() { $("#apporteurs").innerHTML = apporteurs().map(function (a) { return '<option value="' + esc(a) + '">'; }).join(""); }
  majApporteurs();

  // Validation (accord du client)
  $("#saisie").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("#btnValider"), m = num($("#montant").value);
    document.querySelectorAll(".is-bad").forEach(function (x) { x.classList.remove("is-bad"); });
    if (!etat.estimation) { msg($("#valMsg"), "Calculez d'abord le prix."); return; }
    if (!(m >= 1)) { $("#montant").classList.add("is-bad"); msg($("#valMsg"), "Indiquez le prix convenu."); return; }
    if (!$("#blocMotif").hidden && $("#motif").value.trim().length < 3) { $("#motif").classList.add("is-bad"); msg($("#valMsg"), "Indiquez le motif de l'ajustement du prix."); return; }
    if ($("#nom").value.trim().length < 2) { $("#nom").classList.add("is-bad"); msg($("#valMsg"), "Indiquez le nom du client (justificatif de réservation)."); return; }
    var t = trajet();
    var data = Object.assign(t, { montant: m, motif: $("#motif").value.trim(), apporteur: $("#apporteur").value.trim(),
      client: { prenom: $("#prenom").value.trim(), nom: $("#nom").value.trim(), telephone: $("#tel").value.trim(), email: $("#email").value.trim() } });
    occupe(b, true); msg($("#valMsg"), "Enregistrement…", true);
    api("creer", data).then(function (j) {
      occupe(b, false);
      if (!j.ok) {
        msg($("#valMsg"), j.message || "Enregistrement impossible.");
        var ids = { depart: "#f-from", destination: "#f-to", nom: "#nom", telephone: "#tel", email: "#email", montant: "#montant", motif: "#motif", horaire: "#heure" };
        (j.champs || []).forEach(function (c) { if (ids[c]) $(ids[c]).classList.add("is-bad"); });
        return;
      }
      msg($("#valMsg"), "");
      if (data.apporteur) { var l = apporteurs().filter(function (a) { return a !== data.apporteur; }); l.unshift(data.apporteur); ecrireLocal(CLE_APP, JSON.stringify(l.slice(0, 12))); majApporteurs(); }
      etat.stripe = j.stripe !== false && etat.stripe;
      viderSaisie();
      afficherCourse(j.course);
    });
  });
  function viderSaisie() {
    $("#saisie").reset(); etat.estimation = null;
    $("#blocPrix").hidden = true; $("#blocClient").hidden = true; $("#blocPlusTard").hidden = true; $("#blocMotif").hidden = true;
    $("#prixGrille").textContent = "—"; $("#prixDetail").textContent = "";
  }

  /* ---------- Course : paiement et suivi ---------- */
  var PAYE = ["paye", "rembourse_partiel"];
  function lienComplet(c) { return location.origin + c.lien; }
  function texteSms(c) {
    return "ELEV8 Private Driver — course " + c.ref + " : " + eur(c.montant) + " TTC.\nPaiement sécurisé (Apple Pay ou carte) : " + lienComplet(c);
  }
  function chip(c) {
    if (c.etape === "realisee") return ["Terminée", "ok"];
    if (PAYE.indexOf(c.statut) >= 0) return ["Payée", "ok"];
    if (c.statut === "en_cours") return ["Paiement en cours", "att"];
    if (c.statut === "a_verifier") return ["À vérifier", "ko"];
    if (c.statut === "en_attente") return ["À encaisser", "att"];
    if (c.statut === "expire") return ["Lien expiré", "ko"];
    return [c.statutLibelle || c.statut, "ko"];
  }
  function afficherCourse(c) {
    etat.course = c;
    montrer("vueCourse");
    rendreCourse(c);
    if (["en_attente", "en_cours"].indexOf(c.statut) >= 0) demarrerSuivi();
  }
  function rendreCourse(c) {
    etat.course = c;
    var k = chip(c);
    $("#cRef").textContent = c.ref;
    $("#cStatut").textContent = k[0]; $("#cStatut").className = "ch-chip ch-chip--" + k[1];
    $("#cMontant").textContent = eur(c.montant);
    var T = c.trajet || {}, C = c.client || {};
    $("#cTrajet").innerHTML = "<b>" + esc(T.depart || "") + "</b> → <b>" + esc(T.destination || "") + "</b><br>" +
      esc([[C.prenom, C.nom].filter(Boolean).join(" "), (T.vehicule || "").split(" — ")[0], T.passagers ? T.passagers + " pass." : "", c.apporteur ? "via " + c.apporteur : ""].filter(Boolean).join(" · "));
    $("#cJustif").textContent = "Réservation enregistrée le " + dateHeureFr(c.reservationLe) + " — prise en charge " + dateHeureFr(c.priseEnCharge) +
      (c.ajustement ? " — prix ajusté (grille " + (c.ajustement.de != null ? eur(c.ajustement.de) : "—") + ") : " + c.ajustement.motif : "");

    var aPayer = ["en_attente", "expire"].indexOf(c.statut) >= 0, paye = PAYE.indexOf(c.statut) >= 0;
    $("#cPayer").hidden = !(c.statut === "en_attente" || c.statut === "en_cours");
    $("#cAutre").hidden = !aPayer;
    $("#cPaye").hidden = !(paye || c.statut === "a_verifier");
    $("#cAnnuler").hidden = !aPayer;

    if (!$("#cPayer").hidden) {
      dessinerQr(lienComplet(c));
      var tel = C.telephone || "";
      $("#cSms").href = "sms:" + tel + "?&body=" + encodeURIComponent(texteSms(c));
      msg($("#cStripeMsg"), c.statut === "en_cours" ? "Paiement en cours de validation par la banque…" : (etat.stripe ? "" : "Paiement en ligne désactivé sur ce site (PAIEMENT_STRIPE) : encaissez autrement."), c.statut === "en_cours");
      reveil(true);
    } else reveil(false);

    if (aPayer) {
      $("#cMoyens").innerHTML = (etat.moyens.length ? etat.moyens : ["carte bancaire (Tap to Pay Indy)", "carte bancaire (TPE)", "espèces"]).map(function (m) {
        return '<button type="button" class="ch-btn" data-moyen="' + esc(m) + '">' + esc(libelleMoyen(m)) + "</button>";
      }).join("");
      if (c.statut === "expire") msg($("#cAutreMsg"), "Le lien en ligne a expiré : encaissez par TPE, Tap to Pay ou espèces.", true);
    }
    if (paye || c.statut === "a_verifier") {
      $("#cPayeTxt").textContent = c.statut === "a_verifier" ? "Paiement à vérifier (double paiement ?) : voir /documents."
        : "✓ Payée " + (c.horsStripe ? "(" + c.horsStripe.moyen + ")" : "en ligne") + " à " + heureFr(c.payeLe) + " — " + eur(c.montant);
      var fini = c.etape === "realisee";
      $("#cTerminer").hidden = fini || c.statut === "a_verifier";
      if (fini) msg($("#cTerminerMsg"), "Course terminée à " + heureFr(c.realiseeLe) + ". Merci !", true);
    }
  }
  function libelleMoyen(m) {
    return { "carte bancaire (Tap to Pay Indy)": "Tap to Pay Indy", "carte bancaire (TPE)": "Carte — TPE", "espèces": "Espèces" }[m] || m;
  }
  function dessinerQr(texte) {
    var el = $("#cQr");
    if (el.getAttribute("data-qr") === texte) return;
    try {
      var q = window.qrcode(0, "M"); q.addData(texte); q.make();
      el.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
      el.setAttribute("data-qr", texte);
    } catch (e) { el.textContent = texte; }
  }
  // Écran allumé pendant que le client scanne (si le téléphone le permet)
  function reveil(on) {
    try {
      if (on && !etat.wake && navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { etat.wake = w; w.addEventListener("release", function () { etat.wake = null; }); }).catch(function () {});
      if (!on && etat.wake) { etat.wake.release(); etat.wake = null; }
    } catch (e) { /* non pris en charge */ }
  }

  $("#cPartager").addEventListener("click", function () {
    var c = etat.course; if (!c) return;
    if (navigator.share) { navigator.share({ title: "Paiement ELEV8 " + c.ref, text: texteSms(c).split("\n")[0], url: lienComplet(c) }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(lienComplet(c)).then(function () { msg($("#cStripeMsg"), "Lien copié.", true); });
  });

  // Encaissement hors Stripe
  $("#cMoyens").addEventListener("click", function (e) {
    var b = e.target.closest("[data-moyen]"); if (!b || !etat.course) return;
    var moyen = b.getAttribute("data-moyen");
    if (!window.confirm("Confirmer : " + eur(etat.course.montant) + " encaissés par " + libelleMoyen(moyen) + " ?\nLe lien de paiement en ligne sera désactivé.")) return;
    occupe(b, true);
    api("encaisser", { ref: etat.course.ref, moyen: moyen, reference: $("#cRefTx").value.trim() }).then(function (j) {
      occupe(b, false);
      if (j.course) rendreCourse(j.course);
      if (!j.ok) { msg($("#cAutreMsg"), j.message || "Impossible."); return; }
      $("#cRefTx").value = ""; msg($("#cAutreMsg"), ""); arreterSuivi();
    });
  });
  $("#cTerminer").addEventListener("click", function () {
    var b = this; if (!etat.course) return;
    occupe(b, true);
    api("terminer", { ref: etat.course.ref }).then(function (j) {
      occupe(b, false);
      if (!j.ok) { msg($("#cTerminerMsg"), j.message || "Impossible."); return; }
      rendreCourse(j.course);
    });
  });
  $("#cAnnuler").addEventListener("click", function () {
    var b = this; if (!etat.course) return;
    if (!window.confirm("Annuler la course " + etat.course.ref + " ? Le lien de paiement sera désactivé.")) return;
    occupe(b, true);
    api("annuler", { ref: etat.course.ref }).then(function (j) {
      occupe(b, false);
      if (j.course) rendreCourse(j.course);
      if (!j.ok) { msg($("#cAutreMsg"), j.message || "Impossible."); return; }
      arreterSuivi(); $("#cStatut").textContent = "Annulée";
    });
  });
  $("#cNouvelle").addEventListener("click", function () { montrer("vueSaisie"); });

  // Suivi du paiement en ligne (le client paie sur son téléphone) : toutes les 4 s
  function demarrerSuivi() {
    arreterSuivi();
    etat.suivi = setInterval(function () {
      if (document.hidden || !etat.course) return;
      api("etat", { ref: etat.course.ref }).then(function (j) {
        if (!j.ok || !j.course || !etat.course || j.course.ref !== etat.course.ref) return;
        var avant = etat.course.statut;
        rendreCourse(j.course);
        if (["en_attente", "en_cours"].indexOf(j.course.statut) < 0) { arreterSuivi(); if (avant !== j.course.statut && navigator.vibrate) navigator.vibrate([80, 60, 80]); }
      });
    }, 4000);
  }
  function arreterSuivi() { if (etat.suivi) clearInterval(etat.suivi); etat.suivi = 0; if (!cpt) reveil(false); }

  /* ---------- Courses du jour ---------- */
  function chargerJour() {
    $("#liste").innerHTML = '<p class="ch-muted ch-centre">Chargement…</p>'; $("#listeVide").hidden = true;
    api("jour").then(function (j) {
      if (!j.ok) { $("#liste").innerHTML = '<p class="ch-msg">' + esc(j.message || "Erreur.") + "</p>"; return; }
      var l = j.courses || [];
      $("#listeVide").hidden = l.length > 0;
      $("#liste").innerHTML = l.map(function (c, i) {
        var k = chip(c), T = c.trajet || {}, C = c.client || {};
        return '<button type="button" class="ch-item" data-i="' + i + '"><span class="ch-item__haut"><span class="ch-item__prix">' + esc(eur(c.montant)) + '</span><span class="ch-chip ch-chip--' + k[1] + '">' + esc(k[0]) + "</span></span>" +
          '<span class="ch-item__trajet">' + esc((T.depart || "") + " → " + (T.destination || "")) + "</span>" +
          '<span class="ch-item__bas">' + esc([heureFr(c.reservationLe), c.ref, [C.prenom, C.nom].filter(Boolean).join(" "), c.horsStripe ? libelleMoyen(c.horsStripe.moyen) : (c.enLigne ? "en ligne" : ""), c.apporteur].filter(Boolean).join(" · ")) + "</span></button>";
      }).join("");
      var total = l.filter(function (c) { return PAYE.indexOf(c.statut) >= 0; }).reduce(function (a, c) { return a + c.montant; }, 0);
      if (total) $("#liste").insertAdjacentHTML("afterbegin", '<p class="ch-muted">Encaissé (aujourd\'hui et hier) : <b>' + esc(eur(total)) + "</b></p>");
      $("#liste").onclick = function (e) { var b = e.target.closest(".ch-item"); if (b) afficherCourse(l[+b.getAttribute("data-i")]); };
    });
  }

  /* ---------- Compteur ELEV8 : prix au temps et à la distance ---------- */
  var CLE_CPT = "elev8.compteur.encours";
  var T_DEFAUT = { priseEnCharge: 4.5, km: 1.9, heure: 45, seuilKmh: 20, minimum: 10, palier: 0.1 };
  var cpt = null, cptWatch = null, cptTick = 0, cptSauve = 0;
  function T() { return etat.tarifs || T_DEFAUT; }
  function erreurGps(err) {
    if (err && err.code === 1) return "Position bloquée par le téléphone. iPhone : Réglages › Confidentialité et sécurité › Service de localisation › Sites web Safari › « Lorsque l'app est active ». Puis dans Safari : bouton « aA » › Réglages du site web › Position › Autoriser.";
    if (err && err.code === 3) return "Le GPS met trop de temps à répondre : rapprochez-vous d'une fenêtre ou sortez, puis réessayez.";
    return "Position introuvable pour l'instant (intérieur ?) : réessayez dehors ou saisissez l'adresse.";
  }
  // Tarifs rappelés sous le bouton Départ (information du client avant la course)
  function afficherTarifs() {
    var t = T();
    $("#cptTarifs").textContent = "Prise en charge " + eur(t.priseEnCharge) + " · " + eur(t.km) + " / km · attente et bouchons " + eur(t.heure / 60) + " / min · minimum " + eur(t.minimum) + " · péages en sus";
  }
  afficherTarifs();
  // Même formule que le serveur (netlify/lib/compteur.mjs)
  // Prix au palier de 0,10 € atteint (même calcul que le serveur)
  function prixBrut(c) {
    var t = T(), pas = t.palier || 0.1, exact = t.priseEnCharge + Math.round(c.km * t.km * 100) / 100 + Math.round((c.lentSec / 3600) * t.heure * 100) / 100;
    return Math.round(Math.floor(exact / pas + 1e-6) * pas * 100) / 100;
  }
  function peagesDe(c) { return num(c.peages) > 0 ? num(c.peages) : 0; }
  // Prix final (identique au serveur, netlify/lib/compteur.mjs) : minimum de course appliqué à l'arrivée
  function prixCompteur(c) { return Math.max(T().minimum, prixBrut(c)) + peagesDe(c); }
  function distM(a, b) {
    var R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function sauverCpt() { ecrireLocal(CLE_CPT, cpt ? JSON.stringify(cpt) : ""); }
  function surPosition(pos) {
    if (!cpt) return;
    var c = pos.coords, p = { lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now() };
    cpt.gpsT = Date.now(); cpt.precision = Math.round(c.accuracy || 0);
    if (c.accuracy > 60) { majEcran(); return; }                          // point trop imprécis : ignoré
    var dernier = cpt.dernier;
    cpt.dernier = p;
    if (!dernier) { majEcran(); return; }
    var dt = (p.t - dernier.t) / 1000; if (dt <= 0) return;
    var d = distM(dernier, p), v = (c.speed != null && c.speed >= 0) ? c.speed : d / dt;
    if (v > 70) { cpt.dernier = dernier; return; }                         // saut GPS (> 250 km/h) : ignoré
    cpt.vitesse = v; cpt.vitesseT = Date.now();
    // Comme un taxi : au-dessus du seuil, c'est la distance qui compte ; en dessous, c'est le temps (compté chaque seconde)
    if (!cpt.attente && v * 3.6 >= T().seuilKmh && d >= 3) cpt.km += d / 1000;
    majEcran();
  }
  function seconde() {
    if (!cpt) return;
    var lent = cpt.attente || !cpt.vitesseT || Date.now() - cpt.vitesseT > 8000 || cpt.vitesse * 3.6 < T().seuilKmh;
    if (lent) cpt.lentSec += 1;
    cpt.lent = lent;
    majEcran();
    if (++cptSauve % 5 === 0) sauverCpt();
  }
  function deuxChiffres(n) { return ("0" + n).slice(-2); }
  // Affichage uniquement : aucune valeur de calcul n'est modifiée ici
  function majEcran() {
    if (!cpt) return;
    cpt.peages = $("#cptPeages").value;
    var brut = prixBrut(cpt);
    $("#cptPrix").textContent = eur(brut + peagesDe(cpt));                // le compteur démarre à la prise en charge
    $("#cptKm").textContent = cpt.km.toFixed(1).replace(".", ",");
    $("#cptPrixKm").textContent = cpt.km >= 1 ? eur(brut / cpt.km) : "—";            // moyenne affichée à partir de 1 km
    var s2 = Math.max(0, Math.floor((Date.now() - cpt.debutMs) / 1000));
    $("#cptDuree").textContent = deuxChiffres(Math.floor(s2 / 3600)) + ":" + deuxChiffres(Math.floor(s2 / 60) % 60) + ":" + deuxChiffres(s2 % 60);
    $("#cptLent").textContent = deuxChiffres(Math.floor(cpt.lentSec / 60)) + ":" + deuxChiffres(Math.floor(cpt.lentSec % 60));
    $("#cptPec").textContent = (cpt.depart || "—") + (cpt.debutMs ? " · " + heureFr(new Date(cpt.debutMs).toISOString()) : "");
    $("#cptEtat").textContent = cpt.attente ? "Client en attente" : "En course";
    $("#cptIndic").textContent = cpt.attente ? "Client en attente" : "Course en cours";
    $("#cptRoule").classList.toggle("is-attente", !!cpt.attente);
    $("#cptAttente").classList.toggle("is-actif", !!cpt.attente);
    $("#cptReprendre").classList.toggle("is-actif", !cpt.attente);
    $("#cptGps").textContent = !cpt.gpsT ? "GPS · recherche…" : (Date.now() - cpt.gpsT > 20000 ? "GPS · signal perdu, distance vérifiée à l'arrivée" : "GPS · " + cpt.precision + " m");
  }
  function lancerMesure() {
    if (navigator.geolocation) cptWatch = navigator.geolocation.watchPosition(surPosition, function () { $("#cptGps").textContent = "GPS · indisponible : autorisez la position"; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    cptTick = setInterval(seconde, 1000);
    reveil(true);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && cpt) reveil(true); });
  }
  function arreterMesure() {
    if (cptWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(cptWatch);
    cptWatch = null; if (cptTick) clearInterval(cptTick); cptTick = 0; reveil(false);
  }
  function afficherRoule() { $("#cptPrepa").hidden = true; $("#cptRoule").hidden = false; montrer("vueCompteur"); majEcran(); }
  function afficherPrepa() { $("#cptPrepa").hidden = false; $("#cptRoule").hidden = true; }

  $("#cptPosition").addEventListener("click", function () {
    var b = this;
    if (!navigator.geolocation) { msg($("#cptMsg"), "Position indisponible."); return; }
    occupe(b, true); msg($("#cptMsg"), "Recherche de votre position…", true);
    navigator.geolocation.getCurrentPosition(function (pos) {
      etat.cptPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      api("position", etat.cptPos).then(function (j) {
        occupe(b, false);
        if (j.ok) { $("#cptDepart").value = j.adresse; msg($("#cptMsg"), ""); }
        else { $("#cptDepart").value = "Position GPS " + etat.cptPos.lat.toFixed(5) + ", " + etat.cptPos.lon.toFixed(5); msg($("#cptMsg"), "Position trouvée, mais pas l'adresse exacte : vous pouvez la préciser (nom de l'hôtel…).", true); }
      });
    }, function (err) { occupe(b, false); msg($("#cptMsg"), erreurGps(err)); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
  // Véhicule : le dernier choisi est retenu sur ce téléphone
  var CLE_VEH = "elev8.compteur.vehicule";
  (function () { var v = lireLocal(CLE_VEH); if (v) { var r = document.querySelector('input[name="cptVehicule"][value="' + (v === "van" ? "van" : "confort") + '"]'); if (r) r.checked = true; } })();
  document.querySelectorAll('input[name="cptVehicule"]').forEach(function (r) { r.addEventListener("change", function () { ecrireLocal(CLE_VEH, r.value); }); });

  // Départ : un seul appui. Position GPS prise automatiquement (8 s maximum), infos client facultatives.
  $("#cptPrepa").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("#cptGo");
    if (cpt) return;
    occupe(b, true); msg($("#cptMsg"), "Départ…", true);
    var partir = function (position) {
      var data = { depart: $("#cptDepart").value.trim(), position: position || etat.cptPos || null, apporteur: $("#cptApporteur").value.trim(),
        vehicule: document.querySelector('input[name="cptVehicule"]:checked').value, passagers: $("#cptPassagers").value,
        client: { prenom: $("#cptPrenom").value.trim(), nom: $("#cptNom").value.trim(), telephone: $("#cptTel").value.trim() } };
      api("compteur-depart", data).then(function (j) {
        occupe(b, false);
        if (!j.ok) { msg($("#cptMsg"), j.message || "Impossible de démarrer."); return; }
        msg($("#cptMsg"), "");
        cpt = { ref: j.compteur.ref, debutMs: Date.parse(j.compteur.debut), km: 0, lentSec: 0, attente: false, dernier: null, peages: "", depart: j.compteur.depart.adresse };
        $("#cptPeages").value = ""; sauverCpt(); afficherRoule(); lancerMesure();
        var veh = document.querySelector('input[name="cptVehicule"]:checked').value;
        $("#cptPrepa").reset(); etat.cptPos = null;
        var r = document.querySelector('input[name="cptVehicule"][value="' + veh + '"]'); if (r) r.checked = true;
        var d = $("#cptPrepa").querySelector("details"); if (d) d.open = false;
      });
    };
    if (!navigator.geolocation) { partir(null); return; }
    navigator.geolocation.getCurrentPosition(function (p) { partir({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      function () { partir(null); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  });
  // « Attendre client » met le compteur en attente ; « Prise en charge » reprend la course (même état qu'avant)
  $("#cptAttente").addEventListener("click", function () { if (!cpt) return; cpt.attente = true; sauverCpt(); majEcran(); });
  $("#cptReprendre").addEventListener("click", function () { if (!cpt) return; cpt.attente = false; sauverCpt(); majEcran(); });
  $("#cptPeages").addEventListener("input", majEcran);
  $("#cptStop").addEventListener("click", function () {
    if (!cpt) return;
    var b = this, prix = prixCompteur(cpt), brut = prixBrut(cpt) + peagesDe(cpt);
    if (!window.confirm("Terminer la course ? Prix à payer : " + eur(prix) + (prix > brut + 0.004 ? " (compteur " + eur(brut) + ", course minimum " + eur(T().minimum) + ")" : "") + ".")) return;
    occupe(b, true); msg($("#cptStopMsg"), "Calcul du prix final…", true);
    var envoyer = function (position) {
      api("compteur-arrivee", { ref: cpt.ref, km: cpt.km, lentSec: cpt.lentSec, peages: $("#cptPeages").value, position: position }).then(function (j) {
        occupe(b, false);
        if (!j.ok) { msg($("#cptStopMsg"), j.message || "Erreur : réessayez."); return; }
        msg($("#cptStopMsg"), ""); arreterMesure(); cpt = null; sauverCpt(); afficherPrepa();
        afficherCourse(j.course);
      });
    };
    var d = cpt.dernier;
    if (d && Date.now() - cpt.gpsT < 30000) envoyer({ lat: d.lat, lon: d.lon });
    else if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { envoyer({ lat: p.coords.latitude, lon: p.coords.longitude }); }, function () { envoyer(null); }, { enableHighAccuracy: true, timeout: 8000 });
    else envoyer(null);
  });
  $("#cptAbandon").addEventListener("click", function () {
    if (!cpt || !window.confirm("Annuler cette course au compteur ? Rien ne sera facturé.")) return;
    api("compteur-annuler", { ref: cpt.ref }).then(function (j) {
      if (!j.ok && j.status !== 409) { msg($("#cptStopMsg"), j.message); return; }
      arreterMesure(); cpt = null; sauverCpt(); afficherPrepa(); montrer("vueCompteur");
    });
  });
  // Reprise après rechargement de la page ou retour dans l'application
  window.Compteur = { reprendre: function () {
    var brut = lireLocal(CLE_CPT); if (!brut) return false;
    try { cpt = JSON.parse(brut); } catch (e) { cpt = null; }
    if (!cpt || !cpt.ref) { cpt = null; return false; }
    cpt.dernier = null; cpt.vitesseT = 0;
    $("#cptPeages").value = cpt.peages || "";
    afficherRoule(); lancerMesure();
    api("compteur-etat", { ref: cpt.ref }).then(function (j) { if (j.ok && !j.compteur) { arreterMesure(); cpt = null; sauverCpt(); afficherPrepa(); } });
    return true;
  } };

  /* ---------- Démarrage : session enregistrée → directement ouvert ---------- */
  if (lireLocal(CLE)) {
    api("verifier").then(function (j) {
      if (j.ok) ouvert(j);
      else if (j.status === 0) { ouvert({ stripe: true }); msg($("#prixMsg"), j.message); }      // hors réseau : on reste connecté
      else if (j.status !== 401) afficherLock(j.message);
    });
  } else afficherLock("");
})();
