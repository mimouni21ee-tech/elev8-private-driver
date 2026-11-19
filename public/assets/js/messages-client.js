/* ==========================================================================
   ELEV8 Private Driver — messages au client après validation du tarif
   --------------------------------------------------------------------------
   Fonctions pures (aucun accès à la page) utilisées par /documents et par les tests :
   - lienPaiement(u)  : contrôle d'un lien de paiement sécurisé collé à la main
                        (Caisse d'Épargne, Indy ou autre prestataire) ;
   - composer(I)      : e-mail (objet + texte) et message WhatsApp.
   Aucun lien n'est généré ni simulé ici : le lien est créé par ELEV8 dans l'interface
   de son prestataire, pour le montant définitif, puis collé dans /documents.
   Un paiement ne confirme jamais la réservation : la confirmation définitive reste
   un message distinct, envoyé par ELEV8 après vérification du règlement.
   ========================================================================== */
(function (racine) {
  "use strict";

  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €"; }

  /* Lien HTTPS valide : pas d'identifiants intégrés, pas d'adresse IP ni de nom local, pas d'espace.
     Renvoie { ok, domaine } ou { ok:false, motif }. */
  function lienPaiement(u) {
    u = String(u == null ? "" : u).trim();
    if (!u) return { ok: false, motif: "vide" };
    if (u.length > 500 || /[\s<>"'`]/.test(u)) return { ok: false, motif: "invalide" };
    var url;
    try { url = new URL(u); } catch (e) { return { ok: false, motif: "invalide" }; }
    if (url.protocol !== "https:") return { ok: false, motif: "https" };
    if (url.username || url.password) return { ok: false, motif: "invalide" };
    var h = url.hostname.toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(h) || /^\d+(\.\d+)*$/.test(h) || /(^|\.)localhost$/.test(h)) return { ok: false, motif: "invalide" };
    return { ok: true, domaine: h.replace(/^www\./, ""), lien: u };
  }

  /* I = { type: "proposition" | "reservation", ajuste, ref, prenom, date, heure, depart, destination, retour,
           vehicule, passagers, supplements:[{libelle, montant}], total, estimInitiale,
           lien (déjà contrôlé, ou ""), sansLien: "accepte" | "virement", marque, email, site } */
  function composer(I) {
    var marque = I.marque || "ELEV8 Private Driver";
    var bonjour = I.prenom ? "Bonjour " + I.prenom + "," : "Bonjour,";
    var montant = fmt(I.total) + " TTC";
    var lien = I.lien && lienPaiement(I.lien).ok ? String(I.lien).trim() : "";
    var signature = "Cordialement,\n\n" + marque + "\n" + I.email + "\n" + I.site;
    var sup = (I.supplements || []).map(function (x) { return "Supplément : " + x.libelle + " — " + fmt(parseFloat(x.montant)) + " TTC"; });
    var retour = I.retour ? "Retour : " + I.retour + (I.destination && I.depart ? " (de " + I.destination + " à " + I.depart + ")" : "") : "";
    var trajet = ["Référence : " + I.ref, "Date : " + I.date, "Heure de prise en charge : " + I.heure,
      "Adresse de départ : " + I.depart, "Adresse de destination : " + I.destination]
      .concat(retour ? [retour] : [], ["Véhicule : " + I.vehicule, "Nombre de passagers : " + (I.passagers || "—")], sup);
    var waTrajet = "Réf. " + I.ref + " · " + I.date + " à " + I.heure + "\nDépart : " + I.depart + "\nDestination : " + I.destination +
      (I.retour ? "\nRetour : " + I.retour : "");

    if (I.type === "reservation") {
      return {
        objet: marque + " — Réservation confirmée | " + I.ref,
        corps: bonjour + "\n\nNous avons bien reçu votre règlement de " + montant + " et vous en remercions.\n\n" +
          "Votre réservation est définitivement confirmée :\n\n" + trajet.join("\n") + "\nMontant réglé : " + montant + "\n\n" +
          "Votre chauffeur vous attendra à l'adresse et à l'heure indiquées. Pour toute question ou modification, répondez simplement à ce message.\n\n" + signature,
        wa: bonjour + "\nVotre réservation " + marque + " est confirmée. Règlement de " + montant + " bien reçu, merci.\n" + waTrajet + "\n\n" + marque
      };
    }

    if (lien) {
      // Avec lien de paiement : le règlement vaut acceptation du tarif ; plus de « J'accepte » à demander.
      return {
        avecLien: true,
        objet: marque + " — Finalisation de votre réservation | " + I.ref,
        corps: bonjour + "\n\nMerci d'avoir choisi " + marque + ".\n\n" +
          "Nous avons étudié votre demande et sommes heureux de vous proposer la prise en charge suivante :\n\n" +
          "Votre trajet\n\n" + trajet.join("\n") + "\n\n" +
          "Tarif définitif : " + montant + "\n\n" +
          "Votre chauffeur est disponible pour cette prestation, sous réserve de finalisation de votre réservation.\n\n" +
          "Finalisez votre réservation\n\n" +
          "Pour confirmer votre accord sur le tarif et procéder au règlement, nous vous invitons à utiliser notre lien de paiement sécurisé :\n\n" +
          lien + "\n\n" +
          "Votre réservation sera définitivement confirmée après vérification de votre règlement et confirmation par " + marque + ".\n\n" +
          "Nous vous remercions pour votre confiance et restons à votre disposition pour toute question.\n\n" + signature,
        wa: bonjour + "\nVoici la proposition " + marque + " pour votre trajet, chauffeur disponible.\n" + waTrajet +
          "\nVéhicule : " + I.vehicule + "\nTarif définitif : " + montant +
          "\n\nPour accepter ce tarif et régler en toute sécurité :\n" + lien +
          "\n\nVotre réservation sera confirmée par " + marque + " après vérification du règlement.\n\n" + marque
      };
    }

    // Sans lien : fonctionnement inchangé, le client répond « J'accepte » (éventuellement règlement par virement).
    var virement = I.sansLien === "virement";
    var ajuste = !!I.ajuste;
    return {
      avecLien: false,
      objet: marque + " — Validation de votre trajet | " + I.ref,
      corps: bonjour + "\n\nMerci pour votre demande de réservation auprès d'" + marque + ".\n\n" +
        (ajuste ? "Nous avons vérifié votre demande. Après vérification, le tarif a été ajusté ; voici les informations de votre trajet :"
                : "Nous avons vérifié votre demande et sommes heureux de vous confirmer les informations suivantes :") + "\n\n" +
        trajet.join("\n") + "\n\nTarif définitif : " + montant + (ajuste && I.estimInitiale ? " (estimation initiale : " + fmt(I.estimInitiale) + ")" : "") + "\n\n" +
        "Votre chauffeur est disponible pour cette prestation.\n\n" +
        "Pour accepter ce tarif et finaliser votre réservation, il vous suffit de répondre « J'accepte » à ce message." +
        (virement ? " Le règlement s'effectue par virement bancaire, selon les conditions convenues." : "") + "\n\n" +
        "Votre réservation sera définitivement confirmée à réception de votre accord et de notre confirmation.\n\n" +
        "Nous restons à votre disposition pour toute question.\n\n" + signature,
      wa: bonjour + "\n" + (ajuste ? "Après vérification, voici le tarif définitif de votre trajet " + marque + "." : "Votre trajet " + marque + " est validé, votre chauffeur est disponible.") +
        "\n" + waTrajet + "\nVéhicule : " + I.vehicule +
        "\nTarif définitif : " + montant + (ajuste && I.estimInitiale ? " (estimation : " + fmt(I.estimInitiale) + ")" : "") +
        "\n\nPour accepter ce tarif, répondez simplement « J'accepte »." + (virement ? " Règlement par virement bancaire, selon les conditions convenues." : "") +
        "\n\n" + marque
    };
  }

  racine.ELEV8Messages = { lienPaiement: lienPaiement, composer: composer, fmt: fmt };
})(typeof window !== "undefined" ? window : globalThis);
