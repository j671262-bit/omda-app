import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from './AppHeader';

type PropsScreenContainer = {
  children: ReactNode;
  /** Si fourni, un en-tête (avec bouton retour) est affiché. */
  titre?: string;
  sousTitre?: string;
  onRetour?: () => void;
  afficherRetour?: boolean;
  /** `true` (défaut) : contenu défilable. `false` pour un écran plein (états, formulaires courts). */
  defilable?: boolean;
};

/**
 * Conteneur d'écran : fond de page `omda-warmGray`, marges constantes et
 * en-tête optionnel. À utiliser par tous les écrans pour garantir un rendu
 * homogène (contraste, marges, zones sûres).
 */
export function ScreenContainer({
  children,
  titre,
  sousTitre,
  onRetour,
  afficherRetour = true,
  defilable = true,
}: PropsScreenContainer) {
  return (
    <SafeAreaView className="flex-1 bg-omda-warmGray">
      {titre ? (
        <AppHeader titre={titre} sousTitre={sousTitre} onRetour={onRetour} afficherRetour={afficherRetour} />
      ) : null}

      {defilable ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow px-5 pb-10 pt-4"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1 px-5 pb-10 pt-4">{children}</View>
      )}
    </SafeAreaView>
  );
}
