import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StatusPill,
  formaterMontantAriary,
  type NomIcone,
  type StatutPill,
} from '../../../src/components/ui';
import type { StatutUtilisateur } from '../../../src/models';
import type { ErreurApp, TableauDeBordMembre } from '../../../src/services/contracts';
import { memberRepository } from '../../../src/services/factory';

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/**
 * Statuts de compte affichables (cahier des charges §6).
 * `success` (vert) n'est utilisé que pour un état confirmé par le serveur.
 */
const STATUTS_COMPTE: Record<StatutUtilisateur, { variante: StatutPill; libelle: string }> = {
  ACTIF: { variante: 'success', libelle: 'Compte actif' },
  DESACTIVE: { variante: 'error', libelle: 'Compte désactivé' },
  EN_ATTENTE_CHANGEMENT_MDP: { variante: 'pending', libelle: 'Mot de passe à renouveler' },
};

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Votre espace membre est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Aucune donnée à montrer : ni œuvre, ni notification non lue. */
function estVide(tableauDeBord: TableauDeBordMembre): boolean {
  return (
    tableauDeBord.nombre_oeuvres === 0 &&
    tableauDeBord.notifications_non_lues === 0
  );
}

type PropsEnteteMembre = {
  tableauDeBord: TableauDeBordMembre;
};

/** En-tête de l'accueil : salutation, numéro d'adhérent et statut du compte. */
function EnteteMembre({ tableauDeBord }: PropsEnteteMembre) {
  const statut = STATUTS_COMPTE[tableauDeBord.statut_compte];

  return (
    <View className="w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
      <Text className="text-2xl font-bold text-omda-black">
        {`Bonjour ${tableauDeBord.prenom}`}
      </Text>
      <Text className="mt-1 text-base text-omda-textGray">
        Voici l’état de votre espace membre OMDA.
      </Text>

      <View className="mt-4 flex-row items-center">
        <Icone nom="id-card" taille={16} classeCouleur="text-omda-textGray" />
        <Text className="ml-2 text-base text-omda-black">
          {`Numéro d’adhérent : ${tableauDeBord.numero_adherent}`}
        </Text>
      </View>

      <View className="mt-3">
        <StatusPill statut={statut.variante} libelle={statut.libelle} />
      </View>
    </View>
  );
}

type PropsCarteCompteur = {
  icone: NomIcone;
  /** Libellé de la carte, fourni par l'écran (jamais une donnée codée en dur). */
  libelle: string;
  /** Valeur principale affichée (compteur ou montant renvoyé par le service). */
  valeur: string;
  detail?: string;
  statut?: { variante: StatutPill; libelle: string };
  actionLibelle: string;
  onAction: () => void;
};

/** Carte de compteur de l'accueil (compteur + statut + action de navigation). */
function CarteCompteur({
  icone,
  libelle,
  valeur,
  detail,
  statut,
  actionLibelle,
  onAction,
}: PropsCarteCompteur) {
  return (
    <View className="w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
      <View className="flex-row items-center">
        <Icone nom={icone} taille={18} classeCouleur="text-omda-textGray" />
        <Text className="ml-2 flex-1 text-base text-omda-textGray">{libelle}</Text>
      </View>

      <Text className="mt-2 text-2xl font-bold text-omda-black">{valeur}</Text>
      {detail ? <Text className="mt-1 text-sm text-omda-textGray">{detail}</Text> : null}

      {statut ? (
        <View className="mt-3">
          <StatusPill statut={statut.variante} libelle={statut.libelle} />
        </View>
      ) : null}

      <View className="mt-4">
        <Button libelle={actionLibelle} variante="secondary" onPress={onAction} />
      </View>
    </View>
  );
}

/**
 * Accueil membre (écran P du cahier des charges).
 *
 * Données : `memberRepository.obtenirTableauDeBord()` — aucun compteur, aucun
 * montant n'est codé en dur. Le tableau de bord est rechargé à chaque affichage
 * de l'onglet (les compteurs restent justes après une action ailleurs).
 *
 * Les 4 états obligatoires sont gérés : `LoadingState`, `ErrorState` + « Réessayer »,
 * `EmptyState` (aucune activité) et contenu normal.
 */
export default function AccueilMembreScreen() {
  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [tableauDeBord, setTableauDeBord] = useState<TableauDeBordMembre | null>(null);
  const [messageErreur, setMessageErreur] = useState('');

  const chargerTableauDeBord = useCallback(async (options?: { silencieux?: boolean }) => {
    if (!options?.silencieux) {
      setEtat('chargement');
    }
    setMessageErreur('');

    const resultat = await memberRepository.obtenirTableauDeBord();

    if (!resultat.ok) {
      setMessageErreur(traduireErreur(resultat.erreur));
      setEtat('erreur');
      return;
    }

    setTableauDeBord(resultat.valeur);
    setEtat(estVide(resultat.valeur) ? 'vide' : 'contenu');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void chargerTableauDeBord({ silencieux: true });
    }, [chargerTableauDeBord]),
  );

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Accueil" afficherRetour={false}>
        <LoadingState message="Chargement de votre espace membre…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Accueil" afficherRetour={false}>
        <ErrorState
          titre="Espace membre indisponible"
          message={messageErreur}
          onReessayer={() => void chargerTableauDeBord()}
        />
      </ScreenContainer>
    );
  }

  if (!tableauDeBord) {
    return (
      <ScreenContainer titre="Accueil" afficherRetour={false}>
        <EmptyState
          titre="Aucune donnée à afficher"
          message="Vos informations n’ont pas pu être récupérées. Veuillez réessayer."
          icone="circle-info"
          actionLibelle="Réessayer"
          onAction={() => void chargerTableauDeBord()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Accueil" afficherRetour={false}>
      <EnteteMembre tableauDeBord={tableauDeBord} />

      {etat === 'vide' ? (
        <View className="mt-5">
          <EmptyState
            titre="Aucune activité pour le moment"
            message="Vos œuvres et vos notifications apparaîtront ici dès que l’OMDA les aura enregistrées."
            icone="folder-open"
            actionLibelle="Actualiser"
            onAction={() => void chargerTableauDeBord()}
          />
        </View>
      ) : (
        <View className="mt-5 gap-4">
          <CarteCompteur
            icone="folder-open"
            libelle="Œuvres déposées"
            valeur={`${tableauDeBord.nombre_oeuvres}`}
            detail={
              tableauDeBord.nombre_oeuvres > 1 ? 'œuvres enregistrées' : 'œuvre enregistrée'
            }
            actionLibelle="Voir mes œuvres"
            onAction={() => router.push('/(membre)/(tabs)/oeuvres')}
          />

          <CarteCompteur
            icone="bell"
            libelle="Notifications non lues"
            valeur={`${tableauDeBord.notifications_non_lues}`}
            detail={
              tableauDeBord.notifications_non_lues === 0
                ? 'Tout est à jour.'
                : tableauDeBord.notifications_non_lues > 1
                  ? 'notifications à consulter'
                  : 'notification à consulter'
            }
            statut={
              tableauDeBord.notifications_non_lues > 0
                ? { variante: 'pending', libelle: 'À consulter' }
                : { variante: 'info', libelle: 'Aucune non lue' }
            }
            actionLibelle="Voir mes notifications"
            onAction={() => router.push('/(membre)/(tabs)/notifications')}
          />

          <Button
            libelle="Actualiser"
            variante="secondary"
            icone="rotate-right"
            pleineLargeur
            onPress={() => void chargerTableauDeBord()}
          />
        </View>
      )}
    </ScreenContainer>
  );
}
