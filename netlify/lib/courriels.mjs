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

export async function envoyer(message) {
  let { to, subject, text, html, replyTo } = message;
  if (estSiteDeTest()) {                                         // site de test : jamais d'envoi à un vrai client
    const d = destinataireTest(to);
    ({ subject, text, html } = marquerTest({ subject, text, html }, to, d.redirige)); to = d.to;
  }
  if (deps.send) return deps.send({ to, subject, text, html, replyTo });
  const provider = env("EMAIL_PROVIDER").toLowerCase() || "brevo";
  const key = env("EMAIL_API_KEY"), from = env("MAIL_FROM"), nom = env("MAIL_FROM_NAME") || MARQUE;
  const dest = to || env("MAIL_TO");
  if (!key || !from || !dest) throw new Error("config");
  const r = provider === "resend"
    ? await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${nom} <${from}>`, to: [dest], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }) })
    : await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sender: { name: nom, email: from }, to: [{ email: dest }], subject, textContent: text, htmlContent: html, ...(replyTo ? { replyTo: { email: replyTo } } : {}) }) });
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
function gabarit({ titre, intro, lignes, encadre, bouton, apres }) {
  const rangs = (lignes || []).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#8a7f6a;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#f3efe6;font-size:14px">${esc(v)}</td></tr>`).join("");
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0b0b0b;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:28px 22px;color:#f3efe6">
<p style="margin:0 0 4px;letter-spacing:4px;font-size:18px;color:#f3efe6">ELEV8</p>
<p style="margin:0 0 24px;letter-spacing:3px;font-size:10px;color:#bca783">PRIVATE DRIVER</p>
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;color:#ddd1b7;margin:0 0 18px">${esc(titre)}</h1>
${(intro || []).map((t) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${esc(t)}</p>`).join("")}
${rangs ? `<table role="presentation" style="border-collapse:collapse;margin:8px 0 18px;width:100%">${rangs}</table>` : ""}
${encadre ? `<p style="border:1px solid #bca783;padding:14px 16px;font-size:17px;color:#ddd1b7;margin:0 0 20px">${esc(encadre)}</p>` : ""}
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
