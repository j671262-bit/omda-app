import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icone } from './Icone';

type PropsAppHeader = {
  titre: string;
  sousTitre?: string;
  /** Action de retour personnalisée ; par défaut, revient à l'écran précédent. */
  onRetour?: () => void;
  afficherRetour?: boolean;
};

/**
 * En-tête d'écran avec bouton retour (navigation linéaire : pas de menu côté
 * public/candidat). La zone tactile du retour fait 48 × 48 px minimum.
 */
export function AppHeader({ titre, sousTitre, onRetour, afficherRetour = true }: PropsAppHeader) {
  const router = useRouter();

  const retourner = () => {
    if (onRetour) {
      onRetour();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View className="flex-row items-center bg-omda-warmGray px-2 py-2">
      {afficherRetour ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={retourner}
          className="h-12 w-12 items-center justify-center rounded-full"
        >
          {({ pressed }) => (
            <Icone
              nom="arrow-left"
              taille={20}
              classeCouleur={pressed ? 'text-omda-textGray' : 'text-omda-black'}
            />
          )}
        </Pressable>
      ) : null}

      <View className="flex-1 pl-1">
        <Text className="text-lg font-bold text-omda-black" numberOfLines={1}>
          {titre}
        </Text>
        {sousTitre ? (
          <Text className="text-sm text-omda-textGray" numberOfLines={1}>
            {sousTitre}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
