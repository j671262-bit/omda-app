import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StatusPill,
  formaterMontantAriary,
} from '../../src/components/ui';
import type { StatutPaiement } from '../../src/models';
import type { ErreurApp, EtatPaiementCandidat } from '../../src/services/contracts';
import { candidateApi } from '../../src/services/factory';

/**
 * Écran O — Succès d’adhésion (public, sans menu).
 *
 * Accessible UNIQUEMENT si le service confirme `paiement.statut = 'REUSSI'`.
 * L’écran ne fait jamais confiance aux paramètres de navigation : il réinterroge
 * le serveur (`obtenirEtatPaiement`) et n’affiche le succès qu’après cette
 * confirmation. Aucune connexion automatique : le membre se connecte lui-même
 * avec les identifiants reçus (bouton « Se connecter »).
 */

type EtatEcran = 'verification' | 'confirme' | 'non_confirme' | 'erreur';

type Blocage = {
  variante: 'pending' | 'error';
  titre: string;
  message: string;
};

/** Statuts signifiant « décision du serveur encore attendue ». */
const STATUTS_EN_ATTENTE: StatutPaiement[] = ['INITIE', 'EN_ATTENTE_CONFIRMATION'];

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
    return 'Impossible de joindre le serveur OMDA pour vérifier votre paiement. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'La vérification du paiement est momentanément indisponible. Veuillez réessayer dans quelques instants.';
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

/* ------------------------------------------------------------------ Écran */

export default function SuccesAdhesionScreen() {
  const parametres = useLocalSearchParams<{
    numero_dossier?: string;
    code_suivi?: string;
    reference_interne?: string;
    numero_adherent?: string;
  }>();

  const numeroDossier = parametreTexte(parametres.numero_dossier);
  const codeSuivi = parametreTexte(parametres.code_suivi);
  const referenceInterne = parametreTexte(parametres.reference_interne);
  /** Fourni par le service/lien lorsqu’il est connu (sinon communiqué par e-mail). */
  const numeroAdherent = parametreTexte(parametres.numero_adherent);

  const [etat, setEtat] = useState<EtatEcran>('verification');
  const [paiement, setPaiement] = useState<EtatPaiementCandidat | null>(null);
  const [blocage, setBlocage] = useState<Blocage | null>(null);
  const [erreurVerification, setErreurVerification] = useState<string | null>(null);
  const monteRef = useRef(true);

  useEffect(() => {
    monteRef.current = true;
    return () => {
      monteRef.current = false;
    };
  }, []);

  /**
   * Vérification auprès du service : SEUL `REUSSI` autorise l’affichage du
   * succès. Aucune confiance dans les paramètres de navigation.
   */
  const verifierConfirmation = useCallback(async () => {
    setEtat('verification');
    setBlocage(null);
    setErreurVerification(null);

    if (!referenceInterne) {
      setPaiement(null);
      setBlocage({
        variante: 'pending',
        titre: 'Paiement non confirmé',
        message:
          'Aucun paiement confirmé n’est associé à cette page. Consultez le suivi de votre demande pour connaître l’état exact de votre dossier.',
      });
      setEtat('non_confirme');
      return;
    }

    const reponse = await candidateApi.obtenirEtatPaiement(referenceInterne);

    if (!monteRef.current) return;

    if (!reponse.ok) {
      setErreurVerification(traduireErreur(reponse.erreur));
      setEtat('erreur');
      return;
    }

    const valeur = reponse.valeur;
    setPaiement(valeur);

    if (valeur.statut === 'REUSSI') {
      setEtat('confirme');
      return;
    }

    if (STATUTS_EN_ATTENTE.includes(valeur.statut)) {
      setBlocage({
        variante: 'pending',
        titre: 'Confirmation encore attendue',
        message:
          valeur.instruction ??
          'Votre paiement n’est pas encore confirmé par le serveur OMDA. Consultez le suivi de votre demande pour vérifier son avancement.',
      });
      setEtat('non_confirme');
      return;
    }

    setBlocage({
      variante: 'error',
      titre: 'Paiement non abouti',
      message: valeur.motif_echec
        ? `${valeur.motif_echec} Aucun succès ne peut donc être affiché.`
        : 'Le paiement n’a pas abouti : aucun succès ne peut être affiché. Vous pouvez relancer le paiement depuis le suivi de votre demande.',
    });
    setEtat('non_confirme');
  }, [referenceInterne]);

  useEffect(() => {
    void verifierConfirmation();
  }, [verifierConfirmation]);

  const retourSuivi = useCallback(() => {
    router.push({
      pathname: '/(candidat)/suivi',
      params: { numero_dossier: numeroDossier, code_suivi: codeSuivi },
    });
  }, [codeSuivi, numeroDossier]);

  const allerAccueil = useCallback(() => {
    router.push('/(public)/accueil');
  }, []);


  /* --------------------------------------------------------------- Rendu */

  return (
    <ScreenContainer titre="Adhésion confirmée" afficherRetour={false}>
      {etat === 'verification' ? (
        <LoadingState message="Vérification de votre paiement auprès du serveur…" />
      ) : null}

      {etat === 'erreur' ? (
        <View className="gap-4">
          <ErrorState
            titre="Vérification impossible"
            message={erreurVerification ?? 'Impossible de vérifier votre paiement pour le moment.'}
            libelleAction="Réessayer"
            onReessayer={() => void verifierConfirmation()}
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

      {etat === 'non_confirme' && blocage ? (
        <View className="gap-4">
          <InfoBanner variante={blocage.variante} titre={blocage.titre} message={blocage.message} />

          <InfoBanner
            variante="info"
            titre="Règle de confirmation"
            message="L’application n’affiche un succès d’adhésion qu’après confirmation du paiement par le serveur OMDA (opérateur Mobile Money ou vérification d’un agent)."
          />

          {paiement ? (
            <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
              <Text className="text-sm text-omda-textGray">
                {`Référence du paiement : ${paiement.reference_interne}`}
              </Text>
              <Text className="mt-1 text-sm text-omda-textGray">
                {`Montant : ${formaterMontantAriary(paiement.montant)}`}
              </Text>
            </View>
          ) : null}

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
            onPress={allerAccueil}
          />
        </View>
      ) : null}

      {/* Succès : affiché uniquement après confirmation serveur `REUSSI` */}
      {etat === 'confirme' && paiement ? (
        <View className="gap-5">
          <View className="items-center rounded-2xl border border-status-success bg-omda-white p-6">
            <Icone
              nom="circle-check"
              taille={48}
              classeCouleur="text-status-success"
              libelleAccessibilite="Paiement confirmé par le serveur"
            />

            <Text className="mt-4 text-center text-2xl font-bold text-omda-black">
              Paiement confirmé.
            </Text>

            <View className="mt-3">
              <StatusPill statut="success" libelle="Paiement confirmé par le serveur" />
            </View>

            {paiement.date_confirmation ? (
              <Text className="mt-4 text-center text-sm text-omda-textGray">
                {`Confirmation reçue le ${formaterDateHeure(paiement.date_confirmation)}.`}
              </Text>
            ) : null}

            {numeroDossier ? (
              <Text className="mt-2 text-center text-sm text-omda-textGray">
                {`Dossier : ${numeroDossier}`}
              </Text>
            ) : null}
          </View>

          <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            <Text className="text-base font-bold text-omda-black">Récapitulatif du règlement</Text>
            <Text className="mt-3 text-base text-omda-black">
              {`Montant réglé : ${formaterMontantAriary(paiement.montant)}`}
            </Text>
            <Text className="mt-1 text-sm text-omda-textGray">
              {`Référence interne : ${paiement.reference_interne}`}
            </Text>
            {paiement.reference_externe ? (
              <Text className="mt-1 text-sm text-omda-textGray">
                {`Référence opérateur : ${paiement.reference_externe}`}
              </Text>
            ) : null}
          </View>

          <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            <Text className="text-base font-bold text-omda-black">Votre adhésion</Text>

            {numeroAdherent ? (
              <View className="mt-3">
                <Text className="text-sm text-omda-textGray">Numéro d’adhérent</Text>
                <Text selectable className="text-xl font-bold text-omda-black">
                  {numeroAdherent}
                </Text>
              </View>
            ) : (
              <Text className="mt-3 text-base text-omda-black">
                Votre numéro d’adhérent vous sera communiqué par e-mail avec vos identifiants de
                connexion.
              </Text>
            )}

            <Text className="mt-3 text-base text-omda-black">Vos identifiants ont été envoyés.</Text>
            <Text className="mt-1 text-sm text-omda-textGray">
              Consultez la boîte e-mail indiquée dans votre dossier d’adhésion (pensez à vérifier les
              courriers indésirables).
            </Text>
          </View>

          <InfoBanner
            variante="info"
            titre="Connexion manuelle"
            message="Vous n’êtes pas connecté automatiquement. Utilisez le bouton « Se connecter » avec les identifiants reçus par e-mail."
          />

          <Button
            libelle="Se connecter"
            icone="right-to-bracket"
            pleineLargeur
            onPress={() => router.push('/(public)/connexion')}
          />

          <Button
            libelle="Retour à l’accueil"
            variante="secondary"
            pleineLargeur
            onPress={allerAccueil}
          />
        </View>
      ) : null}
    </ScreenContainer>
  );
}

