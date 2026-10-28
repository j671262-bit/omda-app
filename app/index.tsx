import { Redirect } from 'expo-router';

/**
 * Route d'entrée de l'application (`/`).
 *
 * L'application démarre sur l'ACCUEIL PUBLIC : aucun menu, navigation linéaire
 * (cahier des charges §8). L'ancien écran de vérification de l'étape 1 est
 * conservé en écran de développement : `/dev/installation`.
 */
export default function Index() {
  return <Redirect href="/(public)/accueil" />;
}

