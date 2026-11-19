/* Page de retour du paiement Stripe et des liens /payer/<jeton>.
   Purement informative : elle ne change AUCUN statut. Seule la notification signée de Stripe
   (webhook) peut faire passer une réservation à « Payée ». */
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  var etat = q.get("etat") || "", ref = q.get("ref") || "", j = q.get("j") || "";
  var T = {
    merci: ["Merci", "Votre paiement est en cours de vérification. Dès sa confirmation par notre prestataire de paiement, vous recevrez un e-mail : votre course sera alors attribuée à un chauffeur, puis confirmée."],
    annule: ["Paiement non effectué", "Vous avez quitté la page de paiement : aucun montant n'a été prélevé. Vous pouvez reprendre le paiement avec le même lien tant qu'il est valable."],
    deja: ["Paiement déjà reçu", "Le règlement de cette réservation a déjà été enregistré (ou est en cours de validation). Vous recevrez la confirmation par e-mail dès qu'un chauffeur aura accepté votre course."],
    expire: ["Lien expiré", "Ce lien de paiement n'est plus valable : la date limite de règlement est dépassée. Contactez-nous pour reprogrammer votre trajet."],
    "annule-lien": ["Lien désactivé", "Ce lien de paiement n'est plus valable (montant modifié ou demande annulée). Utilisez le dernier lien reçu par e-mail, ou contactez-nous."],
    rembourse: ["Réservation remboursée", "Cette réservation a été annulée et remboursée. Contactez-nous pour toute question."],
    inconnu: ["Lien inconnu", "Ce lien de paiement est introuvable. Vérifiez qu'il est complet, ou contactez-nous."],
    indisponible: ["Paiement en ligne indisponible", "Le paiement en ligne n'est pas disponible pour le moment. Contactez-nous : nous vous indiquerons comment régler votre trajet."],
    erreur: ["Service momentanément indisponible", "Le paiement n'a pas pu être ouvert. Réessayez dans quelques instants : vous ne serez jamais débité deux fois."]
  };
  var t = T[etat] || T.inconnu;
  document.getElementById("titre").textContent = t[0];
  document.getElementById("texte").textContent = t[1];
  document.title = t[0] + " — ELEV8 Private Driver";
  if (/^E8-[A-Z0-9-]{3,30}$/.test(ref)) { var r = document.getElementById("refp"); r.textContent = "Référence " + ref; r.hidden = false; }
  if ((etat === "annule" || etat === "erreur") && /^[A-Za-z0-9_-]{24}$/.test(j)) { var a = document.getElementById("reprendre"); a.href = "/payer/" + j; a.hidden = false; }
})();
