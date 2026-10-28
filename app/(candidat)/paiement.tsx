import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

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
  formaterMontantAriary,
  type StatutPill,
} from '../../src/components/ui';
import {
  type StatutPaiement,
  type TypePaiement,
} from '../../src/models';
import type {
  ErreurApp,
  EtatPaiementCandidat,
  OptionsPaiementCandidat,
} from '../../src/services/contracts';
import { obtenirHistoriqueDossiers } from '../../src/services/local/historiqueDossiers';
import { candidateApi } from '../../src/services/factory';
import { colors } from '../../src/theme/colors';

/**
 * Écran N — Paiement candidat (public, sans menu).
 *
 * SEUL mode de paiement : Mobile Money (MVola), opérateur unique servi par le
 * service et non sélectionnable.
 *
 * Règles impératives appliquées ici :
 * - montant et opérateur viennent EXCLUSIVEMENT du service ;
 * - aucun succès n'est annoncé avant la confirmation du serveur
 *   (`paiement.statut = 'REUSSI'` obtenu par polling) ;
 * - le bouton « Payer » reste neutre (`secondary`) : aucun vert `status-success`
 *   n'est affiché tant que le paiement n'est pas confirmé.
 */

/* -------------------------------------------------------------- Constantes */

/** Préfixe international imposé à tous les numéros Mobile Money. */
const PREFIXE_TELEPHONE = '+261';

/** Longueur minimale d'un numéro valide (`+261` + 9 chiffres). */
const LONGUEUR_MIN_NUMERO = PREFIXE_TELEPHONE.length + 9;

/** Intervalle entre deux interrogations du statut (polling Mobile Money). */
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

/** Objet affiché pour chaque type de paiement (le montant vient du service). */
const OBJETS_PAIEMENT: Partial<Record<TypePaiement, string>> = {
  ADHESION: 'Frais d’adhésion',
  DEPOT_OEUVRE: 'Frais de dépôt d’œuvre',
};

/** Messages distincts imposés pour chaque issue défavorable du paiement. */
const MESSAGES_ECHEC: Partial<Record<StatutPaiement, { titre: string; message: string }>> = {
  ECHEC_SOLDE_INSUFFISANT: {
    titre: 'Solde insuffisant',
    message:
      'Votre compte Mobile Money ne dispose pas d’un solde suffisant pour régler ces frais. Rechargez votre compte ou utilisez un autre numéro, puis relancez le paiement.',
  },
  ECHEC_AUTRE: {
    titre: 'Paiement non abouti',
    message:
      'L’opérateur n’a pas pu confirmer votre paiement. Aucun débit n’a été confirmé : vous pouvez relancer le paiement.',
  },
  REJETE: {
    titre: 'Paiement rejeté',
    message:
      'Vous avez refusé ou annulé la demande de paiement sur votre téléphone. Aucun montant n’a été débité. Vous pouvez relancer le paiement.',
  },
};

/* ------------------------------------------------------------- Utilitaires */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Libellés des statuts de paiement (le vert = succès confirmé uniquement). */
const STATUTS_PAIEMENT_AFFICHES: Record<StatutPaiement, { variante: StatutPill; libelle: string }> = {
  INITIE: { variante: 'pending', libelle: 'Paiement initié' },
  EN_ATTENTE_CONFIRMATION: { variante: 'pending', libelle: 'Attente de confirmation' },
  REUSSI: { variante: 'success', libelle: 'Paiement confirmé' },
  ECHEC_SOLDE_INSUFFISANT: { variante: 'error', libelle: 'Solde insuffisant' },
  ECHEC_AUTRE: { variante: 'error', libelle: 'Paiement non abouti' },
  REJETE: { variante: 'error', libelle: 'Paiement rejeté' },
};

function parametreTexte(valeur: string | string[] | undefined): string {
  if (typeof valeur === 'string') return valeur.trim();
  if (Array.isArray(valeur) && valeur.length > 0 && typeof valeur[0] === 'string') {
    return valeur[0].trim();
  }
  return '';
}

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

function formaterDateHeure(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const annee = date.getFullYear();
  const heures = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${jour}/${mois}/${annee} à ${heures}:${minutes}`;
}

function isStatutFinal(statut: StatutPaiement): boolean {
  return STATUTS_FINAUX.includes(statut);
}


/* ------------------------------------------------------------------ Écran */

export default function PaiementScreen() {
  const parametres = useLocalSearchParams<{
    numero_dossier?: string;
    code_suivi?: string;
  }>();

  const [numeroDossier, setNumeroDossier] = useState('');
  const [codeSuivi, setCodeSuivi] = useState('');

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [options, setOptions] = useState<OptionsPaiementCandidat | null>(null);

  const [numeroTelephone, setNumeroTelephone] = useState('');
  const [erreurNumero, setErreurNumero] = useState<string | null>(null);

  const [paiement, setPaiement] = useState<EtatPaiementCandidat | null>(null);
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

  /* ----------------------------------------------- Chargement (4 états) */

  const chargerOptions = useCallback(async (numero: string, code: string) => {
    const numeroNettoye = numero.trim().toUpperCase();
    const codeNettoye = code.trim().toUpperCase();

    if (!numeroNettoye || !codeNettoye) {
      setPaiement(null);
      setOptions(null);
      setErreurChargement(
        'Les informations de votre dossier sont incomplètes. Revenez au suivi de votre demande pour relancer le paiement.',
      );
      setEtat('erreur');
      return;
    }

    setEtat('chargement');
    setErreurChargement(null);

    const reponse = await candidateApi.obtenirOptionsPaiement({
      numero_dossier: numeroNettoye,
      code_suivi: codeNettoye,
    });

    if (!monteRef.current) return;

    if (!reponse.ok) {
      setOptions(null);
      setErreurChargement(traduireErreur(reponse.erreur));
      setEtat('erreur');
      return;
    }

    setOptions(reponse.valeur);
    setEtat(reponse.valeur.modes.length > 0 ? 'contenu' : 'vide');
  }, []);

  useEffect(() => {
    const numeroParam = parametreTexte(parametres.numero_dossier);
    const codeParam = parametreTexte(parametres.code_suivi);

    if (numeroParam && codeParam) {
      setNumeroDossier(numeroParam);
      setCodeSuivi(codeParam);
      void chargerOptions(numeroParam, codeParam);
      return;
    }

    // Repli : dernier dossier envoyé conservé sur le téléphone (écran L).
    void (async () => {
      const historique = await obtenirHistoriqueDossiers();
      if (!monteRef.current) return;
      const dernier = historique.ok ? historique.valeur[0] : undefined;
      const numero = dernier?.numero_dossier ?? '';
      const code = dernier?.code_suivi ?? '';
      setNumeroDossier(numero);
      setCodeSuivi(code);
      await chargerOptions(numero, code);
    })();
  }, [chargerOptions, parametres.code_suivi, parametres.numero_dossier]);

  /* ------------------------------ Polling Mobile Money (serveur uniquement) */

  const referenceCourante = paiement?.reference_interne ?? null;
  const statutCourant = paiement?.statut ?? null;
  const modeCourant = paiement?.mode ?? null;

  useEffect(() => {
    if (!referenceCourante || !statutCourant) return;
    if (modeCourant !== 'MOBILE_MONEY') return;
    if (isStatutFinal(statutCourant) || delaiDepasse) return;

    let annule = false;
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    const interroger = async () => {
      if (annule || !monteRef.current) return;

      const debut = debutPollingRef.current ?? Date.now();
      if (Date.now() - debut > DELAI_MAX_POLLING_MS) {
        if (monteRef.current) setDelaiDepasse(true);
        return;
      }

      const reponse = await candidateApi.obtenirEtatPaiement(referenceCourante);
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
  }, [delaiDepasse, modeCourant, referenceCourante, statutCourant]);


  /* ------------------------------------------------------- Valeurs dérivées */

  /** Seul mode de l'application : Mobile Money (MVola). */
  const modeSelectionne = useMemo(() => {
    if (!options) return null;
    return options.modes.find((mode) => mode.mode === 'MOBILE_MONEY') ?? null;
  }, [options]);

  /** Opérateur servi par le serveur : MVola, affiché et jamais sélectionnable. */
  const operateursDisponibles = useMemo(
    () => modeSelectionne?.operateurs ?? [],
    [modeSelectionne],
  );

  const operateurRetenu = operateursDisponibles[0] ?? null;

  const infoStatutPaiement = paiement ? STATUTS_PAIEMENT_AFFICHES[paiement.statut] : null;
  const paiementConfirme = paiement?.statut === 'REUSSI';
  const messageEchec = paiement ? (MESSAGES_ECHEC[paiement.statut] ?? null) : null;
  const paiementEnAttente = Boolean(paiement) && !paiementConfirme && !messageEchec && !delaiDepasse;

  /* ------------------------------------------------------------- Actions */

  const retourSuivi = useCallback(() => {
    router.push({
      pathname: '/(candidat)/suivi',
      params: { numero_dossier: numeroDossier, code_suivi: codeSuivi },
    });
  }, [codeSuivi, numeroDossier]);

  const ouvrirConfirmation = useCallback(() => {
    if (!paiement) return;
    router.push({
      pathname: '/(candidat)/succes-adhesion',
      params: {
        numero_dossier: numeroDossier,
        code_suivi: codeSuivi,
        reference_interne: paiement.reference_interne,
      },
    });
  }, [codeSuivi, numeroDossier, paiement]);

  /** Après un échec : efface le paiement suivi pour proposer une nouvelle tentative. */
  const relancerPaiement = useCallback(() => {
    debutPollingRef.current = null;
    setPaiement(null);
    setDelaiDepasse(false);
    setErreurInitiation(null);
    setErreurVerification(null);
  }, []);

  /** Mobile Money (MVola) : initiation puis confirmation uniquement via le serveur. */
  const payerMobileMoney = useCallback(async () => {
    if (!numeroDossier || !codeSuivi) {
      setErreurInitiation(
        'Les informations de votre dossier sont incomplètes. Revenez au suivi de votre demande.',
      );
      return;
    }
    if (!modeSelectionne) return;
    if (!operateurRetenu) {
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

    const reponse = await candidateApi.initierPaiement({
      numero_dossier: numeroDossier,
      code_suivi: codeSuivi,
      mode: 'MOBILE_MONEY',
      operateur: operateurRetenu.code,
      numero_telephone: numeroNettoye,
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
  }, [codeSuivi, modeSelectionne, numeroDossier, numeroTelephone, operateurRetenu]);

  /** Interrogation manuelle du statut (après un délai dépassé). */
  const verifierStatut = useCallback(async () => {
    if (!paiement) return;

    setVerificationEnCours(true);
    setErreurVerification(null);

    const reponse = await candidateApi.obtenirEtatPaiement(paiement.reference_interne);

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


  /* --------------------------------------------------------------- Rendu */

  return (
    <ScreenContainer titre="Paiement des frais" sousTitre="Dossier validé">
      {etat === 'chargement' ? <LoadingState message="Préparation de votre paiement…" /> : null}

      {etat === 'erreur' ? (
        <View className="gap-4">
          <ErrorState
            titre="Paiement indisponible"
            message={erreurChargement ?? 'Impossible de préparer votre paiement pour le moment.'}
            libelleAction="Réessayer"
            onReessayer={() => void chargerOptions(numeroDossier, codeSuivi)}
          />

          <Button
            libelle="Suivre ma demande"
            variante="secondary"
            icone="magnifying-glass"
            pleineLargeur
            onPress={retourSuivi}
          />
        </View>
      ) : null}

      {etat === 'vide' ? (
        <View className="gap-4">
          <EmptyState
            icone="money-bill-wave"
            titre="Aucun moyen de paiement proposé"
            message="Le serveur OMDA ne propose aucun moyen de paiement pour le moment. Vérifiez le suivi de votre demande puis réessayez plus tard."
            actionLibelle="Actualiser"
            onAction={() => void chargerOptions(numeroDossier, codeSuivi)}
          />

          <Button
            libelle="Suivre ma demande"
            variante="secondary"
            icone="magnifying-glass"
            pleineLargeur
            onPress={retourSuivi}
          />
        </View>
      ) : null}

      {etat === 'contenu' && options ? (
        <View className="gap-5">
          {/* Montant dû : fourni par le serveur, jamais modifiable */}
          <AmountCard
            objet={OBJETS_PAIEMENT[options.paiement_du.type] ?? 'Frais de paiement'}
            montant={options.paiement_du.montant}
            mention="Montant officiel communiqué par le serveur OMDA."
            icone="money-bill-wave"
          />

          <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-omda-textGray">
              Dossier concerné
            </Text>
            <Text selectable className="mt-1 text-lg font-bold text-omda-black">
              {numeroDossier}
            </Text>
            <Text className="mt-2 text-sm text-omda-textGray">
              Les frais affichés proviennent du serveur OMDA et ne peuvent pas être modifiés depuis
              l’application.
            </Text>
          </View>

          {/* Mobile Money (MVola) : opérateur fourni par le serveur + numéro +261, puis « Payer » (neutre) */}
          {!paiement && modeSelectionne ? (
            <View className="gap-4 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
              <View className="flex-row items-center">
                <Icone nom="mobile-screen-button" taille={18} classeCouleur="text-omda-textGray" />
                <Text className="ml-2 flex-1 text-base font-bold text-omda-black">
                  Paiement Mobile Money (MVola)
                </Text>
              </View>

              <Text className="text-sm text-omda-textGray">
                Indiquez le numéro qui sera débité. Vous validerez la demande sur votre téléphone.
              </Text>

              {operateurRetenu ? (
                <View className="flex-row items-center rounded-xl border border-omda-borderGray bg-omda-warmGray px-4 py-3">
                  <Icone nom="mobile-screen-button" taille={16} classeCouleur="text-omda-textGray" />
                  <Text className="ml-2 flex-1 text-sm text-omda-black">
                    {`Opérateur : ${operateurRetenu.libelle}`}
                  </Text>
                </View>
              ) : (
                <InfoBanner
                  variante="error"
                  titre="Aucun opérateur disponible"
                  message="Aucun opérateur Mobile Money n’est disponible pour le moment. Réessayez plus tard."
                />
              )}

              <TextField
                libelle="Numéro Mobile Money"
                obligatoire
                valeur={numeroTelephone}
                onChangeValeur={setNumeroTelephone}
                placeholder="+261340000001"
                aide="Numéro au format international, précédé de +261."
                erreur={erreurNumero ?? undefined}
                clavier="phone-pad"
              />

              <Button
                libelle="Payer"
                variante="secondary"
                icone="mobile-screen-button"
                pleineLargeur
                chargement={initiationEnCours}
                desactive={!operateurRetenu || numeroTelephone.trim().length === 0}
                onPress={() => void payerMobileMoney()}
              />

              {erreurInitiation ? (
                <InfoBanner variante="error" titre="Paiement non démarré" message={erreurInitiation} />
              ) : null}

              <InfoBanner
                variante="info"
                titre="Confirmation indispensable"
                message="Votre paiement ne sera considéré comme réussi qu’après la confirmation de l’opérateur. Aucun succès n’est annoncé à l’avance."
              />
            </View>
          ) : null}

          {/* Suivi du paiement Mobile Money : statut fourni par le serveur (polling) */}
          {paiement && modeCourant === 'MOBILE_MONEY' && infoStatutPaiement ? (
            <View className="gap-4 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
              <StatusPill statut={infoStatutPaiement.variante} libelle={infoStatutPaiement.libelle} />

              <Text className="text-base text-omda-black">
                {`Référence interne : ${paiement.reference_interne}`}
              </Text>
              <Text className="text-sm text-omda-textGray">
                {`Montant : ${formaterMontantAriary(paiement.montant)}`}
              </Text>
              {paiement.reference_externe ? (
                <Text className="text-sm text-omda-textGray">
                  {`Référence opérateur : ${paiement.reference_externe}`}
                </Text>
              ) : null}

              {paiementEnAttente ? (
                <View className="flex-row items-center">
                  <ActivityIndicator color={colors.status.pending} />
                  <Text className="ml-3 flex-1 text-base text-omda-black">
                    {paiement.instruction ?? 'En attente de la confirmation de l’opérateur…'}
                  </Text>
                </View>
              ) : null}

              {delaiDepasse ? (
                <View className="gap-3">
                  <InfoBanner
                    variante="pending"
                    titre="Délai d’attente dépassé"
                    message="L’opérateur n’a pas encore répondu dans le délai prévu. Aucun paiement n’est confirmé à ce stade : aucun débit n’est annoncé. Vous pouvez vérifier à nouveau ou relancer le paiement."
                    actionLibelle="Vérifier à nouveau"
                    onAction={() => void verifierStatut()}
                  />

                  {!paiementConfirme ? (
                    <Button
                      libelle="Relancer le paiement"
                      variante="secondary"
                      icone="arrows-rotate"
                      pleineLargeur
                      onPress={relancerPaiement}
                    />
                  ) : null}
                </View>
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
                <BlocPaiementConfirme paiement={paiement} onVoirConfirmation={ouvrirConfirmation} />
              ) : null}
            </View>
          ) : null}


          {/* Rappel de la règle de confirmation + navigation linéaire (sans menu) */}
          <View className="gap-3">
            <InfoBanner
              variante="info"
              titre="Confirmation par le serveur uniquement"
              message="L’OMDA ne considère un paiement comme réussi qu’après la confirmation du serveur (opérateur Mobile Money MVola). L’application n’anticipe jamais un succès."
            />

            <Button
              libelle="Suivre ma demande"
              variante="secondary"
              icone="magnifying-glass"
              pleineLargeur
              onPress={retourSuivi}
            />

            <Button
              libelle="Retour à l’accueil"
              variante="secondary"
              pleineLargeur
              onPress={() => router.push('/(public)/accueil')}
            />
          </View>

        </View>
      ) : null}
    </ScreenContainer>
  );
}

/* ------------------------------------------------- Sous-composant local */

/** Bloc affiché UNIQUEMENT lorsque le serveur a confirmé `REUSSI`. */
function BlocPaiementConfirme({
  paiement,
  onVoirConfirmation,
}: {
  paiement: EtatPaiementCandidat;
  onVoirConfirmation: () => void;
}) {
  return (
    <View className="gap-4 rounded-xl border border-status-success bg-omda-white p-4">
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

      <Button
        libelle="Voir la confirmation"
        variante="secondary"
        icone="circle-check"
        pleineLargeur
        onPress={onVoirConfirmation}
      />
    </View>
  );
}

