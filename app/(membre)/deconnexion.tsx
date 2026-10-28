import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorState, Icone, InfoBanner, ScreenContainer } from '../../src/components/ui';
import { useAuth } from '../../src/context/AuthContext';
import type { ErreurApp } from '../../src/services/contracts';

type EtatEcran = 'confirmation' | 'erreur';

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'La déconnexion est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/**
 * Déconnexion (règle métier W du cahier des charges).
 *
 * Écran dédié HORS onglets : la TabBar de l'espace membre reste celle prévue par
 * le cahier des charges (Accueil, Œuvres, Profil, Notifications) ;
 * la déconnexion est atteinte depuis l'onglet Profil.
 *
 * Parcours :
 * 1. confirmation explicite demandée à l'utilisateur (aucun `Alert` natif) ;
 * 2. `deconnecter()` avec état de chargement sur le bouton ;
 * 3. échec ⇒ `ErrorState` + « Réessayer » (la session reste active) ;
 * 4. succès ⇒ retour à l’accueil PUBLIC, sans menu.
 */
export default function DeconnexionScreen() {
  const { deconnecter } = useAuth();
  const [etat, setEtat] = useState<EtatEcran>('confirmation');
  const [enCours, setEnCours] = useState(false);
  const [messageErreur, setMessageErreur] = useState('');

  const confirmerDeconnexion = useCallback(async () => {
    setEnCours(true);
    setMessageErreur('');

    const resultat = await deconnecter();

    setEnCours(false);

    if (!resultat.ok) {
      setMessageErreur(traduireErreur(resultat.erreur));
      setEtat('erreur');
      return;
    }

    // Retour à l'accueil public, sans menu. Le garde de `(membre)` redirige lui
    // aussi vers cet écran dès que la session est fermée (aucune boucle possible).
    router.replace('/(public)/accueil');
  }, [deconnecter]);

  const annuler = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/(tabs)/profil');
  }, []);

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Déconnexion">
        <ErrorState
          titre="Déconnexion impossible"
          message={messageErreur}
          onReessayer={() => {
            setEtat('confirmation');
            void confirmerDeconnexion();
          }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Déconnexion" sousTitre="Fin de la session en cours">
      <InfoBanner
        variante="info"
        titre="Vous allez quitter votre espace membre"
        message="Votre session sera fermée. Vous pourrez vous reconnecter à tout moment avec votre adresse e-mail et votre mot de passe."
        icone="right-from-bracket"
      />

      <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <View className="flex-row items-center">
          <Icone nom="house" taille={18} classeCouleur="text-omda-textGray" />
          <Text className="ml-3 flex-1 text-sm text-omda-textGray">
            Vous serez redirigé vers l’accueil public de l’OMDA.
          </Text>
        </View>

        <Text className="mt-4 text-lg font-bold text-omda-black">
          Confirmez-vous votre déconnexion ?
        </Text>
        <Text className="mt-1 text-base text-omda-textGray">
          Vos informations et vos œuvres restent enregistrées : vous les retrouverez à votre
          prochaine connexion.
        </Text>

        <View className="mt-5 gap-3">
          <Button
            libelle="Oui, me déconnecter"
            variante="destructive"
            icone="right-from-bracket"
            pleineLargeur
            chargement={enCours}
            onPress={() => void confirmerDeconnexion()}
          />
          <Button
            libelle="Annuler"
            variante="secondary"
            pleineLargeur
            desactive={enCours}
            onPress={annuler}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}
