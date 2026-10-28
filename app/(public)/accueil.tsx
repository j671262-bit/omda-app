import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Button, Icone, ScreenContainer } from '../../src/components/ui';

/**
 * Accueil public (écran B du cahier des charges).
 *
 * Sans aucun menu (ni TabBar, ni Drawer, ni hamburger).
 * Propose 3 actions verticales prioritaires et 3 liens d'information :
 * 1. « Devenir membre » (primaire) → parcours d'adhésion
 * 2. « Suivre ma demande » (secondaire) → suivi candidat
 * 3. « Se connecter » (secondaire) → espace membre
 *
 * Liens : Documentation, Tarifs (simulateur), À propos.
 */
export default function AccueilPublicScreen() {
  return (
    <ScreenContainer
      titre="OMDA"
      sousTitre="Office Malgache du Droit d’Auteur"
      afficherRetour={false}
    >
      <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-xl font-bold text-omda-black">Bienvenue à l’OMDA</Text>
        <Text className="mt-2 text-base leading-6 text-omda-textGray">
          L’application mobile dédiée aux auteurs : déposez votre demande d’adhésion, suivez votre
          dossier et accédez à vos informations officielles.
        </Text>
      </View>

      {/* 3 boutons verticaux obligatoires */}
      <View className="mt-6 gap-3">
        <Button
          libelle="Devenir membre"
          variante="primary"
          icone="folder-open"
          pleineLargeur
          onPress={() => router.push('/(adhesion)/identite')}
        />
        <Button
          libelle="Suivre ma demande"
          variante="secondary"
          icone="magnifying-glass"
          pleineLargeur
          onPress={() => router.push('/(candidat)/suivi')}
        />
        <Button
          libelle="Se connecter"
          variante="secondary"
          icone="circle-info"
          pleineLargeur
          onPress={() => router.push('/(public)/connexion')}
        />
      </View>

      {/* Liens d'information (Documentation, Tarifs, À propos) */}
      <View className="mt-8">
        <Text className="mb-2 text-sm font-semibold uppercase tracking-wider text-omda-textGray">
          Informations pratiques
        </Text>

        <View className="overflow-hidden rounded-2xl border border-omda-borderGray bg-omda-white">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Consulter la documentation"
            onPress={() => router.push('/(public)/documentation')}
            className="border-b border-omda-borderGray"
          >
            {({ pressed }) => (
              <View
                className={`min-h-12 flex-row items-center px-4 py-3.5 ${
                  pressed ? 'bg-omda-warmGray' : 'bg-omda-white'
                }`}
              >
                <Icone nom="file-lines" taille={18} classeCouleur="text-omda-textGray" />
                <View className="ml-3 flex-1">
                  <Text className="text-base font-semibold text-omda-black">Documentation</Text>
                  <Text className="text-sm text-omda-textGray">
                    Guides d’adhésion, pièces à fournir et démarches
                  </Text>
                </View>
                <Icone nom="chevron-right" taille={14} classeCouleur="text-omda-textGray" />
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Consulter les tarifs et le simulateur"
            onPress={() => router.push('/(public)/tarifs')}
            className="border-b border-omda-borderGray"
          >
            {({ pressed }) => (
              <View
                className={`min-h-12 flex-row items-center px-4 py-3.5 ${
                  pressed ? 'bg-omda-warmGray' : 'bg-omda-white'
                }`}
              >
                <Icone nom="money-bill-wave" taille={18} classeCouleur="text-omda-textGray" />
                <View className="ml-3 flex-1">
                  <Text className="text-base font-semibold text-omda-black">
                    Tarifs & simulateur
                  </Text>
                  <Text className="text-sm text-omda-textGray">
                    Estimations selon les catégories et opérations
                  </Text>
                </View>
                <Icone nom="chevron-right" taille={14} classeCouleur="text-omda-textGray" />
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="À propos de l’OMDA"
            onPress={() => router.push('/(public)/a-propos')}
          >
            {({ pressed }) => (
              <View
                className={`min-h-12 flex-row items-center px-4 py-3.5 ${
                  pressed ? 'bg-omda-warmGray' : 'bg-omda-white'
                }`}
              >
                <Icone nom="building-columns" taille={18} classeCouleur="text-omda-textGray" />
                <View className="ml-3 flex-1">
                  <Text className="text-base font-semibold text-omda-black">À propos</Text>
                  <Text className="text-sm text-omda-textGray">
                    Missions et engagements de l’Office
                  </Text>
                </View>
                <Icone nom="chevron-right" taille={14} classeCouleur="text-omda-textGray" />
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <Text className="mt-8 text-center text-xs text-omda-textGray">
        Délai indicatif de traitement des dossiers : 72 heures. Aucun paiement n’est demandé à
        l’envoi d’une demande.
      </Text>
    </ScreenContainer>
  );
}

