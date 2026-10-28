import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { estApiCandidatConfiguree } from '../../src/services/factory';
import {
  estSupabaseConfigure,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '../../src/services/supabase';

/**
 * Écran de DÉVELOPPEMENT (route `/dev/env`) — pré-flight de la configuration.
 *
 * Affiche la présence de la configuration Supabase et de l'API candidat, et les
 * services utilisés. La clé anon n'est JAMAIS rendue (seule sa présence est
 * affichée).
 *
 * ⚠️ Ce n'est PAS un écran du parcours utilisateur : aucun écran, layout ou
 * menu n'y fait lien (même convention que `/dev/catalogue` et
 * `/dev/installation`) — il ne se rejoint qu'en tapant la route.
 */

type LigneInformation = {
  libelle: string;
  valeur: string;
  classeValeur?: string;
};

type CarteInformation = {
  titre: string;
  lignes: LigneInformation[];
};

const CLASSE_DEFAUT = 'text-base font-semibold text-omda-black';
const CLASSE_REEL = 'text-base font-semibold text-status-info';
const CLASSE_ABSENTE = 'text-base font-semibold text-omda-textGray';

/** Valeur brute d'une variable, ou mention « (absente) » — jamais de secret ici. */
function valeurVariable(valeur: string | undefined): string {
  const brut = (valeur ?? '').trim();
  return brut.length > 0 ? brut : '(absente)';
}

const CARTES: CarteInformation[] = [
  {
    titre: 'Supabase',
    lignes: [
      {
        libelle: 'EXPO_PUBLIC_SUPABASE_URL',
        valeur: SUPABASE_URL.length > 0 ? SUPABASE_URL : '(absente)',
        classeValeur: SUPABASE_URL.length > 0 ? CLASSE_REEL : CLASSE_ABSENTE,
      },
      {
        libelle: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
        valeur: SUPABASE_ANON_KEY.length > 0 ? 'présente (valeur masquée)' : '(absente)',
        classeValeur: SUPABASE_ANON_KEY.length > 0 ? CLASSE_REEL : CLASSE_ABSENTE,
      },
      {
        libelle: 'Configuration complète (URL + clé)',
        valeur: estSupabaseConfigure() ? 'Oui' : 'Non',
        classeValeur: estSupabaseConfigure() ? CLASSE_REEL : CLASSE_ABSENTE,
      },
      {
        libelle: 'Sans configuration',
        valeur: 'Refus serveur « Supabase n’est pas configuré… » — aucun crash',
      },
    ],
  },
  {
    titre: 'API candidat (Express)',
    lignes: [
      {
        libelle: 'EXPO_PUBLIC_API_BASE_URL',
        valeur: valeurVariable(process.env.EXPO_PUBLIC_API_BASE_URL),
        classeValeur: estApiCandidatConfiguree() ? CLASSE_REEL : CLASSE_ABSENTE,
      },
      {
        libelle: 'API candidat configurée',
        valeur: estApiCandidatConfiguree()
          ? 'Oui'
          : 'Non — chaque appel du parcours candidat renvoie un refus serveur explicite',
        classeValeur: estApiCandidatConfiguree() ? CLASSE_REEL : CLASSE_ABSENTE,
      },
    ],
  },
  {
    titre: 'Services utilisés (aucun mock)',
    lignes: [
      { libelle: 'authService', valeur: 'SupabaseAuthService', classeValeur: CLASSE_DEFAUT },
      {
        libelle: 'memberRepository',
        valeur: 'SupabaseMemberRepository',
        classeValeur: CLASSE_DEFAUT,
      },
      {
        libelle: 'publicContentService',
        valeur: 'SupabasePublicContentService',
        classeValeur: CLASSE_DEFAUT,
      },
      { libelle: 'candidateApi', valeur: 'HttpCandidateApi', classeValeur: CLASSE_DEFAUT },
    ],
  },
];

export default function ConfigurationDeveloppement() {
  return (
    <SafeAreaView className="flex-1 bg-omda-warmGray">
      <ScrollView contentContainerClassName="px-6 py-10">
        <Text className="text-2xl font-bold text-omda-green">Configuration</Text>
        <Text className="mt-1 text-sm leading-5 text-omda-textGray">
          Écran de développement (route /dev/env) — aucun lien depuis le parcours normal. La clé
          anon Supabase n’est jamais affichée.
        </Text>

        {CARTES.map((carte) => (
          <View
            key={carte.titre}
            className="mt-5 rounded-2xl border border-omda-borderGray bg-omda-white p-5"
          >
            <Text className="text-lg font-semibold text-omda-black">{carte.titre}</Text>
            {carte.lignes.map((ligne) => (
              <View key={ligne.libelle} className="mt-3">
                <Text className="text-sm text-omda-textGray">{ligne.libelle}</Text>
                <Text className={ligne.classeValeur ?? CLASSE_DEFAUT}>{ligne.valeur}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text className="mt-6 text-center text-xs leading-5 text-omda-textGray">
          Sans configuration, chaque appel de service renvoie un refus serveur explicite —
          l’application ne plante jamais pour une variable d’environnement manquante.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
