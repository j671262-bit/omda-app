import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, InfoBanner, ScreenContainer } from '../../src/components/ui';
import { useAdhesionDraft } from '../../src/context/AdhesionDraftContext';

/**
 * Écran de blocage âge (écran de refus bloquant, règle métier 7).
 *
 * Déclenché lorsque la date de naissance indique un âge < 15 ans.
 * - Message clair : adhésion légale réservée aux personnes d'au moins 15 ans.
 * - Bouton primaire : retour à l'accueil public.
 * - Bouton secondaire : retour à l'étape identité pour corriger une erreur de saisie.
 */
export default function RefusAgeScreen() {
  const { age } = useAdhesionDraft();

  return (
    <ScreenContainer
      titre="Demande non possible"
      sousTitre="Condition d’âge légal"
      afficherRetour={false}
    >
      <View className="mt-2">
        <InfoBanner
          variante="error"
          titre="Âge minimal requis : 15 ans"
          message={
            age !== null
              ? `L’âge calculé à partir de la date saisie est de ${age} an${age > 1 ? 's' : ''}. Conformément aux statuts de l’OMDA et à la législation en vigueur, une demande d’adhésion ne peut être enregistrée qu’à partir de 15 ans révolus.`
              : 'Conformément aux statuts de l’OMDA et à la législation en vigueur, une demande d’adhésion ne peut être enregistrée qu’à partir de 15 ans révolus.'
          }
        />
      </View>

      <View className="mt-6 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-lg font-bold text-omda-black">Que pouvez-vous faire ?</Text>
        <Text className="mt-2 text-base leading-6 text-omda-textGray">
          • Si vous avez commis une erreur lors de la saisie de votre date de naissance, vous pouvez la corriger en revenant au formulaire.
        </Text>
        <Text className="mt-2 text-base leading-6 text-omda-textGray">
          • Si vous avez moins de 15 ans, nous vous invitons à renouveler votre démarche dès votre 15e anniversaire.
        </Text>
      </View>

      <View className="mt-8 gap-3">
        <Button
          libelle="Retour à l’accueil"
          pleineLargeur
          onPress={() => router.replace('/(public)/accueil')}
        />
        <Button
          libelle="Corriger ma date de naissance"
          variante="secondary"
          pleineLargeur
          onPress={() => router.replace('/(adhesion)/identite')}
        />
      </View>
    </ScreenContainer>
  );
}

