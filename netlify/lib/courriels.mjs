/* ==========================================================================
   ELEV8 Private Driver — e-mails du parcours de paiement (Brevo, ou Resend)
   --------------------------------------------------------------------------
   Mêmes variables que les autres envois : EMAIL_PROVIDER, EMAIL_API_KEY, MAIL_FROM,
   MAIL_FROM_NAME, MAIL_TO (adresse d'ELEV8 qui reçoit les alertes).
   Aucun de ces messages n'affirme qu'un chauffeur est attribué tant qu'ELEV8 (ou, plus tard,
   HUBER) ne l'a pas réellement confirmé.
   ========================================================================== */
import { estSiteDeTest, destinataireTest, marquerTest } from "./environnement.mjs";
export const deps = { send: null };
const env = (k) => (process.env[k] || "").trim();
const MARQUE = "ELEV8 Private Driver";
const SITE = "https://elev8privatedriver.com";
const CONTACT = "contact@elev8privatedriver.com";

/* message : { to, subject, text, html, replyTo,
               pieces: [{ nom, contenu (octets) }]   pièces jointes (facultatif)
               copieElev8: true                       copie cachée identique à ELEV8 (MAIL_TO) } */
export async function envoyer(message) {
  let { to, subject, text, html, replyTo } = message;
  const pieces = Array.isArray(message.pieces) ? message.pieces : [];
  if (estSiteDeTest()) {                                         // site de test : jamais d'envoi à un vrai client
    const d = destinataireTest(to);
    ({ subject, text, html } = marquerTest({ subject, text, html }, to, d.redirige)); to = d.to;
  }
  const copie = message.copieElev8 && to ? env("MAIL_TO") : "";  // destinataire = ELEV8 : pas de copie en double
  if (deps.send) return deps.send({ to, subject, text, html, replyTo, pieces, copie });
  const provider = env("EMAIL_PROVIDER").toLowerCase() || "brevo";
  const key = env("EMAIL_API_KEY"), from = env("MAIL_FROM"), nom = env("MAIL_FROM_NAME") || MARQUE;
  const dest = to || env("MAIL_TO");
  if (!key || !from || !dest) throw new Error("config");
  const b64 = (x) => Buffer.from(x).toString("base64");
  const r = provider === "resend"
    ? await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${nom} <${from}>`, to: [dest], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}), ...(copie ? { bcc: [copie] } : {}),
          ...(pieces.length ? { attachments: pieces.map((x) => ({ filename: x.nom, content: b64(x.contenu) })) } : {}) }) })
    : await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sender: { name: nom, email: from }, to: [{ email: dest }], subject, textContent: text, htmlContent: html, ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          ...(copie ? { bcc: [{ email: copie }] } : {}), ...(pieces.length ? { attachment: pieces.map((x) => ({ name: x.nom, content: b64(x.contenu) })) } : {}) }) });
  if (!r.ok) throw new Error(`provider:${r.status}`);
}

/* ---------- Mise en forme ---------- */
export const euros = (c) => (c / 100).toFixed(2).replace(".", ",") + " €";
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function dateLongue(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
export const heureFr = (h) => (h ? String(h).replace(":", "h") : "");
export const instantFr = (iso) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).replace(":", "h");

/* Récapitulatif du trajet (identique dans tous les messages au client) */
export function lignesTrajet(D) {
  const p = D.prestation || {};
  const l = [["Référence", D.ref], ["Date", dateLongue(p.date)], ["Heure de prise en charge", heureFr(p.heure)],
    ["Adresse de départ", p.depart], ["Adresse de destination", p.destination]];
  if (p.allerRetour) l.push(["Retour", dateLongue(p.dateRetour) + (p.heureRetour ? " à " + heureFr(p.heureRetour) : "") + " (de " + p.destination + " à " + p.depart + ")"]);
  l.push(["Véhicule", p.vehicule], ["Nombre de passagers", String(p.passagers || 1)]);
  if (p.bagages !== "" && p.bagages != null) l.push(["Bagages", String(p.bagages)]);
  if (p.reference) l.push([p.typeReference || "Référence de voyage", p.reference]);
  return l;
}
const signatureTexte = `Cordialement,\n\n${MARQUE}\n${CONTACT}\n${SITE}`;

/* Gabarit HTML sobre (noir et champagne), lisible dans toutes les messageries */
function gabarit({ titre, intro, lignes, encadre, avant, bouton, apres }) {
  const rangs = (lignes || []).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#8a7f6a;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#f3efe6;font-size:14px">${esc(v)}</td></tr>`).join("");
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0b0b0b;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:28px 22px;color:#f3efe6">
<p style="margin:0 0 4px;letter-spacing:4px;font-size:18px;color:#f3efe6">ELEV8</p>
<p style="margin:0 0 24px;letter-spacing:3px;font-size:10px;color:#bca783">PRIVATE DRIVER</p>
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;color:#ddd1b7;margin:0 0 18px">${esc(titre)}</h1>
${(intro || []).map((t) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${esc(t)}</p>`).join("")}
${rangs ? `<table role="presentation" style="border-collapse:collapse;margin:8px 0 18px;width:100%">${rangs}</table>` : ""}
${encadre ? `<p style="border:1px solid #bca783;padding:14px 16px;font-size:17px;color:#ddd1b7;margin:0 0 20px">${esc(encadre)}</p>` : ""}
${(avant || []).map((t) => `<p style="font-size:15px;line-height:1.55;margin:0 0 16px">${esc(t)}</p>`).join("")}
${bouton ? `<p style="margin:0 0 10px"><a href="${esc(bouton.url)}" style="display:inline-block;background:#bca783;color:#0b0b0b;text-decoration:none;padding:14px 26px;letter-spacing:2px;font-size:13px;text-transform:uppercase">${esc(bouton.texte)}</a></p>
<p style="font-size:12px;color:#8a7f6a;margin:0 0 20px;word-break:break-all">${esc(bouton.url)}</p>` : ""}
${(apres || []).map((t) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#d9d2c3">${esc(t)}</p>`).join("")}
<p style="font-size:14px;line-height:1.6;margin:22px 0 0;color:#d9d2c3">Cordialement,<br>${MARQUE}<br><a href="mailto:${CONTACT}" style="color:#bca783">${CONTACT}</a><br><a href="${SITE}" style="color:#bca783">${SITE.replace("https://", "")}</a></p>
</div></body></html>`;
}
const texte = (bonjour, blocs) => bonjour + "\n\n" + blocs.filter(Boolean).join("\n\n") + "\n\n" + signatureTexte;
const bonjourDe = (D) => (D.client && D.client.prenom ? `Bonjour ${D.client.prenom},` : "Bonjour,");

/* 1. Lien de paiement (envoyé automatiquement, ou après validation manuelle du tarif) */
export function mailLienPaiement(D, p, lienAbsolu) {
  const L = lignesTrajet(D), montant = euros(p.montantCents) + " TTC", limite = instantFr(p.valableJusqu);
  const intro = ["Merci d'avoir choisi " + MARQUE + ".", "Votre demande a bien été enregistrée. Voici le récapitulatif de votre trajet :"];
  const apres = ["Ce lien est valable jusqu'au " + limite + ".",
    "Dès réception de votre règlement, nous attribuons votre course à un chauffeur. Votre réservation sera définitivement confirmée lorsqu'un chauffeur l'aura acceptée : vous recevrez alors un e-mail de confirmation. Si aucun chauffeur ne pouvait assurer votre trajet, vous seriez intégralement remboursé.",
    "Nous vous remercions pour votre confiance et restons à votre disposition pour toute question."];
  return {
    subject: `${MARQUE} — Finalisation de votre réservation | ${D.ref}`,
    text: texte(bonjourDe(D), [intro.join("\n\n"), "Votre trajet\n\n" + L.map(([k, v]) => k + " : " + v).join("\n"), "Tarif définitif : " + montant,
      "Finalisez votre réservation\n\nPour confirmer votre accord sur le tarif et procéder au règlement, nous vous invitons à utiliser notre lien de paiement sécurisé :\n\n" + lienAbsolu,
      apres.join("\n\n")]),
    html: gabarit({ titre: "Finalisez votre réservation", intro: [bonjourDe(D), ...intro], lignes: L, encadre: "Tarif définitif : " + montant,
      bouton: { url: lienAbsolu, texte: "Payer " + euros(p.montantCents) + " en toute sécurité" }, apres })
  };
}
/* 1 bis. Devis PDF + bouton « Accepter le devis et payer en ligne » (étape B du parcours).
   devis = { numero, ht, tva, taux } (montants calculés depuis le même montant TTC que le lien de paiement),
   ou null si le PDF n'a pas pu être produit (le lien de paiement est alors envoyé seul). */
export const BOUTON_DEVIS = "Accepter le devis et payer en ligne";
export function mailDevis(D, p, lienAbsolu, devis) {
  const L = lignesTrajet(D), montant = euros(p.montantCents) + " TTC", limite = instantFr(p.valableJusqu);
  const tarif = "Tarif : " + montant + (devis && devis.ht != null ? " (" + euros(Math.round(devis.ht * 100)) + " HT + TVA " + devis.taux + " % : " + euros(Math.round(devis.tva * 100)) + ")" : "");
  const intro = ["Merci d'avoir choisi " + MARQUE + ".",
    devis ? "Vous trouverez ci-joint votre devis n° " + devis.numero + " (PDF). Voici le récapitulatif de votre trajet :" : "Votre demande a bien été enregistrée. Voici le récapitulatif de votre trajet :"];
  const accepter = "Pour accepter " + (devis ? "ce devis" : "ce tarif") + " et finaliser votre réservation, il vous suffit de régler en ligne, en toute sécurité, avec le bouton ci-dessous. Le paiement vaut acceptation " + (devis ? "du devis" : "du tarif") + " : aucune autre démarche n'est nécessaire.";
  const apres = ["Ce lien est valable jusqu'au " + limite + ".",
    "Dès réception de votre règlement, nous attribuons votre course à un chauffeur. Votre réservation sera définitivement confirmée lorsqu'un chauffeur l'aura acceptée : vous recevrez alors un e-mail de confirmation. Si aucun chauffeur ne pouvait assurer votre trajet, vous seriez intégralement remboursé.",
    "Nous vous remercions pour votre confiance et restons à votre disposition pour toute question."];
  return {
    subject: devis ? `${MARQUE} — Votre devis ${devis.numero} | ${D.ref}` : `${MARQUE} — Finalisation de votre réservation | ${D.ref}`,
    text: texte(bonjourDe(D), [intro.join("\n\n"), "Votre trajet\n\n" + L.map(([k, v]) => k + " : " + v).join("\n"), tarif,
      accepter + "\n\n" + BOUTON_DEVIS + " : " + lienAbsolu, apres.join("\n\n")]),
    html: gabarit({ titre: devis ? "Votre devis" : "Finalisez votre réservation", intro: [bonjourDe(D), ...intro], lignes: L, encadre: tarif,
      avant: [accepter], bouton: { url: lienAbsolu, texte: BOUTON_DEVIS }, apres })
  };
}

/* 2 bis. Facture d'acompte (100 %) émise à la confirmation du paiement, PDF joint */
export function mailFactureAcompte(D, rec) {
  const a = rec.acompte, montant = euros(a.montantCents) + " TTC";
  const dateEnc = new Date(a.dateEncaissement + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const blocs = ["Nous vous remercions pour votre règlement de " + montant + " (" + a.mode + ", le " + dateEnc + ").",
    "Vous trouverez ci-joint votre facture d'acompte n° " + rec.numero + " : acompte de 100 % reçu, reste à payer : 0,00 €.",
    "La facture finale vous sera adressée après la réalisation de votre course ; elle tiendra compte de cet acompte."];
  const L = lignesTrajet(D);
  return { subject: `${MARQUE} — Votre facture d'acompte ${rec.numero} | ${rec.ref}`,
    text: texte(bonjourDe(D), [blocs.join("\n\n"), "Votre trajet\n\n" + L.map(([k, v]) => k + " : " + v).join("\n")]),
    html: gabarit({ titre: "Votre facture d'acompte", intro: [bonjourDe(D), ...blocs], lignes: L, encadre: "Acompte de 100 % reçu : " + montant + " — reste à payer : 0,00 €" }) };
}

const dateLongueIso = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/* 2 ter. Facture finale après « Course réalisée » (acompte déduit, solde 0,00 €) */
export function mailFactureFinale(D, rec) {
  const f = rec.finale;
  const blocs = ["Merci d'avoir voyagé avec " + MARQUE + ".",
    "Vous trouverez ci-joint la facture finale n° " + rec.numero + " de votre course du " + dateLongueIso(rec.doc.facture.datePrestation) + " (" + euros(Math.round(rec.montants.ttc * 100)) + " TTC).",
    "Elle déduit l'acompte déjà réglé (facture " + f.acompte.numero + (f.avoirs.length ? ", avoir" + (f.avoirs.length > 1 ? "s " : " ") + f.avoirs.map((a) => a.numero).join(", ") : "") + ") : solde à payer 0,00 €. Aucun autre paiement n'est demandé."];
  return { subject: `${MARQUE} — Votre facture ${rec.numero} | ${rec.ref}`,
    text: texte(bonjourDe(D), [blocs.join("\n\n")]),
    html: gabarit({ titre: "Votre facture", intro: [bonjourDe(D), ...blocs], encadre: "Total " + euros(Math.round(rec.montants.ttc * 100)) + " TTC — déjà réglé — solde : 0,00 €" }) };
}
/* 2 quater. Avoir après un remboursement Stripe */
export function mailAvoir(D, rec) {
  const a = rec.avoir;
  const blocs = [(a.total ? "Le remboursement intégral" : "Un remboursement") + " de " + euros(a.montantCents) + " TTC a été effectué le " + dateLongueIso(a.dateRemboursement) + " sur le moyen de paiement utilisé (" + a.mode + ").",
    "Vous trouverez ci-joint l'avoir n° " + rec.numero + ", rattaché à la facture " + a.facture.numero + ".",
    "Le remboursement apparaît sur votre compte sous quelques jours ouvrés, selon votre banque."];
  return { subject: `${MARQUE} — Votre avoir ${rec.numero} | ${rec.ref}`,
    text: texte(bonjourDe(D), [blocs.join("\n\n")]),
    html: gabarit({ titre: "Votre avoir", intro: [bonjourDe(D), ...blocs], encadre: "Montant remboursé : " + euros(a.montantCents) + " TTC" }) };
}

/* 2. Paiement confirmé par Stripe : la course est EN ATTENTE d'attribution (pas encore confirmée) */
export function mailPaiementRecu(D, p) {
  const blocs = ["Nous avons bien reçu votre règlement de " + euros(p.montantCents) + " TTC pour la réservation " + D.ref + ". Merci.",
    "Votre course est en cours d'attribution à un chauffeur. Vous recevrez un e-mail de confirmation dès qu'un chauffeur l'aura acceptée.",
    "Si aucun chauffeur ne pouvait assurer votre trajet, vous seriez intégralement remboursé."];
  return { subject: `${MARQUE} — Paiement reçu, attribution en cours | ${D.ref}`,
    text: texte(bonjourDe(D), [blocs.join("\n\n"), "Votre trajet\n\n" + lignesTrajet(D).map(([k, v]) => k + " : " + v).join("\n")]),
    html: gabarit({ titre: "Paiement reçu", intro: [bonjourDe(D), ...blocs], lignes: lignesTrajet(D) }) };
}
/* 3. Chauffeur confirmé (par ELEV8 aujourd'hui, par HUBER plus tard) */
export function mailChauffeurConfirme(D, c) {
  const L = lignesTrajet(D).concat([["Votre chauffeur", c.prenom], ["Véhicule", c.vehicule + (c.plaque ? " — " + c.plaque : "")]]);
  const blocs = ["Votre réservation est confirmée : un chauffeur a accepté votre course.",
    "Votre chauffeur vous attendra à l'adresse et à l'heure indiquées. Pour toute question ou modification, répondez simplement à ce message."];
  return { subject: `${MARQUE} — Réservation confirmée | ${D.ref}`,
    text: texte(bonjourDe(D), [blocs[0], L.map(([k, v]) => k + " : " + v).join("\n"), blocs[1]]),
    html: gabarit({ titre: "Réservation confirmée", intro: [bonjourDe(D), blocs[0]], lignes: L, apres: [blocs[1]] }) };
}
/* 4. Annulation par ELEV8 (indisponibilité ou aucun chauffeur) — avec ou sans remboursement */
export function mailAnnulation(D, p, { rembourse, motif }) {
  const pourquoi = motif === "sans_chauffeur" ? "aucun chauffeur n'est en mesure d'assurer votre trajet" : "nous ne sommes pas en mesure d'assurer votre trajet à la date et à l'heure demandées";
  const blocs = ["Nous sommes sincèrement désolés : " + pourquoi + " (réservation " + D.ref + ").",
    rembourse ? "Nous procédons au remboursement intégral de " + euros(p.montantCents) + " sur le moyen de paiement utilisé. Il apparaîtra sur votre compte sous quelques jours ouvrés, selon votre banque."
              : "Votre lien de paiement est désactivé : aucun montant n'a été prélevé.",
    "N'hésitez pas à nous contacter pour un autre horaire."];
  return { subject: `${MARQUE} — Annulation de votre demande | ${D.ref}`, text: texte(bonjourDe(D), [blocs.join("\n\n")]), html: gabarit({ titre: "Annulation de votre demande", intro: [bonjourDe(D), ...blocs] }) };
}
/* 5. Alertes pour ELEV8 */
export function alerteElev8(D, p, sujet, lignes, lienDocs) {
  const t = [sujet, "", ...lignes, "", "Référence : " + (D ? D.ref : p.ref), "Montant : " + euros(p.montantCents) + " TTC", "Prise en charge : " + instantFr(p.priseEnCharge),
    lienDocs ? "Ouvrir la réservation : " + lienDocs : "", "", "Mode test Stripe : aucun paiement réel."].join("\n");
  return { subject: `[ELEV8] ${sujet} | ${D ? D.ref : p.ref}`, text: t, html: `<pre style="font:14px/1.5 Helvetica,Arial,sans-serif;white-space:pre-wrap">${esc(t)}</pre>` };
}
