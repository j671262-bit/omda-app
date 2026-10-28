import { Redirect, Stack } from 'expo-router';

import { LoadingState } from '../../src/components/ui';
import { useAuth } from '../../src/context/AuthContext';

/**
 * Espace membre : Stack interne contenant les onglets `(tabs)`
 * (Accueil, Œuvres, Profil, Notifications) et les écrans
 * hors onglets `depot-oeuvre`, `modifier-oeuvre`, `fiche-oeuvre`, `paiement-membre`,
 * `demander-categorie`, `demander-categorie-oeuvres` et `deconnexion`.
 * C'est le SEUL espace de l'application à afficher une TabBar.
 *
 * Garde de navigation :
 * - non connecté => retour à l'accueil PUBLIC `/(public)/accueil` (sans menu) :
 *   cela couvre l'accès direct sans session ET la fin de session demandée depuis
 *   l'écran `deconnexion` (règle métier W : retour à l'accueil public).
 * - connecté avec `doit_changer_mot_de_passe = true` => redirection bloquante vers `/(auth-required)/changer-mot-de-passe`
 * - connecté avec mot de passe valide => autorise l'accès à l'espace membre.
 */
export default function MembreLayout() {
  const { estCharge, estConnecte, doitChangerMotDePasse } = useAuth();

  if (!estCharge) {
    return <LoadingState message="Chargement de votre espace membre…" />;
  }

  if (!estConnecte) {
    return <Redirect href="/(public)/accueil" />;
  }

  if (doitChangerMotDePasse) {
    return <Redirect href="/(auth-required)/changer-mot-de-passe" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

