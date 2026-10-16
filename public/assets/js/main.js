/* Site vitrine chauffeur privé — script principal.
   Tout le contenu provient de config.js : ne modifiez ce fichier que pour changer le comportement. */
(function () {
  "use strict";
  var C = window.SITE_CONFIG;
  if (!C) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var get = function (path) { return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, C); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ---------- Textes simples ---------- */
  $$("[data-c]").forEach(function (el) { var v = get(el.getAttribute("data-c")); if (v != null) el.textContent = v; });
  $$("[data-html]").forEach(function (el) { var v = get(el.getAttribute("data-html")); if (v != null) el.innerHTML = v; });

  if (C.seo) {
    document.title = C.seo.titre;
    var md = $('meta[name="description"]'); if (md) md.setAttribute("content", C.seo.description);
    var og = $('meta[property="og:title"]'); if (og) og.setAttribute("content", C.seo.titre);
  }

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var canHover = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches);

  /* ---------- Accueil : titre révélé ligne par ligne ---------- */
  function splitLines(el, html, delayStart) {
    if (!el || !html) return;
    el.innerHTML = String(html).split(/<br\s*\/?>/i).map(function (part, i) {
      return '<span class="line"><span style="--i:' + (i + (delayStart || 0)) + '">' + part + "</span></span>";
    }).join("");
  }
  splitLines($("#heroTitle"), C.accueil && C.accueil.slogan);

  /* ---------- Mode passager à bord (QR code) ---------- */
  var root = document.documentElement;

  /* Introduction : le logo central glisse exactement à la place du logo de la page */
  if (root.classList.contains("has-intro")) {
    if (root.classList.contains("intro-on")) $("#intro").hidden = false;   // à afficher avant de mesurer
    var il = $("#introLogo"), pl = $(".bord__logo");
    if (il && pl) {
      var a = il.getBoundingClientRect(), b = pl.getBoundingClientRect();
      if (a.width && b.width) {
        il.style.setProperty("--dx", (b.left + b.width / 2 - (a.left + a.width / 2)).toFixed(1) + "px");
        il.style.setProperty("--dy", (b.top + b.height / 2 - (a.top + a.height / 2)).toFixed(1) + "px");
        il.style.setProperty("--s", (b.width / a.width).toFixed(3));
      }
    }
  }
  var B = C.bord || {};
  splitLines($("#bordTitle"), B.phrase, 3);
  $("#bordCall").href = "tel:" + C.contact.telephone;

  /* « Enregistrer mon chauffeur » : ouvre la fiche vCard. Le téléphone demande toujours
     confirmation avant d'ajouter le contact ; on affiche la marche à suivre selon l'appareil. */
  var save = $("#saveContact"), saveHint = $("#saveHint");
  if (C.ficheContact && C.ficheContact.url) save.href = C.ficheContact.url;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  save.addEventListener("click", function () {
    saveHint.textContent = isIOS ? (B.aideIphone || "") : (B.aideAndroid || "");
    saveHint.hidden = !saveHint.textContent;
  });
  $("#bordCars").innerHTML = (C.flotte.vehicules || []).map(function (v) {
    return '<a class="bcar" href="#reservation" data-pick="' + esc(v.id) + '">' +
      '<span class="bcar__media"><img src="' + esc(v.image) + '" alt="' + esc(v.imageAlt || v.nom) + '" loading="lazy" decoding="async"></span>' +
      '<span class="bcar__name">' + esc(v.nom) + "</span>" +
      '<span class="bcar__meta">' + esc(v.categorie) + (v.passagersMax ? " · jusqu'à " + v.passagersMax + " passagers" : "") + "</span></a>";
  }).join("");
  $("#bordZones").innerHTML = (B.zones || []).map(function (z) { return "<li>" + esc(z) + "</li>"; }).join("");
  $("#bordServices").innerHTML = (C.prestations.liste || []).filter(function (sv) { return sv.afficherDansListe !== false; })
    .map(function (sv) { return "<li>" + esc(sv.titre) + "</li>"; }).join("");
  // En mode passager, le contact direct est déjà en tête de page : l'introduction de la réservation est adaptée
  var bookingLead = $("#reservation .lead"), classicLead = bookingLead ? bookingLead.textContent : "";
  function syncBookingLead() {
    if (bookingLead) bookingLead.textContent = root.classList.contains("is-bord") && B.introReservation ? B.introReservation : classicLead;
  }
  syncBookingLead();
  function exitBord() {
    if (!root.classList.contains("is-bord")) return;
    root.classList.remove("is-bord");
    syncBookingLead();
    window.scrollTo(0, 0);
    if (typeof onScroll === "function") onScroll();
  }
  $("#bordFull").addEventListener("click", function () { exitBord(); });
  // En mode passager, un lien vers une section du site complet affiche d'abord le site complet
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || !root.classList.contains("is-bord")) return;
    var id = a.getAttribute("href").slice(1);
    if (["flotte", "prestations", "destinations", "accueil"].indexOf(id) === -1) return;
    e.preventDefault(); exitBord();
    var t = document.getElementById(id); if (t) setTimeout(function () { t.scrollIntoView({ behavior: "smooth" }); }, 60);
  }, true);
  $("#pledges").innerHTML = (C.engagements || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");

  // Petit point lumineux qui parcourt l'itinéraire (désactivé si l'utilisateur limite les animations)
  if (!reduceMotion) {
    var route = $("#route");
    if (route && getComputedStyle(route).display !== "none") {   // itinéraire affiché seulement sur grand écran
      var NS = "http://www.w3.org/2000/svg";
      var car = document.createElementNS(NS, "circle");
      car.setAttribute("r", "1.8"); car.setAttribute("class", "route__car");
      var am = document.createElementNS(NS, "animateMotion");
      am.setAttribute("dur", "16s"); am.setAttribute("begin", "3s"); am.setAttribute("repeatCount", "indefinite");
      am.setAttribute("keyPoints", "0;1"); am.setAttribute("keyTimes", "0;1"); am.setAttribute("calcMode", "linear");
      var mp = document.createElementNS(NS, "mpath");
      mp.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#routePath"); mp.setAttribute("href", "#routePath");
      am.appendChild(mp); car.appendChild(am); route.appendChild(car);
    }
  }

  /* ---------- Flotte ---------- */
  var vehicles = C.flotte.vehicules || [];
  $("#fleetList").innerHTML = vehicles.map(function (v) {
    var specs = (v.caracteristiques || []).map(function (s) {
      return "<div><dt>" + esc(s.label) + "</dt><dd>" + esc(s.valeur) + "</dd></div>";
    }).join("");
    return '<article class="car reveal">' +
      '<div class="car__media"><img src="' + esc(v.image) + '" alt="' + esc(v.imageAlt || v.nom) + '" loading="lazy" decoding="async">' +
      (C.flotte.afficherMentionPhotoProvisoire ? '<span class="car__tag">Photo provisoire</span>' : "") + "</div>" +
      "<div>" +
      '<p class="car__cat">' + esc(v.categorie) + "</p>" +
      '<h3 class="car__name">' + esc(v.nom) + "</h3>" +
      '<p class="car__desc">' + esc(v.description) + "</p>" +
      (specs ? '<dl class="car__specs">' + specs + "</dl>" : "") +
      '<a class="btn btn--gold" href="#reservation" data-pick="' + esc(v.id) + '"><span>Choisir ce véhicule</span></a>' +
      "</div></article>";
  }).join("");

  /* ---------- Prestations ---------- */
  var ICONS = {
    avion: '<path d="M21 15.5 13.5 11V5.5a1.5 1.5 0 0 0-3 0V11L3 15.5V17l7.5-2.2V19l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4.2L21 17z"/>',
    train: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12M9 20l-2 2M15 20l2 2M9.5 14.2h.01M14.5 14.2h.01"/><path d="M10 6h4"/>',
    mallette: '<rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18M11 12.5v2h2v-2"/>',
    route: '<path d="M8 21 10.5 3M16 21 13.5 3M12 7v2M12 12v2M12 17v2"/>',
    coupe: '<path d="M8 3h8l-.6 5.2A3.5 3.5 0 0 1 12 11.4a3.5 3.5 0 0 1-3.4-3.2zM12 11.4V20M8.5 21h7M8.3 6h7.4"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    montagne: '<path d="M2.5 20 9 8.5l3.2 5.4L15 9.5 21.5 20z"/><path d="m7.4 11.3 1.6 1.2 1.4-1.4"/>'
  };
  var services = C.prestations.liste || [];
  $("#servicesList").innerHTML = services.filter(function (s) { return s.afficherDansListe !== false; }).map(function (s) {
    return '<li class="service reveal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[s.icone] || ICONS.route) + "</svg><div><h3>" + esc(s.titre) + "</h3><p>" + esc(s.texte) + "</p></div></li>";
  }).join("");

  /* ---------- Destinations : chaque ligne entière est un raccourci vers la réservation ---------- */
  var dest = C.destinations || { liste: [] };
  $("#destList").innerHTML = (dest.liste || []).map(function (z) {
    return '<div class="dest reveal"><a class="dest__link" href="#reservation"' + (z.prestation ? ' data-service="' + esc(z.prestation) + '"' : "") + '>' +
      '<span class="dest__body"><span class="dest__region">' + esc(z.region) + '</span>' +
      '<span class="dest__name">' + esc(z.nom).replace(/ &amp; /, " <em>&amp;</em> ") + "</span>" +
      '<span class="dest__text">' + esc(z.texte) + "</span></span>" +
      '<span class="dest__go" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span>' +
      '<span class="sr-only">Demander un trajet</span></a></div>';
  }).join("");

  /* ---------- Pied de page ---------- */
  $("#telLink").href = "tel:" + C.contact.telephone;
  $("#callLink").href = "tel:" + C.contact.telephone;
  $("#mailLink").href = "mailto:" + C.contact.email;
  $("#footerZone").textContent = C.contact.zone || "";
  $("#year").textContent = new Date().getFullYear();

  /* ---------- Origine de la visite (sans cookie ni stockage) ---------- */
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

  /* ---------- WhatsApp direct (sans formulaire) : tous les boutons [data-wa-direct] ----------
     Le message prérempli mentionne l'origine (QR code Tesla / Viano, campagne…) pour le suivi. */
  var waNumber = String(C.contact.whatsapp).replace(/[^\d]/g, "");
  var waDirectText = (C.reservation.messageWhatsAppDirect || "Bonjour, je souhaite des renseignements pour un trajet.") +
    (ORIGINE.code ? "\n\n(Origine : " + ORIGINE.libelle + ")" : "");
  $$("[data-wa-direct]").forEach(function (a) {
    a.href = "https://wa.me/" + waNumber + "?text=" + encodeURIComponent(waDirectText);
  });

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
    phone: function (v) { return validPhone(normalizePhone(ccSel.value, v)); },
    email: function (v) { v = v.trim(); return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
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

  /* Rassemble la demande : données envoyées au serveur + lignes du récapitulatif */
  function collect() {
    var f = form.elements;
    var vId = (form.querySelector('input[name="vehicle"]:checked') || {}).value;
    var vName = (choices.filter(function (c) { return c.id === vId; })[0] || NO_PREF).nom;
    var kind = refKind();
    var data = {
      prestation: f.service.value || "",
      reference: kind ? f.ref.value.trim().toUpperCase() : "",
      typeReference: kind,
      date: f.date.value,
      heure: f.time.value.slice(0, 5),
      depart: f.from.value.trim(),
      destination: f.to.value.trim(),
      passagers: parseInt(f.pax.value, 10) || 1,
      vehicule: vName,
      nom: f.lastname.value.trim(),
      prenom: f.firstname.value.trim(),
      telephone: normalizePhone(ccSel.value, f.phone.value),
      email: f.email.value.trim(),
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
      ["Destination", data.destination],
      ["Passagers", String(data.passagers)],
      ["Véhicule", data.vehicule],
      ["Nom", data.prenom + " " + data.nom],
      ["Téléphone", formatPhone(data.telephone)]
    );
    if (data.email) rows.push(["E-mail", data.email]);
    if (data.precisions) rows.push(["Précisions", data.precisions]);
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
    payload.website = form.elements.website.value;      // piège anti-robot
    payload.duree = Date.now() - startedAt;             // temps passé sur le formulaire
    if (cfgForm.turnstileSiteKey) {
      payload.turnstile = turnstileToken || (window.turnstile && turnstileId !== null ? window.turnstile.getResponse(turnstileId) : "") || "";
      if (!payload.turnstile) {
        showError(turnstileFailed
          ? "<strong class=\"st\">La vérification anti-robot n'a pas pu se charger.</strong> Un bloqueur de contenu ou la connexion peut en être la cause." + fallbackHtml()
          : "<strong class=\"st\">Vérification anti-robot en cours.</strong> Patientez quelques secondes, puis appuyez de nouveau sur « Envoyer ma demande ».");
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
        $("#sentTitle").textContent = "Merci, " + payload.prenom;
        $("#sentText").innerHTML = "Votre demande a bien été transmise (référence <strong>" + esc(r.json.ref) +
          "</strong>). Votre chauffeur vous recontacte au <strong>" + esc(formatPhone(payload.telephone)) + "</strong> pour confirmer la disponibilité.";
        $("#sentList").innerHTML = rowsHtml(c.rows);
        showPanel("sent");
        return;
      }
      if (r.json && r.json.error === "validation" && Array.isArray(r.json.fields)) {
        var map = { date: "date", heure: "time", depart: "from", destination: "to", nom: "lastname", prenom: "firstname", telephone: "phone", email: "email" };
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

  $("#editBtn").addEventListener("click", function () { showPanel("form"); });
  $("#newBtn").addEventListener("click", function () {
    form.reset(); fillPax(); updateRef(); updatePhPlaceholder(); startedAt = Date.now();
    $("#moreDetails").open = false;
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

  /* ---------- Menu ---------- */
  var menuBtn = $("#menuBtn"), menu = $("#menu");
  function setMenu(open) {
    menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.querySelector(".menu-btn__label").textContent = open ? "Fermer" : "Menu";
    document.body.classList.toggle("menu-open", open);
    if (typeof updateDock === "function") updateDock();
  }
  menuBtn.addEventListener("click", function () { setMenu(menu.hidden); });
  menu.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) setMenu(false); });

  /* ---------- En-tête & bouton flottant ---------- */
  var top = $("#top"), dock = $("#dock"), hero = $("#accueil"), booking = $("#reservation");
  var inBooking = false, pastHero = false;
  function updateDock() {
    var show = pastHero && !inBooking && menu.hidden;
    dock.classList.toggle("is-visible", show);
    dock.setAttribute("aria-hidden", String(!show));
    $$("a", dock).forEach(function (a) { a.tabIndex = show ? 0 : -1; });
  }
  function onScroll() {
    top.classList.toggle("is-solid", window.scrollY > 40);
    var first = root.classList.contains("is-bord") ? $(".bord__screen") : hero;
    pastHero = window.scrollY > first.offsetHeight * 0.75;
    updateDock();
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { inBooking = en[0].isIntersecting; updateDock(); }, { threshold: 0.05 }).observe(booking);

    /* Écrans tactiles : la photo du véhicule visible à l'écran s'anime comme au survol */
    if (!canHover && !reduceMotion) {
      var carIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.target.classList.toggle("is-inview", en.intersectionRatio > 0.6); });
      }, { threshold: [0, 0.6, 1] });
      $$(".car").forEach(function (el) { carIO.observe(el); });
    }

    /* Apparitions : seuls les éléments situés sous l'écran au chargement sont animés */
    if (!reduceMotion) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.remove("is-pending"); io.unobserve(en.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px" });
      var vh = window.innerHeight;
      $$(".reveal").forEach(function (el) {
        if (el.getBoundingClientRect().top > vh) { el.classList.add("is-pending"); io.observe(el); }
      });
      // Sécurité : tout afficher si un élément n'a pas été révélé (ex. saut d'ancre)
      window.addEventListener("hashchange", function () { $$(".reveal.is-pending").forEach(function (el) { el.classList.remove("is-pending"); }); });
    }
  }
})();
