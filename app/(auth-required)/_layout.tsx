import { Redirect, Stack } from 'expo-router';

import { LoadingState } from '../../src/components/ui';
import { useAuth } from '../../src/context/AuthContext';

/**
 * Layout du groupe `(auth-required)`.
 *
 * Garde de navigation :
 * - non connecté => redirection vers `/(public)/connexion`
 * - connecté ET mot de passe déjà changé (`doit_changer_mot_de_passe = false`) => `/(membre)/(tabs)/accueil`
 * - connecté ET `doit_changer_mot_de_passe = true` => autorise l'écran bloquant de changement de mot de passe.
 */
export default function AuthRequiredLayout() {
  const { estCharge, estConnecte, doitChangerMotDePasse } = useAuth();

  if (!estCharge) {
    return <LoadingState message="Vérification de votre compte…" />;
  }

  if (!estConnecte) {
    return <Redirect href="/(public)/connexion" />;
  }

  if (!doitChangerMotDePasse) {
    return <Redirect href="/(membre)/(tabs)/accueil" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

