/* ==========================================================================
   ELEV8 Private Driver — fiche contact (vCard) « Enregistrer mon chauffeur »
   --------------------------------------------------------------------------
   Adresse : /elev8-private-driver.vcf
   La fiche est construite à partir de public/config.js (nom, téléphone,
   e-mail, site) : modifier config.js suffit, la fiche suit automatiquement.
   Le logo vient de public/assets/img/e8-contact.jpg.
   iPhone : la fiche s'ouvre et l'utilisateur confirme « Créer un contact ».
   Android : la fiche est téléchargée puis ouverte avec l'application Contacts.
   Rien n'est enregistré sans la confirmation de l'utilisateur.
   ========================================================================== */

export const config = {
  path: "/elev8-private-driver.vcf",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] }
};

/* Échappement des valeurs texte (RFC 6350 / 2426) */
const esc = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/* Repli des lignes à 75 octets maximum, en respectant les caractères UTF-8 */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = ""; let size = 0; let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildVCard(C, photoB64) {
  const site = (C.site && C.site.url) || "https://elevateprivatedriver.com";
  const fc = C.ficheContact || {};
  const name = (C.marque && C.marque.nomComplet) || "ELEV8 Private Driver";
  const tel = String((C.contact && C.contact.telephone) || "").replace(/[^\d+]/g, "");
  const wa = String((C.contact && C.contact.whatsapp) || "").replace(/\D/g, "");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "PRODID:-//ELEV8 Private Driver//Fiche contact//FR",
    `N:;${esc(name)};;;`,
    `FN:${esc(name)}`,
    `ORG:${esc(name)}`,
    "X-ABShowAs:COMPANY",
    fc.fonction ? `TITLE:${esc(fc.fonction)}` : null,
    tel ? `TEL;TYPE=CELL,VOICE,pref:${tel}` : null,
    fc.inclureEmail && C.contact && C.contact.email ? `EMAIL;TYPE=INTERNET,WORK:${esc(C.contact.email)}` : null,
    `URL:${site}/?src=contact`,
    wa ? `item1.URL:https://wa.me/${wa}` : null,
    wa ? "item1.X-ABLabel:WhatsApp" : null,
    fc.note ? `NOTE:${esc(fc.note)}` : null,
    photoB64 ? `PHOTO;ENCODING=b;TYPE=JPEG:${photoB64}` : null,
    `REV:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
    "END:VCARD"
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}

/* Lit public/config.js (fichier du site lui-même) sans l'exécuter dans la page */
export function parseConfig(src) {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function("window", `"use strict";${src}`)(win);
  if (!win.SITE_CONFIG) throw new Error("config");
  return win.SITE_CONFIG;
}

export default async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("", { status: 405 });
  const origin = new URL(req.url).origin;
  let C, photo = "";
  try {
    const r = await fetch(`${origin}/config.js`, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) throw new Error(`config:${r.status}`);
    C = parseConfig(await r.text());
  } catch (e) {
    console.error("Fiche contact : configuration illisible", String(e && e.message).slice(0, 60));
    return new Response("Fiche indisponible pour le moment.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  try {
    const p = await fetch(`${origin}/assets/img/e8-contact.jpg`);
    if (p.ok) photo = Buffer.from(await p.arrayBuffer()).toString("base64");
  } catch { /* fiche sans logo */ }

  const body = buildVCard(C, photo);
  return new Response(req.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="ELEV8-Private-Driver.vcf"',
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
};
