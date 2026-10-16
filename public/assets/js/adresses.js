/* ==========================================================================
   ELEV8 Private Driver — suggestions d'adresses (Départ / Destination)
   --------------------------------------------------------------------------
   Ajoute une liste de suggestions sous les champs « Départ » et « Destination »
   du formulaire de réservation. Les suggestions viennent de la fonction Netlify
   /adresses (aucune clé ni service externe appelé depuis le navigateur).

   Sécurités :
   - le champ reste un champ texte libre : on peut toujours écrire son adresse
     soi-même et envoyer la demande sans choisir de suggestion ;
   - si le service ne répond pas, la liste ne s'affiche simplement pas ;
   - sur un hébergement sans fonction /adresses, le module se désactive seul ;
   - rien n'est enregistré dans le navigateur.
   Réglages : section « adresses » de config.js.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.SITE_CONFIG || {};
  var A = C.adresses || {};
  if (A.actif === false || !window.fetch || !document.querySelector) return;

  var ENDPOINT = A.endpoint || "/adresses";
  var MIN = Math.max(2, A.minCaracteres || 3);
  var DELAY = 130;                 // pause après la dernière lettre tapée avant de chercher
  var warmed = false;              // le service est « réveillé » dès que le client touche le champ
  var disabled = false;
  var memo = {};                   // réponses déjà reçues pendant la visite (en mémoire uniquement)

  var ICONS = {
    adresse: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    lieu: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    ville: '<path d="M4 20V9l5-3v14M9 20V4l7 3v13M16 20v-9l4 2v7M3 20h18"/>',
    avion: '<path d="M10.5 13.5 4 12l-1 1.5 6 3 2 4 1.5-1-1-6 5.5-5.5c.9-.9.9-2.1 0-2.6-.5-.5-1.7-.5-2.6.4L9 11"/><path d="m14 10 5 9-1.5 1-5-6"/>',
    train: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9.5" cy="14" r=".6"/><circle cx="14.5" cy="14" r=".6"/>',
    hotel: '<path d="M3 19V6M3 15h18v4M3 11h7a3 3 0 0 1 3 3v1M14 11h4a3 3 0 0 1 3 3v1"/><circle cx="6.5" cy="8.5" r="1.5"/>'
  };
  function icon(k) {
    return '<svg class="ac__ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[k] || ICONS.lieu) + "</svg>";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function token() {
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function setup(input, next) {
    if (!input) return;
    var field = input.closest(".field") || input.parentNode;
    var id = input.id + "-ac";
    var list = document.createElement("div");
    list.className = "ac"; list.id = id; list.hidden = true;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Suggestions d'adresses");
    var err = field.querySelector(".field__err");
    field.insertBefore(list, err || null);
    field.classList.add("field--ac");

    input.setAttribute("autocomplete", "off");            // pas de liste du navigateur par-dessus
    input.setAttribute("autocorrect", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", id);

    var items = [], active = -1, timer = 0, ctrl = null, session = "", seq = 0, scrolled = false;

    function close() {
      list.hidden = true; list.innerHTML = ""; items = []; active = -1;
      input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
    }
    function highlight(i) {
      var opts = list.querySelectorAll(".ac__opt");
      Array.prototype.forEach.call(opts, function (o, j) { o.setAttribute("aria-selected", j === i ? "true" : "false"); });
      active = i;
      if (i >= 0 && opts[i]) { input.setAttribute("aria-activedescendant", opts[i].id); opts[i].scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    }
    function render(res) {
      items = (res && res.s) || [];
      if (!items.length || document.activeElement !== input) { close(); return; }
      var credit = res.p === "google" ? "Google Maps" : "© IGN · © OpenStreetMap";
      list.innerHTML = items.map(function (s, i) {
        return '<div class="ac__opt" role="option" id="' + id + "-" + i + '" data-i="' + i + '" aria-selected="false">' +
          icon(s.k) + '<span class="ac__txt"><span class="ac__main">' + esc(s.t) + "</span>" +
          (s.d ? '<span class="ac__sub">' + esc(s.d) + "</span>" : "") + "</span></div>";
      }).join("") + '<div class="ac__credit" aria-hidden="true">' + esc(credit) + "</div>";
      list.hidden = false; active = -1;
      input.setAttribute("aria-expanded", "true");
      // Sur téléphone : remonte le champ pour que la liste ne soit pas cachée par le clavier
      if (!scrolled) {
        var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        if (list.getBoundingClientRect().bottom > vh - 8) {
          scrolled = true;
          field.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }
    }
    function search(q) {
      var key = q.toLowerCase();
      if (memo[key]) { render(memo[key]); return; }
      if (ctrl) ctrl.abort();
      ctrl = window.AbortController ? new AbortController() : null;
      var my = ++seq;
      if (!session) session = token();
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: q, s: session }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (r.status === 404 || r.status === 405) { disabled = true; return null; }  // fonction absente : module désactivé
        return r.ok ? r.json() : null;
      }).then(function (res) {
        if (my !== seq) return;                       // une saisie plus récente a pris le relais
        if (!res || !res.ok) { close(); return; }
        memo[key] = res; render(res);
      }).catch(function () { if (my === seq) close(); });
    }
    function choose(i) {
      var s = items[i]; if (!s) return;
      input.value = s.v;
      close(); seq++; if (ctrl) ctrl.abort(); clearTimeout(timer);
      session = ""; scrolled = false;                 // nouvelle recherche = nouvelle session
      input.dispatchEvent(new Event("input", { bubbles: true }));   // efface le message d'erreur éventuel
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (next && !next.value.trim()) next.focus(); else input.blur();
    }

    input.addEventListener("input", function (e) {
      if (e && e.isTrusted === false) return;         // valeur posée par choose()
      clearTimeout(timer);
      var q = input.value.trim();
      if (disabled || q.length < MIN) { seq++; close(); return; }
      timer = setTimeout(function () { search(q); }, DELAY);
    });
    input.addEventListener("keydown", function (e) {
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1 >= items.length ? 0 : active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active <= 0 ? items.length - 1 : active - 1); }
      else if (e.key === "Enter" && active >= 0 && !e.isComposing) { e.preventDefault(); e.stopPropagation(); choose(active); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    // Dès le toucher du champ : réveille le service (connexion prête avant la première lettre)
    input.addEventListener("focus", function () {
      if (warmed || disabled) return; warmed = true;
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"q":""}' })
        .then(function (r) { if (r.status === 404 || r.status === 405) disabled = true; })
        .catch(function () {});
    });
    input.addEventListener("blur", function () { setTimeout(close, 160); });
    // Le toucher sur une suggestion ne doit pas fermer le clavier avant la sélection
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("click", function (e) {
      var o = e.target.closest && e.target.closest(".ac__opt");
      if (o) choose(+o.getAttribute("data-i"));
    });
  }

  function init() {
    var from = document.getElementById("f-from"), to = document.getElementById("f-to");
    setup(from, to);
    setup(to, null);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
