import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  AmountCard,
  Button,
  EmptyState,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StatusPill,
  TextField,
  type StatutPill,
} from '../../src/components/ui';
import type { OperateurPaiement, Paiement, StatutPaiement } from '../../src/models';
import { CODES_ERREUR_MEMBRE } from '../../src/services/contracts';
import type { ErreurApp } from '../../src/services/contracts';
import { memberRepository, publicContentService } from '../../src/services/factory';

/**
 * Écran de paiement du MEMBRE (hors onglets) — frais de dépôt d'une œuvre validée.
 *
 * Règles impératives reprises de l'écran N (paiement candidat) :
 * - le montant vient EXCLUSIVEMENT du service `estimerMontant` — jamais de l'écran ;
 * - aucun succès n'est annoncé avant la confirmation du serveur
 *   (`paiement.statut = 'REUSSI'` obtenu par polling via `obtenirPaiement`) ;
 * - le bouton « Payer » reste neutre (`secondary`) : aucun vert `status-success`
 *   n'est affiché avant `REUSSI` ;
 * - l'application n'invente jamais un statut : une panne pendant le polling ne
 *   fait que réinterroger le serveur ;
 * - Mobile Money est le mode proposé ici : la liste des opérateurs vient du
 *   service (un opérateur désactivé est absent) ;
 * - 4 états obligatoires : chargement / erreur + « Réessayer » / vide / contenu.
 */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Préfixe international imposé à tous les numéros Mobile Money. */
const PREFIXE_TELEPHONE = '+261';

/** Longueur minimale d'un numéro valide (`+261` + 9 chiffres). */
const LONGUEUR_MIN_NUMERO = PREFIXE_TELEPHONE.length + 9;

/** Intervalle entre deux interrogations du statut (polling mobile money). */
const INTERVALLE_POLLING_MS = 2500;

/** Durée maximale d'attente d'une confirmation de l'opérateur. */
const DELAI_MAX_POLLING_MS = 120000;

/** Statuts pour lesquels le serveur ne changera plus rien (succès ou échec). */
const STATUTS_FINAUX: StatutPaiement[] = [
  'REUSSI',
  'REJETE',
  'ECHEC_AUTRE',
  'ECHEC_SOLDE_INSUFFISANT',
];

/**
 * Statuts affichés (cahier des charges §6).
 * ⚠️ Seul `REUSSI` est en vert (`success`) : il vient exclusivement du serveur.
 */
const STATUTS_AFFICHES: Record<StatutPaiement, { variante: StatutPill; libelle: string }> = {
  INITIE: { variante: 'pending', libelle: 'Paiement initié' },
  EN_ATTENTE_CONFIRMATION: { variante: 'pending', libelle: 'En attente de l’opérateur' },
  REUSSI: { variante: 'success', libelle: 'Paiement confirmé' },
  ECHEC_SOLDE_INSUFFISANT: { variante: 'error', libelle: 'Échec : solde insuffisant' },
  ECHEC_AUTRE: { variante: 'error', libelle: 'Échec technique de l’opérateur' },
  REJETE: { variante: 'error', libelle: 'Paiement rejeté' },
};

/** Messages distincts imposés pour chaque issue défavorable du paiement. */
const MESSAGES_ECHEC: Partial<Record<StatutPaiement, { titre: string; message: string }>> = {
  ECHEC_SOLDE_INSUFFISANT: {
    titre: 'Solde insuffisant',
    message:
      'Votre compte Mobile Money ne présente pas un solde suffisant pour ce paiement. Rechargez votre compte puis relancez le paiement.',
  },
  ECHEC_AUTRE: {
    titre: 'Paiement non abouti',
    message:
      'L’opérateur Mobile Money n’a pas pu confirmer ce paiement. Aucun montant n’a été débité : vous pouvez relancer le paiement.',
  },
  REJETE: {
    titre: 'Paiement rejeté',
    message:
      'Le paiement a été annulé ou rejeté. Aucun montant n’a été débité : vous pouvez relancer le paiement.',
  },
};

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service de paiement est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Numéro Mobile Money au format international `+261…` (chiffres uniquement). */
function numeroValide(numero: string): boolean {
  const propre = numero.trim().replace(/[\s.-]/g, '');
  if (!propre.startsWith(PREFIXE_TELEPHONE)) return false;
  if (propre.length < LONGUEUR_MIN_NUMERO) return false;
  return /^\+[0-9]+$/.test(propre);
}

/** Date et heure ISO affichées en `JJ/MM/AAAA à HH:MM` (sans `Intl`). */
function formaterDateHeure(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const heures = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${jour}/${mois}/${date.getFullYear()} à ${heures}:${minutes}`;
}

/** Paramètre d'URL unique (chaîne) ou absent. */
function parametreTexte(valeur: string | string[] | undefined): string {
  if (typeof valeur === 'string') return valeur.trim();
  if (Array.isArray(valeur) && valeur.length > 0 && typeof valeur[0] === 'string') {
    return valeur[0].trim();
  }
  return '';
}

function estStatutFinal(statut: StatutPaiement): boolean {
  return STATUTS_FINAUX.includes(statut);
}

/** Contexte du paiement : objet, montant (du service) et rattachement. */
type ContextePaiement = {
  type: 'DEPOT_OEUVRE';
  objet: string;
  montant: number;
  mention: string;
  oeuvre_id: string | null;
  /** Vrai si le serveur annonce déjà le règlement (aucun paiement possible). */
  deja_regle: boolean;
};

export default function PaiementMembreScreen() {
  const parametres = useLocalSearchParams<{
    type?: string;
    oeuvre_id?: string;
  }>();

  const typeParam = parametreTexte(parametres.type);
  const oeuvreIdParam = parametreTexte(parametres.oeuvre_id);

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [messageVide, setMessageVide] = useState('');
  const [contexte, setContexte] = useState<ContextePaiement | null>(null);
  const [operateurChoisi, setOperateurChoisi] = useState<OperateurPaiement | null>(null);
  const [operateurLibelle, setOperateurLibelle] = useState<string | null>(null);
  const [numeroTelephone, setNumeroTelephone] = useState('');
  const [erreurNumero, setErreurNumero] = useState<string | null>(null);

  const [paiement, setPaiement] = useState<Paiement | null>(null);
  const [initiationEnCours, setInitiationEnCours] = useState(false);
  const [erreurInitiation, setErreurInitiation] = useState<string | null>(null);
  const [delaiDepasse, setDelaiDepasse] = useState(false);
  const [verificationEnCours, setVerificationEnCours] = useState(false);
  const [erreurVerification, setErreurVerification] = useState<string | null>(null);

  /** Début de la fenêtre d'attente du polling (non réinitialisé à chaque poll). */
  const debutPollingRef = useRef<number | null>(null);
  /** Vrai tant que l'écran est affiché (aucun `setState` après démontage). */
  const monteRef = useRef(true);

  useEffect(() => {
    monteRef.current = true;
    return () => {
      monteRef.current = false;
    };
  }, []);

  /** Contexte d'un dépôt d'œuvre : paiement possible UNIQUEMENT pour `VALIDEE`. */
  const chargerContexteOeuvre = useCallback(async () => {
    if (!oeuvreIdParam) {
      setMessageVide(
        'Aucune œuvre n’a été transmise à cet écran. Revenez à la fiche de votre œuvre pour relancer le paiement.',
      );
      setEtat('vide');
      return;
    }

    const reponse = await memberRepository.obtenirOeuvre(oeuvreIdParam);

    if (!monteRef.current) return;

    if (!reponse.ok) {
      if (
        reponse.erreur.type === 'metier' &&
        reponse.erreur.code === CODES_ERREUR_MEMBRE.OEUVRE_INTROUVABLE
      ) {
        setMessageVide(reponse.erreur.message);
        setEtat('vide');
        return;
      }
      setMessageErreur(traduireErreur(reponse.erreur));
      setEtat('erreur');
      return;
    }

    const oeuvre = reponse.valeur;

    if (oeuvre.statut !== 'VALIDEE' && oeuvre.statut !== 'DEPOT_FINALISE') {
      setMessageVide(
        'Le paiement des frais de dépôt n’est possible que pour une œuvre validée par l’OMDA.',
      );
      setEtat('vide');
      return;
    }

    const estimation = await publicContentService.estimerMontant({
      type_operation: 'DEPOT_OEUVRE',
      categorie_id: oeuvre.categorie_id,
    });

    if (!monteRef.current) return;

    if (!estimation.ok) {
      setMessageErreur(traduireErreur(estimation.erreur));
      setEtat('erreur');
      return;
    }

    setContexte({
      type: 'DEPOT_OEUVRE',
      objet: `Frais de dépôt — ${oeuvre.titre}`,
      montant: estimation.valeur.montant,
      mention: estimation.valeur.mention,
      oeuvre_id: oeuvre.id,
      deja_regle: oeuvre.statut === 'DEPOT_FINALISE',
    });
    setEtat('contenu');
  }, [oeuvreIdParam]);

  /**
   * Prépare le paiement : opérateurs Mobile Money actifs (service) puis montant
   * de l'objet à régler, toujours fourni par le service.
   */
  const chargerPaiement = useCallback(async () => {
    setEtat('chargement');
    setMessageErreur('');
    setErreurInitiation(null);
    setErreurVerification(null);
    setDelaiDepasse(false);
    setPaiement(null);

    try {
      const reponseOperateurs = await publicContentService.listerOperateursMobileMoney();

      if (!reponseOperateurs.ok) {
        setMessageErreur(traduireErreur(reponseOperateurs.erreur));
        setEtat('erreur');
        return;
      }

      if (reponseOperateurs.valeur.length === 0) {
        setMessageVide(
          'Aucun opérateur Mobile Money n’est disponible pour le moment. Veuillez réessayer plus tard.',
        );
        setEtat('vide');
        return;
      }

      // Opérateur unique (MVola) : retenu automatiquement, jamais sélectionnable.
      const premierOperateur = reponseOperateurs.valeur[0];
      setOperateurChoisi(premierOperateur.code);
      setOperateurLibelle(premierOperateur.libelle);

      if (typeParam === 'DEPOT_OEUVRE') {
        await chargerContexteOeuvre();
        return;
      }

      setMessageVide(
        'Ce paiement n’est pas disponible depuis cet écran. Revenez à la fiche de votre œuvre validée.',
      );
      setEtat('vide');
    } catch {
      setMessageErreur(
        'Une erreur inattendue est survenue pendant la préparation du paiement. Veuillez réessayer.',
      );
      setEtat('erreur');
    }
  }, [chargerContexteOeuvre, typeParam]);

  /** Chargement initial : sans cet appel, l'écran resterait bloqué. */
  useEffect(() => {
    void chargerPaiement();
  }, [chargerPaiement]);

  /* ------------------------ Polling Mobile Money (statut serveur uniquement) */

  const statutCourant = paiement?.statut ?? null;

  useEffect(() => {
    if (!paiement || !statutCourant) return;
    if (estStatutFinal(statutCourant) || delaiDepasse) return;

    const paiementId = paiement.id;
    let annule = false;
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    const interroger = async () => {
      if (annule || !monteRef.current) return;

      const debut = debutPollingRef.current ?? Date.now();
      if (Date.now() - debut > DELAI_MAX_POLLING_MS) {
        if (monteRef.current) setDelaiDepasse(true);
        return;
      }

      const reponse = await memberRepository.obtenirPaiement(paiementId);
      if (annule || !monteRef.current) return;

      if (reponse.ok) {
        setPaiement(reponse.valeur);
      }
      // Panne réseau/serveur : l'application n'invente jamais un succès, elle réinterroge.
      minuteur = setTimeout(() => void interroger(), INTERVALLE_POLLING_MS);
    };

    minuteur = setTimeout(() => void interroger(), INTERVALLE_POLLING_MS);

    return () => {
      annule = true;
      if (minuteur) clearTimeout(minuteur);
    };
  }, [delaiDepasse, paiement, statutCourant]);

  /* ------------------------------------------------------ Valeurs dérivées */

  const paiementConfirme = paiement?.statut === 'REUSSI';
  const statutAffiche = paiement ? STATUTS_AFFICHES[paiement.statut] : null;
  const messageEchec = paiement ? (MESSAGES_ECHEC[paiement.statut] ?? null) : null;
  const paiementEnAttente =
    Boolean(paiement) && !paiementConfirme && !messageEchec && !delaiDepasse;

  const numeroSaisiValide = numeroValide(numeroTelephone);
  const paiementPossible = Boolean(contexte) && contexte?.deja_regle === false && !paiement;
  const boutonPayerActif =
    paiementPossible && Boolean(operateurChoisi) && numeroSaisiValide && !initiationEnCours;

  /* ------------------------------------------------------------- Actions */

  /** Mobile Money : initiation puis confirmation UNIQUEMENT via le serveur. */
  const payerMobileMoney = useCallback(async () => {
    if (!contexte) return;

    if (!operateurChoisi) {
      setErreurInitiation('Aucun opérateur Mobile Money n’est disponible pour le moment.');
      return;
    }

    if (!numeroValide(numeroTelephone)) {
      setErreurNumero(
        'Indiquez le numéro Mobile Money au format international, par exemple +261340000001.',
      );
      return;
    }

    const numeroNettoye = numeroTelephone.trim().replace(/[\s.-]/g, '');
    setErreurNumero(null);
    setErreurInitiation(null);
    setDelaiDepasse(false);
    setInitiationEnCours(true);

    const reponse = await memberRepository.initierPaiement({
      type: contexte.type,
      mode: 'MOBILE_MONEY',
      operateur: operateurChoisi,
      numero_telephone: numeroNettoye,
      oeuvre_id: contexte.oeuvre_id,
    });

    if (!monteRef.current) return;
    setInitiationEnCours(false);

    if (!reponse.ok) {
      setErreurInitiation(traduireErreur(reponse.erreur));
      return;
    }

    // Statut `INITIE` : la confirmation (ou l'échec) viendra du serveur (polling).
    debutPollingRef.current = Date.now();
    setPaiement(reponse.valeur);
  }, [contexte, numeroTelephone, operateurChoisi]);

  /** Interrogation manuelle du statut (après un délai dépassé ou un échec). */
  const verifierStatut = useCallback(async () => {
    if (!paiement) return;

    setVerificationEnCours(true);
    setErreurVerification(null);

    const reponse = await memberRepository.obtenirPaiement(paiement.id);

    if (!monteRef.current) return;
    setVerificationEnCours(false);

    if (!reponse.ok) {
      setErreurVerification(traduireErreur(reponse.erreur));
      return;
    }

    debutPollingRef.current = Date.now();
    setDelaiDepasse(false);
    setPaiement(reponse.valeur);
  }, [paiement]);

  /** Après un échec : efface le paiement suivi pour proposer une nouvelle tentative. */
  const relancerPaiement = useCallback(() => {
    debutPollingRef.current = null;
    setPaiement(null);
    setDelaiDepasse(false);
    setErreurInitiation(null);
    setErreurVerification(null);
  }, []);

  /** Retour à la fiche de l'œuvre concernée. */
  const retourObjet = useCallback(() => {
    if (contexte?.type === 'DEPOT_OEUVRE' && contexte.oeuvre_id) {
      router.push({
        pathname: '/(membre)/fiche-oeuvre',
        params: { oeuvre_id: contexte.oeuvre_id },
      });
      return;
    }
    router.replace('/(membre)/(tabs)/oeuvres');
  }, [contexte]);

  const libelleRetour = 'Voir la fiche de mon œuvre';

  /* ------------------------------------------------------ États de l'écran */

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Paiement" sousTitre="Espace membre">
        <LoadingState message="Préparation du paiement…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Paiement" sousTitre="Espace membre">
        <ErrorState
          titre="Paiement indisponible"
          message={messageErreur}
          libelleAction="Réessayer"
          onReessayer={() => void chargerPaiement()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide' || !contexte) {
    return (
      <ScreenContainer titre="Paiement" sousTitre="Espace membre">
        <EmptyState
          titre="Paiement indisponible"
          message={messageVide}
          icone="money-bill-wave"
          actionLibelle="Retour"
          onAction={retourObjet}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Paiement" sousTitre="Espace membre">
      <AmountCard objet={contexte.objet} montant={contexte.montant} mention={contexte.mention} />

      <View className="mt-5">
        <InfoBanner
          variante="info"
          titre="Confirmation par le serveur uniquement"
          message="L’OMDA ne considère un paiement comme réussi qu’après la confirmation du serveur (opérateur Mobile Money). L’application n’anticipe jamais un succès."
        />
      </View>

      {contexte.deja_regle ? (
        <View className="mt-5 gap-3">
          <InfoBanner
            variante="success"
            titre="Déjà réglé"
            message="Le serveur OMDA indique que ce règlement a déjà été confirmé : aucun nouveau paiement n’est nécessaire."
          />
          <Button
            libelle={libelleRetour}
            variante="secondary"
            icone="arrow-right"
            pleineLargeur
            onPress={retourObjet}
          />
        </View>
      ) : null}

      {paiementPossible ? (
        <View className="mt-5 gap-4">
          <Text className="text-base font-semibold text-omda-black">Payer par Mobile Money</Text>

          {/* Opérateur unique (MVola) : affiché depuis le service, non sélectionnable. */}
          <View className="flex-row items-center rounded-xl border border-omda-borderGray bg-omda-warmGray px-4 py-3">
            <Icone nom="mobile-screen-button" taille={16} classeCouleur="text-omda-textGray" />
            <Text className="ml-2 flex-1 text-sm text-omda-black">
              {operateurLibelle ? `Opérateur : ${operateurLibelle}` : 'Opérateur Mobile Money'}
            </Text>
          </View>

          <TextField
            libelle="Numéro Mobile Money"
            valeur={numeroTelephone}
            onChangeValeur={setNumeroTelephone}
            clavier="phone-pad"
            placeholder="+261340000001"
            aide="Numéro au format international, préfixe +261."
            erreur={erreurNumero ?? undefined}
            obligatoire
            desactive={initiationEnCours}
          />

          <Button
            libelle="Payer"
            variante="secondary"
            icone="money-bill-wave"
            pleineLargeur
            chargement={initiationEnCours}
            desactive={!boutonPayerActif}
            onPress={() => void payerMobileMoney()}
          />

          {erreurInitiation ? (
            <InfoBanner
              variante="error"
              titre="Paiement impossible"
              message={erreurInitiation}
            />
          ) : null}
        </View>
      ) : null}

      {paiement && statutAffiche ? (
        <View className="mt-5 gap-4 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-omda-black">Suivi du paiement</Text>
            <StatusPill statut={statutAffiche.variante} libelle={statutAffiche.libelle} />
          </View>

          {paiementEnAttente ? (
            <InfoBanner
              variante="pending"
              titre="Paiement en cours de confirmation"
              message="Une demande de paiement a été envoyée à l’opérateur Mobile Money. Validez la demande sur votre téléphone : cette page se met à jour automatiquement dès la confirmation du serveur."
            />
          ) : null}

          {delaiDepasse ? (
            <InfoBanner
              variante="pending"
              titre="Délai d’attente dépassé"
              message="L’opérateur n’a pas confirmé ce paiement dans le délai imparti. Vérifiez l’état réel du paiement : s’il a été débité, la confirmation arrivera automatiquement."
              actionLibelle="Vérifier à nouveau"
              onAction={() => void verifierStatut()}
            />
          ) : null}

          {erreurVerification ? (
            <InfoBanner
              variante="error"
              titre="Vérification impossible"
              message={erreurVerification}
              actionLibelle="Réessayer"
              onAction={() => void verifierStatut()}
            />
          ) : null}

          {messageEchec ? (
            <InfoBanner
              variante="error"
              titre={messageEchec.titre}
              message={
                paiement.motif_echec
                  ? `${messageEchec.message} Motif transmis : ${paiement.motif_echec}`
                  : messageEchec.message
              }
              actionLibelle="Relancer le paiement"
              onAction={relancerPaiement}
            />
          ) : null}

          {paiementConfirme ? (
            <View className="gap-3 rounded-xl border border-status-success bg-omda-white p-4">
              <View className="flex-row items-center">
                <Icone nom="circle-check" taille={22} classeCouleur="text-status-success" />
                <Text className="ml-3 flex-1 text-base font-bold text-status-success">
                  Paiement confirmé.
                </Text>
              </View>

              <Text className="text-base text-omda-black">
                {paiement.date_confirmation
                  ? `Confirmation reçue du serveur OMDA le ${formaterDateHeure(paiement.date_confirmation)}.`
                  : 'Confirmation reçue du serveur OMDA.'}
              </Text>

              <Text className="text-base text-omda-black">
                {`Référence interne : ${paiement.reference_interne}`}
              </Text>

              <Button
                libelle={libelleRetour}
                variante="secondary"
                icone="arrow-right"
                pleineLargeur
                onPress={retourObjet}
              />
            </View>
          ) : null}

          {!paiementConfirme && !messageEchec ? (
            <Button
              libelle="Vérifier le statut"
              variante="secondary"
              icone="arrows-rotate"
              pleineLargeur
              chargement={verificationEnCours}
              onPress={() => void verifierStatut()}
            />
          ) : null}
        </View>
      ) : null}

      <View className="mt-6 gap-3">
        <Button
          libelle="Retour"
          variante="secondary"
          icone="arrow-left"
          pleineLargeur
          onPress={retourObjet}
        />
      </View>
    </ScreenContainer>
  );
}
