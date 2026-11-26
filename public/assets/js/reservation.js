/* ==========================================================================
   ELEV8 Private Driver — formulaire de réservation avec estimation
   --------------------------------------------------------------------------
   Code COMMUN à :
     - la rubrique « Réservation » de l'accueil (et le mode passager du QR code) ;
     - la page dédiée /reservation (publicités Google Ads, Facebook Ads…).
   Estimation calculée par la fonction Netlify /estimation (grille ELEV8),
   demande envoyée à /envoi-reservation (Brevo) ; paiement éventuel ensuite, sur la page Stripe.
   Tout le contenu provient de config.js.
   Préselection possible par le lien : /reservation?vehicule=tesla | classe-v
   et /reservation?prestation=<titre exact d'une prestation>.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.SITE_CONFIG;
  if (!C || !document.getElementById("bookingForm")) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var services = C.prestations.liste || [];
  var vehicles = C.flotte.vehicules || [];
  var PAGE = document.body.classList.contains("page-resa");   // page dédiée /reservation (sans main.js)

  /* ---------- Origine de la visite (sans cookie ni stockage) — même règle que main.js ---------- */
  var ORIGINE = (function () {
    var o = { code: "", libelle: (C.suivi && C.suivi.libelleDirect) || "Accès direct", utm: {} };
    try {
      var q = new URLSearchParams(location.search);
      var clean = function (v) { return (v || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60); };
      var src = clean(q.get("src"));
      ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function (k) { var v = clean(q.get(k)); if (v) o.utm[k] = v; });
      var labels = (C.suivi && C.suivi.sources) || {};
      if (src) { o.code = src; o.libelle = labels[src] || src; }
      else if (o.utm.utm_source) { o.code = o.utm.utm_source; o.libelle = labels[o.utm.utm_source] || o.utm.utm_source; }
      if (q.get("bord") === "1" || document.documentElement.classList.contains("is-bord")) {
        o.bord = true;
        if (!src) { o.code = "bord"; o.libelle = (C.suivi && C.suivi.libelleBord) || "QR code à bord"; }
      }
      if (o.utm.utm_campaign) o.libelle += " — campagne " + o.utm.utm_campaign;
    } catch (e) {}
    return o;
  })();

  /* ---------- Suivi des conversions (préparé, AUCUN outil publicitaire chargé) ----------
     Chaque action utile est publiée de deux façons, sans rien envoyer hors du navigateur :
       - window.dataLayer.push({ event: "elev8_…", … })   (format lu par Google Tag Manager) ;
       - un événement navigateur « elev8:suivi » (pour tout autre outil).
     Événements : elev8_demande_envoyee (demande réellement acceptée par le serveur, une seule fois),
     elev8_clic_appel, elev8_clic_whatsapp. Aucune donnée personnelle (ni nom, ni téléphone).
     Brancher Google Ads ou Meta plus tard exige un bandeau de consentement (CNIL) : voir le guide. */
  function suivi(nom, infos) {
    var d = { event: "elev8_" + nom, elev8_page: PAGE ? "reservation" : "accueil", elev8_origine: ORIGINE.code || "direct" };
    for (var k in infos) if (Object.prototype.hasOwnProperty.call(infos, k)) d[k] = infos[k];
    try { (window.dataLayer = window.dataLayer || []).push(d); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("elev8:suivi", { detail: d })); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var h = a.getAttribute("href") || "", ou = (a.closest("[id]") || {}).id || "";
    if (/^tel:/i.test(h)) suivi("clic_appel", { elev8_emplacement: ou });
    else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(a.href)) suivi("clic_whatsapp", { elev8_emplacement: ou });
  }, true);

  /* ---------- Page /reservation : textes et liens de contact (sur l'accueil, main.js s'en charge) ---------- */
  if (PAGE) {
    var get = function (path) { return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, C); };
    $$("[data-c]").forEach(function (el) { var v = get(el.getAttribute("data-c")); if (v != null) el.textContent = v; });
    $$("[data-html]").forEach(function (el) { var v = get(el.getAttribute("data-html")); if (v != null) el.innerHTML = v; });
    var waTxt = (C.reservation.messageWhatsAppDirect || "Bonjour, je souhaite des renseignements pour un trajet.") +
      (ORIGINE.code ? "\n\n(Origine : " + ORIGINE.libelle + ")" : "");
    $$("[data-wa-direct]").forEach(function (a) {
      a.href = C.contact.whatsappLien && !ORIGINE.code ? C.contact.whatsappLien
             : "https://wa.me/" + String(C.contact.whatsapp).replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(waTxt);
    });
    $$(".js-tel").forEach(function (a) { a.href = "tel:" + C.contact.telephone; });
    $$(".js-mail").forEach(function (a) { a.href = "mailto:" + C.contact.email; });
    $$(".js-year").forEach(function (el) { el.textContent = new Date().getFullYear(); });
    // Professionnels (hôtels, entreprises, restaurants, conciergeries) : contact direct, sans parcours dédié
    var proTxt = ((C.pageReservation && C.pageReservation.proMessageWhatsApp) || "Bonjour ELEV8, je vous contacte pour des trajets professionnels.") +
      (ORIGINE.code ? "\n\n(Origine : " + ORIGINE.libelle + ")" : "");
    $$("[data-wa-pro]").forEach(function (a) { a.href = "https://wa.me/" + String(C.contact.whatsapp).replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(proTxt); });
    var proLien = $("#proLien");
    if (proLien) proLien.addEventListener("click", function (e) {
      e.preventDefault();
      var ouvert = proLien.getAttribute("aria-expanded") === "true";
      proLien.setAttribute("aria-expanded", String(!ouvert)); $("#pro").hidden = ouvert;
    });
  }
  // Fiche contact : proposée seulement après l'envoi réussi d'une demande
  $$(".js-vcf-sent").forEach(function (a) { a.href = (C.ficheContact && C.ficheContact.url) || "/elev8-private-driver.vcf"; });

  /* ---------- Formulaire ---------- */
  var form = $("#bookingForm");
  var svcSel = $("#f-service");
  svcSel.innerHTML = '<option value="">Je précise plus tard</option>' +
    services.map(function (s) { return "<option>" + esc(s.titre) + "</option>"; }).join("");

  // N° de vol / de train : visible uniquement pour les transferts correspondants
  var REF_LABELS = { vol: "N° de vol", train: "N° de train", "vol-train": "N° de vol ou de train" };
  var REF_PH = { vol: "Ex. : AF1142", train: "Ex. : TGV 6201", "vol-train": "Ex. : LX1234 ou TGV 6501" };
  function refKind() {
    var s = services.filter(function (x) { return x.titre === svcSel.value; })[0];
    return s && s.transfert ? s.transfert : "";
  }
  function updateRef() {
    var k = refKind();
    $("#refField").hidden = !k;
    if (k) { $("#refLabel").textContent = REF_LABELS[k]; $("#f-ref").placeholder = REF_PH[k]; }
  }
  svcSel.addEventListener("change", updateRef);
  updateRef();

  var NO_PREF = { id: "indifferent", nom: "Pas de préférence", passagersMax: Math.max.apply(null, vehicles.map(function (v) { return v.passagersMax || 1; }).concat([1])) };
  var choices = vehicles.concat([NO_PREF]);
  $("#vehicleChoice").innerHTML = choices.map(function (v, i) {
    var label = v === NO_PREF ? "Indifférent" : (v.nomCourt || v.nom);
    var meta = v === NO_PREF ? "Selon le trajet" : (v.passagersMax ? "Jusqu'à " + v.passagersMax : "");
    return '<div class="vchoice"><input type="radio" name="vehicle" id="v-' + esc(v.id) + '" value="' + esc(v.id) + '"' + (i === choices.length - 1 ? " checked" : "") + ">" +
      '<label for="v-' + esc(v.id) + '" title="' + esc(v.nom) + '"><span class="vchoice__name">' + esc(label) + '</span><span class="vchoice__meta">' + esc(meta) + "</span></label></div>";
  }).join("");

  var paxSel = $("#f-pax");
  function fillPax() {
    var id = (form.querySelector('input[name="vehicle"]:checked') || {}).value;
    var v = choices.filter(function (c) { return c.id === id; })[0] || NO_PREF;
    var max = v.passagersMax || 8, cur = parseInt(paxSel.value, 10) || 1, html = "";
    for (var n = 1; n <= max; n++) html += "<option value=\"" + n + "\">" + n + (n > 1 ? " passagers" : " passager") + "</option>";
    paxSel.innerHTML = html; paxSel.value = String(Math.min(cur, max));
  }
  fillPax();
  form.addEventListener("change", function (e) { if (e.target.name === "vehicle") fillPax(); });

  // Bagages (facultatif) : transmis à ELEV8 avec la demande
  var bagsSel = $("#f-bags");
  bagsSel.innerHTML = '<option value="">Non précisé</option>' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) {
    return '<option value="' + n + '">' + (n === 0 ? "Aucun bagage" : n + (n > 1 ? " bagages" : " bagage")) + "</option>";
  }).join("");

  // Aller-retour : date et heure du retour affichées seulement si la case est cochée
  var arBox = $("#f-ar");
  function updateAR() {
    $("#retDateField").hidden = $("#retTimeField").hidden = !arBox.checked;
    if (arBox.checked && !$("#f-retdate").value && $("#f-date").value) $("#f-retdate").value = $("#f-date").value;
    $("#f-retdate").min = $("#f-date").value || $("#f-date").min;
  }
  arBox.addEventListener("change", updateAR);
  $("#f-date").addEventListener("change", function () { $("#f-retdate").min = $("#f-date").value || $("#f-date").min; });

  // Présélection depuis la flotte et les destinations
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-pick],[data-service]");
    if (!a) return;
    if (a.hasAttribute("data-pick")) { var r = $("#v-" + a.getAttribute("data-pick")); if (r) { r.checked = true; fillPax(); } }
    if (a.hasAttribute("data-service")) { svcSel.value = a.getAttribute("data-service"); updateRef(); }
  });

  // Indicatifs téléphoniques
  var COUNTRIES = [
    ["+33", "FR"], ["+41", "CH"], ["+377", "MC"], ["+32", "BE"], ["+352", "LU"], ["+39", "IT"],
    ["+49", "DE"], ["+34", "ES"], ["+44", "GB"], ["+31", "NL"], ["+1", "US/CA"]
  ];
  var ccSel = $("#f-cc");
  ccSel.innerHTML = COUNTRIES.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + " " + c[0] + "</option>"; }).join("");
  ccSel.value = /-CH$/i.test(navigator.language || "") ? "+41" : (C.reservation.indicatifParDefaut || "+33");
  var PH_EX = { "+33": "6 12 34 56 78", "+41": "79 123 45 67" };
  function updatePhPlaceholder() { $("#f-phone").placeholder = PH_EX[ccSel.value] || "Numéro"; }
  ccSel.addEventListener("change", updatePhPlaceholder); updatePhPlaceholder();

  /* Normalise un numéro au format international E.164 (+33612345678).
     Un numéro saisi avec + ou 00 l'emporte sur l'indicatif choisi. */
  var PHONE_RULES = {
    "+33": /^\+33[1-9]\d{8}$/, "+41": /^\+41[1-9]\d{8}$/, "+377": /^\+377\d{8,9}$/,
    "+32": /^\+32\d{8,9}$/, "+352": /^\+352\d{6,11}$/, "+39": /^\+39\d{6,11}$/,
    "+49": /^\+49\d{6,13}$/, "+34": /^\+34[6-9]\d{8}$/, "+44": /^\+44\d{9,10}$/,
    "+31": /^\+31\d{9}$/, "+1": /^\+1[2-9]\d{9}$/
  };
  function normalizePhone(cc, raw) {
    var s = String(raw || "").replace(/[\s.\-()\/]/g, "");
    if (!s) return "";
    if (/^00/.test(s)) s = "+" + s.slice(2);
    if (s.charAt(0) !== "+") s = cc + (cc === "+39" ? s : s.replace(/^0/, ""));
    else s = s.replace(/^(\+33|\+41|\+32|\+49|\+31|\+44)0/, "$1"); // +33 (0)6… → +336…
    return s;
  }
  function validPhone(e164) {
    if (!/^\+[1-9]\d{7,14}$/.test(e164)) return false;
    var keys = Object.keys(PHONE_RULES).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) if (e164.indexOf(keys[i]) === 0) return PHONE_RULES[keys[i]].test(e164);
    return true; // autre pays : contrôle E.164 générique
  }
  function formatPhone(e) {
    var m;
    if ((m = e.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/))) return "+33 " + m.slice(1).join(" ");
    if ((m = e.match(/^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/))) return "+41 " + m.slice(1).join(" ");
    return e;
  }

  // Date minimale = aujourd'hui
  var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
  $("#f-date").min = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

  var validators = {
    date: function (v) { return !!v && v >= $("#f-date").min; },
    time: function (v) { return /^\d{2}:\d{2}/.test(v); },
    from: function (v) { return v.trim().length > 2; },
    to: function (v) { return v.trim().length > 2; },
    lastname: function (v) { return v.trim().length > 0; },
    firstname: function (v) { return v.trim().length > 0; },
    retdate: function (v) { return !arBox.checked || (!!v && v >= ($("#f-date").value || $("#f-date").min)); },
    rettime: function (v) {
      if (!arBox.checked) return true;
      if (!/^\d{2}:\d{2}/.test(v)) return false;
      return $("#f-retdate").value !== $("#f-date").value || v.slice(0, 5) > $("#f-time").value.slice(0, 5);
    },
    phone: function (v) { return validPhone(normalizePhone(ccSel.value, v)); },
    email: function (v) { v = v.trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }   // obligatoire : le devis est envoyé par e-mail
  };
  function fieldOf(name) { return form.elements[name].closest(".field"); }
  function check(name) {
    var ok = validators[name](form.elements[name].value);
    fieldOf(name).classList.toggle("is-invalid", !ok);
    form.elements[name].setAttribute("aria-invalid", ok ? "false" : "true");
    return ok;
  }
  Object.keys(validators).forEach(function (n) {
    ["blur", "input"].forEach(function (ev) {
      form.elements[n].addEventListener(ev, function () { if (fieldOf(n).classList.contains("is-invalid")) check(n); });
    });
  });
  ccSel.addEventListener("change", function () { if (fieldOf("phone").classList.contains("is-invalid")) check("phone"); });
  /* Touche « Suivant » du clavier : passe au champ suivant au lieu d'envoyer le formulaire */
  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT" || e.isComposing) return;
    e.preventDefault();
    var list = $$("input, select, textarea", form).filter(function (el) {
      return !el.closest("[hidden]") && !el.closest(".hp") && el.type !== "radio" && el.offsetParent !== null;
    });
    var next = list[list.indexOf(e.target) + 1];
    if (next && e.target.id !== "f-email") next.focus(); else e.target.blur();
  });

  function validateAll() {
    var bad = Object.keys(validators).filter(function (n) { return !check(n); });
    if (bad.length) { form.elements[bad[0]].focus(); return false; }
    return true;
  }

  function longDate(iso) {
    try {
      var p = iso.split("-");
      var s = new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      return s.charAt(0).toUpperCase() + s.slice(1);
    } catch (e) { return iso; }
  }

  /* ---------- Estimation du tarif (calculée par le serveur, grille ELEV8) ----------
     Recalculée dès que le trajet, l'horaire ou le véhicule change. Le montant reçu est
     accompagné d'un jeton signé : le serveur d'envoi refuse tout montant modifié. */
  var E = (C.reservation && C.reservation.estimation) || {};
  var estBox = $("#estimate"), estAmount = $("#estAmount"), estMeta = $("#estMeta"), estRecap = $("#estRecap");
  var estimation = null, estKey = "", estSeq = 0, estTimer = null;
  var fmtEuro = function (n) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €"; };
  function vehicleName() {
    var vId = (form.querySelector('input[name="vehicle"]:checked') || {}).value;
    return (choices.filter(function (c) { return c.id === vId; })[0] || NO_PREF).nom;
  }
  function trip() {
    var f = form.elements, ar = arBox.checked;
    return {
      prestation: f.service.value || "", depart: f.from.value.trim(), destination: f.to.value.trim(),
      date: f.date.value, heure: f.time.value.slice(0, 5), allerRetour: ar,
      dateRetour: ar ? f.retdate.value : "", heureRetour: ar ? f.rettime.value.slice(0, 5) : "",
      vehicule: vehicleName(), passagers: parseInt(f.pax.value, 10) || 1
    };
  }
  function tripReady(t) {
    return t.depart.length > 2 && t.destination.length > 2 && validators.date(t.date) && validators.time(t.heure) &&
      (!t.allerRetour || (validators.retdate(t.dateRetour) && validators.rettime(t.heureRetour)));
  }
  function showEstimate(etat, montant, meta) {
    estBox.setAttribute("data-etat", etat);
    estAmount.textContent = montant;
    estMeta.textContent = meta;
    if (etat === "ok" || etat === "devis") {
      estRecap.hidden = false;
      estRecap.innerHTML = etat === "ok"
        ? "Estimation : <strong>" + esc(montant) + "</strong> · aucun paiement à cette étape"
        : "Tarif <strong>sur devis</strong> · demande sans engagement, ELEV8 vous communique le tarif";
    } else estRecap.hidden = true;
  }
  function estimate() {
    var t = trip(), key = JSON.stringify(t);
    if (!tripReady(t)) { estimation = null; estKey = ""; estSeq++; showEstimate("attente", "—", E.attente || ""); return; }
    if (key === estKey) return;
    estKey = key; estimation = null;
    var my = ++estSeq;
    showEstimate("calcul", "…", E.calcul || "Calcul de votre estimation…");
    fetch((C.formulaire && C.formulaire.endpointEstimation) || "/estimation", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(t), credentials: "same-origin"
    }).then(function (r) { return r.json().catch(function () { return null; }); }).then(function (j) {
      if (my !== estSeq) return;                                   // une saisie plus récente a pris le relais
      if (!j || !j.ok || !j.estimation) {
        estKey = (j && j.code && j.code !== "indisponible" && j.code !== "limite") ? key : "";   // erreur passagère : nouvel essai au prochain changement
        showEstimate("erreur", "—", (j && j.message) || "Estimation momentanément indisponible. Vous pouvez tout de même envoyer votre demande : nous vous communiquerons le tarif.");
        return;
      }
      var r = j.estimation; estimation = r;
      if (r.statut === "estimation") {
        showEstimate("ok", fmtEuro(r.montant), r.vehicule + (r.allerRetour ? " · aller-retour" : "") + " · " + String(r.distanceKm).replace(".", ",") + " km");
      } else {
        showEstimate("devis", E.surDevis || "Sur devis", r.motif === "mise_a_disposition" ? (E.miseADisposition || "") : (E.horsZone || ""));
      }
    }).catch(function () {
      if (my !== estSeq) return;
      estKey = "";
      showEstimate("erreur", "—", "Estimation momentanément indisponible. Vous pouvez tout de même envoyer votre demande : nous vous communiquerons le tarif.");
    });
  }
  function scheduleEstimate(delay) { clearTimeout(estTimer); estTimer = setTimeout(estimate, delay == null ? 500 : delay); }
  // Adresses : au choix d'une suggestion ou en quittant le champ ; horaire et véhicule : à chaque changement
  form.addEventListener("change", function (e) {
    if (/^(from|to|date|time|ar|retdate|rettime|vehicle|pax|service)$/.test(e.target.name)) scheduleEstimate(e.target.name === "from" || e.target.name === "to" ? 150 : 400);
  });
  ["time", "rettime"].forEach(function (n) { form.elements[n].addEventListener("input", function () { scheduleEstimate(900); }); });
  function estimationRow() {
    if (estimation && estKey === JSON.stringify(trip())) {
      return estimation.statut === "estimation" ? ["Estimation", fmtEuro(estimation.montant) + " (indicative, à confirmer par ELEV8)"] : ["Tarif", "Sur devis, communiqué par ELEV8"];
    }
    return null;
  }

  /* Rassemble la demande : données envoyées au serveur + lignes du récapitulatif */
  function collect() {
    var f = form.elements;
    var vName = vehicleName();
    var kind = refKind();
    var data = {
      prestation: f.service.value || "",
      reference: kind ? f.ref.value.trim().toUpperCase() : "",
      typeReference: kind,
      date: f.date.value,
      heure: f.time.value.slice(0, 5),
      depart: f.from.value.trim(),
      destination: f.to.value.trim(),
      allerRetour: arBox.checked,
      dateRetour: arBox.checked ? f.retdate.value : "",
      heureRetour: arBox.checked ? f.rettime.value.slice(0, 5) : "",
      passagers: parseInt(f.pax.value, 10) || 1,
      bagages: f.bags.value,
      vehicule: vName,
      nom: f.lastname.value.trim(),
      prenom: f.firstname.value.trim(),
      telephone: normalizePhone(ccSel.value, f.phone.value),
      email: f.email.value.trim(),
      societe: f.company.value.trim(),
      precisions: f.msg.value.trim(),
      origine: { code: ORIGINE.code, libelle: ORIGINE.libelle, utm: ORIGINE.utm }
    };
    var rows = [
      ["Prestation", data.prestation || "À préciser"]
    ];
    if (data.reference) rows.push([REF_LABELS[kind], data.reference]);
    rows.push(
      ["Date", longDate(data.date)],
      ["Heure", data.heure.replace(":", "h")],
      ["Départ", data.depart],
      ["Destination", data.destination]
    );
    if (data.allerRetour) rows.push(["Retour", longDate(data.dateRetour) + " à " + data.heureRetour.replace(":", "h")]);
    rows.push(["Passagers", String(data.passagers)]);
    if (data.bagages !== "") rows.push(["Bagages", data.bagages === "0" ? "Aucun" : data.bagages]);
    rows.push(["Véhicule", data.vehicule]);
    if (data.precisions) rows.push(["Informations complémentaires", data.precisions]);
    var er = estimationRow(); if (er) rows.push(er);
    rows.push(["Nom", data.prenom + " " + data.nom], ["Téléphone", formatPhone(data.telephone)]);
    if (data.email) rows.push(["E-mail", data.email]);
    if (data.societe) rows.push(["Société", data.societe]);
    return { data: data, rows: rows };
  }
  function rowsHtml(rows) {
    return rows.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
  }
  function showPanel(id) {
    form.hidden = id !== "form";
    $("#recap").hidden = id !== "recap";
    $("#sent").hidden = id !== "sent";
    var el = id === "form" ? form : $("#" + id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (id !== "form") setTimeout(function () { el.focus({ preventScroll: true }); }, 400);
  }
  var status = $("#formStatus");
  function showError(html) { status.innerHTML = html; status.hidden = false; }
  function clearError() { status.hidden = true; status.innerHTML = ""; }

  /* ----- Mode 1 : WhatsApp (message prérempli, relu avant ouverture) ----- */
  var lastMessage = "";
  $("#waBtn").addEventListener("click", function () {
    clearError();
    if (!validateAll()) return;
    var c = collect();
    lastMessage = C.reservation.introMessage + "\n\n" +
      c.rows.map(function (r) { return "• " + r[0] + " : " + r[1]; }).join("\n") +
      "\n\nMerci de me confirmer la disponibilité." +
      (ORIGINE.code ? "\n\n(Origine : " + ORIGINE.libelle + ")" : "");
    $("#recapList").innerHTML = rowsHtml(c.rows);
    $("#waLink").href = "https://wa.me/" + String(C.contact.whatsapp).replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(lastMessage);
    showPanel("recap");
  });

  /* ----- Mode 2 : envoi direct au professionnel ----- */
  var startedAt = Date.now();
  var sending = false;
  /* Identifiant de la demande : un double clic ou un renvoi après coupure réseau
     ne crée jamais deux demandes (le serveur reconnaît l'identifiant pendant 24 h). */
  function newDemandeId() {
    var a = "";
    try { var b = new Uint8Array(12); crypto.getRandomValues(b); for (var i = 0; i < b.length; i++) a += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(b[i] % 36); }
    catch (e) { a = (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, "").slice(0, 16); }
    return Math.floor(Date.now() / 1000) + "-" + a;
  }
  var demandeId = newDemandeId();
  var suiviEnvoye = {};
  $("#formCall").href = "tel:" + C.contact.telephone;
  var cfgForm = C.formulaire || {};
  var sendBtn = $("#sendBtn");
  var fallbackHtml = function () {
    return " Vous pouvez réessayer dans un instant, utiliser le bouton WhatsApp ou appeler le <span class=\"tel\">" + esc(C.contact.telephoneAffiche) + "</span>.";
  };

  // Cloudflare Turnstile (facultatif) : chargé uniquement si une clé publique est configurée
  // Mode « interaction-only » : invisible pour la plupart des visiteurs, une case n'apparaît qu'en cas de doute.
  var turnstileId = null, turnstileToken = "", turnstileFailed = false;
  if (cfgForm.turnstileSiteKey) {
    var box = $("#turnstileBox"); box.hidden = false;
    window.onTurnstileLoad = function () {
      turnstileId = window.turnstile.render(box, {
        sitekey: cfgForm.turnstileSiteKey, action: "reservation", theme: "dark", language: "fr",
        appearance: "interaction-only", "response-field": false,
        callback: function (t) { turnstileToken = t; turnstileFailed = false; },
        "expired-callback": function () { turnstileToken = ""; window.turnstile.reset(turnstileId); },
        "error-callback": function () { turnstileToken = ""; turnstileFailed = true; return true; }
      });
    };
    var ts = document.createElement("script");
    ts.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
    ts.async = true; ts.defer = true;
    ts.onerror = function () { turnstileFailed = true; };
    document.head.appendChild(ts);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    clearError();
    if (!validateAll()) return;

    var c = collect();
    var payload = c.data;
    payload.demandeId = demandeId;                       // anti-doublon
    if (estimation && estKey === JSON.stringify(trip())) payload.estimation = estimation;   // revérifiée par le serveur
    payload.website = form.elements.website.value;      // piège anti-robot
    payload.duree = Date.now() - startedAt;             // temps passé sur le formulaire
    if (cfgForm.turnstileSiteKey) {
      payload.turnstile = turnstileToken || (window.turnstile && turnstileId !== null ? window.turnstile.getResponse(turnstileId) : "") || "";
      if (!payload.turnstile) {
        showError(turnstileFailed
          ? "<strong class=\"st\">La vérification anti-robot n'a pas pu se charger.</strong> Un bloqueur de contenu ou la connexion peut en être la cause." + fallbackHtml()
          : "<strong class=\"st\">Vérification anti-robot en cours.</strong> Patientez quelques secondes, puis appuyez de nouveau sur « Demander ma réservation ».");
        return;
      }
    }

    sending = true;
    sendBtn.disabled = true; sendBtn.classList.add("is-loading");
    var label = sendBtn.querySelector("span"), labelText = label.textContent;
    label.textContent = "Envoi en cours";

    var ctrl = "AbortController" in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, cfgForm.delaiMaxMs || 15000);

    fetch(cfgForm.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: "same-origin"
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (err) {}
        return { res: res, json: j };
      });
    }).then(function (r) {
      // Confirmation affichée UNIQUEMENT si le serveur confirme explicitement la transmission
      if (r.res.ok && r.json && r.json.ok === true && r.json.ref) {
        $("#sentRef").textContent = "Référence " + r.json.ref;
        var rows = [["Référence", r.json.ref]].concat(c.rows.filter(function (x) { return x[0] !== "Estimation" && x[0] !== "Tarif"; }));
        var se = r.json.estimation;                                  // montant établi par le serveur
        var pay = r.json.paiement;                                   // lien de paiement créé par le serveur (trajet standard)
        if (pay && pay.url && pay.montant > 0) rows.splice(1, 0, ["Tarif", fmtEuro(pay.montant) + " TTC"]);
        else if (se && se.statut === "estimation" && se.montant > 0) rows.splice(1, 0, ["Estimation", fmtEuro(se.montant) + " (indicative, à confirmer par ELEV8)"]);
        else if (se) rows.splice(1, 0, ["Tarif", "Sur devis, communiqué par ELEV8"]);
        rows.splice(1, 0, ["Statut", pay && pay.url ? "Demande enregistrée · en attente de paiement" : "Demande reçue · en attente de validation"]);
        $("#sentList").innerHTML = rowsHtml(rows);
        afficherPaiement(pay);
        sent = true;
        if (!suiviEnvoye[payload.demandeId]) {                    // jamais compté deux fois (double clic, renvoi)
          suiviEnvoye[payload.demandeId] = true;
          suivi("demande_envoyee", { elev8_reference: r.json.ref, elev8_estimation: se && se.statut === "estimation" ? "oui" : "sur_devis",
            value: se && se.montant > 0 ? se.montant : 0, currency: "EUR" });
        }
        showPanel("sent");
        return;
      }
      if (r.json && r.json.error === "pending") { showError("<strong class=\"st\">Votre demande est en cours d'envoi.</strong> Patientez quelques secondes avant de réessayer : elle ne sera pas envoyée deux fois."); return; }
      if (r.json && r.json.error === "validation" && Array.isArray(r.json.fields)) {
        var map = { date: "date", heure: "time", depart: "from", destination: "to", nom: "lastname", prenom: "firstname", telephone: "phone", email: "email", dateRetour: "retdate", heureRetour: "rettime" };
        r.json.fields.forEach(function (k) { if (map[k]) { fieldOf(map[k]).classList.add("is-invalid"); } });
        showError("<strong class=\"st\">Certaines informations sont à vérifier.</strong> Corrigez les champs signalés puis renvoyez la demande.");
        return;
      }
      if (r.json && r.json.error === "busy") { showError("<strong class=\"st\">Le service d'envoi est momentanément saturé.</strong>" + fallbackHtml()); return; }
      if (r.json && r.json.error === "captcha") { showError("<strong class=\"st\">La vérification anti-robot a échoué.</strong> Rechargez la page puis renvoyez votre demande." + fallbackHtml()); return; }
      if (r.res.status === 429) { showError("<strong class=\"st\">Trop de demandes envoyées.</strong> Patientez quelques minutes." + fallbackHtml()); return; }
      showError("<strong class=\"st\">Votre demande n'a pas pu être transmise.</strong>" + fallbackHtml());
    }).catch(function () {
      showError("<strong class=\"st\">Votre demande n'a pas pu être transmise</strong> (connexion interrompue ou service indisponible)." + fallbackHtml());
    }).then(function () {
      clearTimeout(timer);
      sending = false; sendBtn.disabled = false; sendBtn.classList.remove("is-loading"); label.textContent = labelText;
      if (!status.hidden) status.scrollIntoView({ behavior: "smooth", block: "center" });
      // Un jeton Turnstile ne sert qu'une fois : on en redemande un après chaque tentative
      if (cfgForm.turnstileSiteKey && window.turnstile && turnstileId !== null) { turnstileToken = ""; window.turnstile.reset(turnstileId); }
    });
  });

  /* Conditions générales de vente : liens affichés seulement si legal.cgv est renseigné dans config.js */
  (function () {
    var cgv = C.legal && typeof C.legal.cgv === "string" ? C.legal.cgv.trim() : "";
    if (!/^(\/[^\s"'<>]*|https:\/\/[^\s"'<>]+)$/.test(cgv)) return;
    $$("[data-cgv]").forEach(function (a) { a.href = cgv; a.hidden = false; });
    $$('[data-html="reservation.noteConfidentialite"]').forEach(function (p) {
      if (p.querySelector("[data-cgv-note]")) return;
      var s = document.createElement("span"), a = document.createElement("a");
      s.setAttribute("data-cgv-note", ""); a.href = cgv; a.textContent = "conditions générales de vente";
      s.appendChild(document.createTextNode(" Le règlement du devis vaut acceptation de nos ")); s.appendChild(a); s.appendChild(document.createTextNode("."));
      p.appendChild(s);
    });
  })();

  /* Paiement en ligne : bouton vers le lien individuel (le montant est fixé par le serveur, jamais ici) */
  function afficherPaiement(pay) {
    var ancien = document.getElementById("sentPayer");
    if (ancien) ancien.parentNode.removeChild(ancien);
    // Note « Aucun paiement ne vous a été demandé » : remplacée seulement quand un lien de paiement est proposé
    var note = document.querySelector('#sent [data-c="reservation.envoi.note"]');
    if (note) {
      if (note.dataset.origine == null) note.dataset.origine = note.textContent;
      note.textContent = pay && pay.url ? "Aucun montant n'est prélevé sans votre action sur la page de paiement sécurisée. Pour toute question, appelez-nous ou écrivez-nous sur WhatsApp en indiquant votre référence." : note.dataset.origine;
    }
    if (!pay || typeof pay.url !== "string" || !/^\/payer\/[A-Za-z0-9_-]{24}$/.test(pay.url)) return;
    var bloc = document.createElement("div");
    bloc.id = "sentPayer"; bloc.className = "sent__payer";
    var a = document.createElement("a");
    a.className = "btn btn--gold"; a.href = pay.url;
    var sp = document.createElement("span"); sp.textContent = "Accepter le devis et payer en ligne (" + fmtEuro(pay.montant) + ")"; a.appendChild(sp);
    a.addEventListener("click", function () { suivi("clic_paiement", { value: pay.montant, currency: "EUR" }); });
    var p = document.createElement("p");
    p.textContent = (pay.email ? "Votre devis (PDF) et ce lien vous ont aussi été envoyés par e-mail. " : "") +
      "Le paiement vaut acceptation du devis. " +
      "Dès réception de votre règlement, nous attribuons votre course à un chauffeur ; vous recevrez la confirmation par e-mail. Sans chauffeur disponible, vous seriez intégralement remboursé." +
      (pay.mode === "test" ? " (Paiement en mode test : aucune somme réelle n'est prélevée.)" : "");
    bloc.appendChild(a); bloc.appendChild(p);
    var liste = $("#sentList"); liste.parentNode.insertBefore(bloc, liste.nextSibling);
  }
  $("#editBtn").addEventListener("click", function () { showPanel("form"); });
  var sent = false;
  $("#newBtn").addEventListener("click", function () {
    form.reset(); fillPax(); updateRef(); updatePhPlaceholder(); updateAR(); startedAt = Date.now();
    demandeId = newDemandeId(); sent = false; estimation = null; estKey = ""; estSeq++;
    showEstimate("attente", "—", E.attente || "");
    ccSel.value = C.reservation.indicatifParDefaut || "+33";
    showPanel("form");
  });

  $("#copyBtn").addEventListener("click", function () {
    var btn = this, lbl = btn.textContent;
    var done = function () { btn.textContent = "Message copié"; setTimeout(function () { btn.textContent = lbl; }, 2200); };
    var fallback = function () {
      var ta = document.createElement("textarea"); ta.value = lastMessage; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (err) {} document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lastMessage).then(done, fallback);
    else fallback();
  });

  /* ---------- Préselection depuis le lien (/reservation?vehicule=…&prestation=…) ---------- */
  try {
    var pq = new URLSearchParams(location.search);
    var pv = pq.get("vehicule"), ps = pq.get("prestation");
    if (pv && $("#v-" + pv.replace(/[^a-z0-9-]/gi, ""))) { $("#v-" + pv.replace(/[^a-z0-9-]/gi, "")).checked = true; fillPax(); }
    if (ps && services.some(function (x) { return x.titre === ps; })) { svcSel.value = ps; updateRef(); }
  } catch (e) {}
})();
