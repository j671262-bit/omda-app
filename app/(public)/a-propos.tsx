import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, InfoBanner, ScreenContainer } from '../../src/components/ui';

/** Section de présentation : titre + paragraphe(s) statiques. */
function SectionPresentation({ titre, paragraphes }: { titre: string; paragraphes: string[] }) {
  return (
    <View className="mt-6">
      <Text className="text-lg font-bold text-omda-black">{titre}</Text>
      {paragraphes.map((paragraphe) => (
        <Text key={paragraphe} className="mt-2 text-base leading-7 text-omda-black">
          {paragraphe}
        </Text>
      ))}
    </View>
  );
}

/**
 * À propos (écran B du cahier des charges) : présentation institutionnelle.
 *
 * Écran statique : il ne contient AUCUNE donnée métier (ni montant, ni
 * catégorie, ni opérateur, ni tarif) — ces informations viennent toujours des
 * services et sont affichées sur les écrans concernés.
 */
export default function AProposScreen() {
  return (
    <ScreenContainer titre="À propos">
      <Text className="text-base leading-7 text-omda-black">
        L’OMDA accompagne les auteurs : elle enregistre les œuvres, suit les démarches d’adhésion
        et facilite la relation entre les auteurs et l’organisation. Cette application mobile est
        l’accès le plus simple à ces services, y compris depuis un téléphone modeste et une
        connexion instable.
      </Text>

      <SectionPresentation
        titre="Nos missions"
        paragraphes={[
          'Accompagner les auteurs dans leurs démarches d’adhésion et de dépôt d’œuvre.',
          'Informer sur les pièces à fournir, les délais indicatifs de traitement et l’avancement de chaque dossier.',
        ]}
      />

      <SectionPresentation
        titre="Votre espace personnel"
        paragraphes={[
          'Une fois votre adhésion finalisée, vous accédez à votre espace membre : vos œuvres et leurs statuts, votre profil et vos notifications.',
          'Le suivi de votre demande d’adhésion reste possible à tout moment grâce à votre numéro de dossier et votre code de suivi.',
        ]}
      />

      <SectionPresentation
        titre="Une information fiable"
        paragraphes={[
          'Les frais et les moyens de paiement sont toujours communiqués par l’OMDA : l’application ne calcule ni montant ni tarif, elle affiche les valeurs reçues du service.',
          'Un paiement n’est annoncé comme réussi qu’après confirmation de l’OMDA. Un dossier validé ne fait pas encore de vous un membre : l’adhésion est finalisée au moment du paiement confirmé.',
        ]}
      />

      <View className="mt-6">
        <InfoBanner
          variante="info"
          titre="Démarches d’adhésion"
          message="Trois étapes : identité, catégorie, puis documents et œuvres. Le délai indicatif de traitement est de 72 heures. Aucun paiement n’est demandé lors de l’envoi de votre dossier."
        />
      </View>

      <View className="mt-8 gap-3">
        <Button
          libelle="Devenir membre"
          pleineLargeur
          onPress={() => router.push('/(adhesion)/identite')}
        />
        <Button
          libelle="Consulter la documentation"
          variante="secondary"
          pleineLargeur
          onPress={() => router.push('/(public)/documentation')}
        />
      </View>
    </ScreenContainer>
  );
}

