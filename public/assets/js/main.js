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

  /* Introduction : le logo central glisse exactement à la place du logo de la page
     (mode passager : logo du haut de l'écran ; site classique : logo de l'en-tête, aligné avec MENU) */
  if (root.classList.contains("has-intro")) {
    if (root.classList.contains("intro-on")) $("#intro").hidden = false;   // à afficher avant de mesurer
    var il = $("#introLogo"), pl = root.classList.contains("is-bord") ? $(".bord__logo") : $(".top .brand__mono");
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
      '<span class="bcar__name">' + esc(v.titre || v.nom) + "</span>" +
      '<span class="bcar__meta">' + esc(v.sousTitre || v.categorie) + (v.passagersMax ? " · jusqu'à " + v.passagersMax + " passagers" : "") + "</span></a>";
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
      (v.categorie ? '<p class="car__cat">' + esc(v.categorie) + "</p>" : "") +
      '<h3 class="car__name">' + esc(v.titre || v.nom) + "</h3>" +
      (v.sousTitre ? '<p class="car__sous">' + esc(v.sousTitre) + "</p>" : "") +
      '<p class="car__desc">' + esc(v.description) + "</p>" +
      (specs ? '<dl class="car__specs">' + specs + "</dl>" : "") +
      '<a class="btn btn--gold" href="/reservation?vehicule=' + encodeURIComponent(v.id) + '" data-resa data-pick="' + esc(v.id) + '"><span>Choisir ce véhicule</span></a>' +
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
    return '<div class="dest reveal"><a class="dest__link" data-resa href="/reservation' + (z.prestation ? "?prestation=" + encodeURIComponent(z.prestation) + '" data-service="' + esc(z.prestation) + '"' : '"') + '>' +
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
  /* Coordonnées répétées (accueil, rubrique Contact, pied de page) : téléphone, e-mail, fiche contact */
  $$(".js-tel").forEach(function (a) { a.href = "tel:" + C.contact.telephone; });
  $$(".js-mail").forEach(function (a) { a.href = "mailto:" + C.contact.email; });
  $$(".js-vcf").forEach(function (a) { a.href = (C.ficheContact && C.ficheContact.url) || "/elev8-private-driver.vcf"; });
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
     Le message prérempli mentionne l'origine (QR code Tesla / Classe V, campagne…) pour le suivi. */
  var waNumber = String(C.contact.whatsapp).replace(/[^\d]/g, "");
  var waDirectText = (C.reservation.messageWhatsAppDirect || "Bonjour, je souhaite des renseignements pour un trajet.") +
    (ORIGINE.code ? "\n\n(Origine : " + ORIGINE.libelle + ")" : "");
  /* Lien officiel WhatsApp Business ; pour une visite suivie (QR code, campagne), même numéro avec message
     prérempli indiquant l'origine, car le lien officiel ne peut pas transporter de texte. */
  $$("[data-wa-direct]").forEach(function (a) {
    a.href = C.contact.whatsappLien && !ORIGINE.code ? C.contact.whatsappLien
           : "https://wa.me/" + waNumber + "?text=" + encodeURIComponent(waDirectText);
  });

  /* ---------- Formulaire de réservation et estimation : assets/js/reservation.js ----------
     (même code pour la rubrique Réservation de l'accueil, le mode passager et la page /reservation) */

  /* ---------- Liens « Réserver » vers la page /reservation ----------
     L'origine de la visite (QR code, carte de visite, campagne) suit le client. */
  (function () {
    var q = new URLSearchParams(location.search), keep = new URLSearchParams();
    // gclid / gbraid / wbraid : identifiant de clic Google Ads, nécessaire pour attribuer la demande à l'annonce
    ["src", "bord", "utm_source", "utm_medium", "utm_campaign", "utm_content", "gclid", "gbraid", "wbraid"].forEach(function (k) { if (q.get(k)) keep.set(k, q.get(k)); });
    $$("a[data-resa]").forEach(function (a) {
      var u = new URL(a.getAttribute("href"), location.href);
      keep.forEach(function (v, k) { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
      a.href = u.pathname + u.search;
    });
  })();

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
