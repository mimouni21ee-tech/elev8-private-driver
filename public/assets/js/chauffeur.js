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
  var VUES = ["vueLock", "vueSaisie", "vueCourse", "vueJour"];
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
    $("#badgeTest").hidden = !j.test;
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
        if (!j.ok) { msg($("#prixMsg"), j.message); return; }
        $("#f-from").value = j.adresse; msg($("#prixMsg"), "Position : " + j.adresse + " (précisez le nom de l'hôtel si besoin).", true);
        invaliderPrix();
        if (!$("#f-to").value.trim()) $("#f-to").focus();
      });
    }, function (err) {
      occupe(b, false);
      msg($("#prixMsg"), err && err.code === 1 ? "Accès à la position refusé : autorisez-le dans Réglages › Safari (ou l'application) › Position." : "Position introuvable. Saisissez l'adresse.");
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
  function arreterSuivi() { if (etat.suivi) clearInterval(etat.suivi); etat.suivi = 0; reveil(false); }

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

  /* ---------- Démarrage : session enregistrée → directement ouvert ---------- */
  if (lireLocal(CLE)) {
    api("verifier").then(function (j) {
      if (j.ok) ouvert(j);
      else if (j.status === 0) { ouvert({ stripe: true }); msg($("#prixMsg"), j.message); }      // hors réseau : on reste connecté
      else if (j.status !== 401) afficherLock(j.message);
    });
  } else afficherLock("");
})();
