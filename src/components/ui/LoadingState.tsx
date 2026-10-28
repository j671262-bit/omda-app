import { ActivityIndicator, Text, View } from 'react-native';

import { colors } from '../../theme/colors';

type PropsLoadingState = {
  message?: string;
};

/**
 * État de chargement standard des écrans data-driven.
 * Le vert utilisé est la couleur de MARQUE (`omda-green`) : ce n'est pas une
 * confirmation de succès (réservée à `status-success`).
 */
export function LoadingState({ message = 'Chargement en cours…' }: PropsLoadingState) {
  return (
    <View
      className="flex-1 items-center justify-center bg-omda-warmGray px-6 py-10"
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <ActivityIndicator color={colors.omda.green} size="large" />
      <Text className="mt-4 text-center text-base text-omda-black">{message}</Text>
    </View>
  );
}
