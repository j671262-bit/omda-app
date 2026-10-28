import { Text, View } from 'react-native';

import { Button, type VarianteBouton } from './Button';
import { Icone } from './Icone';

type PropsErrorState = {
  /** Message d'erreur compréhensible (réseau, serveur, etc.). */
  message: string;
  titre?: string;
  onReessayer: () => void;
  libelleAction?: string;
  /**
   * Variante du bouton de reprise : `secondary` par défaut, afin de ne pas
   * afficher de vert (couleur de succès) à proximité d'une action de paiement.
   */
  varianteAction?: VarianteBouton;
};

/**
 * État d'erreur standard : message + bouton « Réessayer » (obligatoire).
 * Zone tactile de 48 px minimum, icône `circle-xmark` en `status-error`.
 */
export function ErrorState({
  message,
  titre = 'Une erreur est survenue',
  onReessayer,
  libelleAction = 'Réessayer',
  varianteAction = 'secondary',
}: PropsErrorState) {
  return (
    <View className="w-full items-center justify-center bg-omda-warmGray px-6 py-10">
      <Icone nom="circle-xmark" taille={36} classeCouleur="text-status-error" />

      <Text className="mt-4 text-center text-lg font-semibold text-omda-black">{titre}</Text>
      <Text className="mt-2 text-center text-base text-omda-black">{message}</Text>

      <View className="mt-5">
        <Button libelle={libelleAction} variante={varianteAction} onPress={onReessayer} />
      </View>
    </View>
  );
}
