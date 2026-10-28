import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import type { ComponentProps } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type NomIcone = ComponentProps<typeof FontAwesome6>['name'];

type LigneVerification = {
  icone: NomIcone;
  classeCouleur: string;
  libelle: string;
};

/**
 * Écran de DÉVELOPPEMENT (route `/dev/installation`) : ancien écran de
 * vérification de l'étape 1, conservé pour référence technique (preuve du bon
 * fonctionnement de NativeWind et de FontAwesome).
 *
 * ⚠️ Ce n'est PAS un écran du parcours utilisateur : l'application démarre
 * désormais sur l'accueil public (`app/(public)/accueil.tsx`), et la route `/`
 * redirige vers celui-ci.
 */
const VERIFICATIONS: LigneVerification[] = [
  {
    icone: 'circle-check',
    classeCouleur: 'text-status-success',
    libelle: 'NativeWind actif : les styles utilitaires sont appliqués.',
  },
  {
    icone: 'circle-info',
    classeCouleur: 'text-status-info',
    libelle: 'FontAwesome actif : les icônes sont affichées.',
  },
  {
    icone: 'clock',
    classeCouleur: 'text-status-pending',
    libelle: 'Palette OMDA déclarée en tokens (omda-* et status-*).',
  },
];

export default function InstallationDeveloppement() {
  return (
    <SafeAreaView className="flex-1 bg-omda-warmGray">
      <ScrollView contentContainerClassName="flex-grow items-center justify-center px-6 py-10">
        <Text className="text-4xl font-bold text-omda-green">OMDA</Text>
        <Text className="mt-2 text-center text-base text-omda-textGray">
          Application mobile — relations avec les auteurs
        </Text>

        <View className="mt-8 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <Text className="text-lg font-semibold text-omda-black">
            Vérification de l’installation (étape 1)
          </Text>

          {VERIFICATIONS.map((verification) => (
            <View key={verification.libelle} className="mt-4 flex-row items-start">
              <Text className={verification.classeCouleur}>
                <FontAwesome6 name={verification.icone} size={20} />
              </Text>
              <Text className="ml-3 flex-1 text-base leading-6 text-omda-black">
                {verification.libelle}
              </Text>
            </View>
          ))}
        </View>

        <Text className="mt-6 text-center text-sm text-omda-textGray">
          Écran conservé pour référence : l’application démarre sur l’accueil public.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
