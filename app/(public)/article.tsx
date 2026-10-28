import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, EmptyState, ErrorState, LoadingState, ScreenContainer } from '../../src/components/ui';
import type { Documentation } from '../../src/models';
import { publicContentService } from '../../src/services/factory';

type EtatChargement = 'chargement' | 'erreur' | 'introuvable' | 'contenu';

/**
 * Détail d'un article de documentation (écran C du cahier des charges).
 *
 * Sans menu (navigation linéaire avec bouton retour).
 * Lecture confortable, typographie lisible en plein soleil, défilement aéré.
 * Gère obligatoirement :
 * - `LoadingState`
 * - `ErrorState` + bouton « Réessayer »
 * - `EmptyState` (article inexistant ou slug non fourni)
 * - Contenu normal (titre, date de mise à jour, texte complet)
 */
export default function ArticleScreen() {
  const parametres = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof parametres.slug === 'string' ? parametres.slug : undefined;

  const [etat, setEtat] = useState<EtatChargement>('chargement');
  const [article, setArticle] = useState<Documentation | null>(null);
  const [messageErreur, setMessageErreur] = useState<string>('');

  const chargerArticle = useCallback(async () => {
    if (!slug) {
      setEtat('introuvable');
      return;
    }

    setEtat('chargement');
    setMessageErreur('');

    const resultat = await publicContentService.obtenirArticle(slug);

    if (!resultat.ok) {
      if (resultat.erreur.type === 'metier') {
        setEtat('introuvable');
        return;
      }
      const message =
        resultat.erreur.type === 'reseau'
          ? 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet et réessayez.'
          : 'Le service de documentation est momentanément indisponible. Veuillez réessayer.';
      setMessageErreur(message);
      setEtat('erreur');
      return;
    }

    setArticle(resultat.valeur);
    setEtat('contenu');
  }, [slug]);

  useEffect(() => {
    void chargerArticle();
  }, [chargerArticle]);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Documentation">
        <LoadingState message="Chargement de l’article…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Documentation">
        <ErrorState
          titre="Article indisponible"
          message={messageErreur}
          onReessayer={() => void chargerArticle()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'introuvable' || !article) {
    return (
      <ScreenContainer titre="Documentation">
        <EmptyState
          titre="Article introuvable"
          message="Le guide demandé n’existe pas ou a été retiré de la publication."
          icone="file-lines"
          actionLibelle="Retour à la documentation"
          onAction={() => router.replace('/(public)/documentation')}
        />
      </ScreenContainer>
    );
  }

  // Découpage du contenu en paragraphes pour un affichage lisible et aéré
  const paragraphes = article.contenu
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return (
    <ScreenContainer titre="Documentation" sousTitre="Guide officiel">
      <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-2xl font-bold text-omda-black">{article.titre}</Text>
        <Text className="mt-1 text-xs text-omda-textGray">
          {`Dernière mise à jour : ${new Date(article.updated_at).toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}`}
        </Text>

        <View className="mt-5 gap-3">
          {paragraphes.map((paragraphe, index) => (
            <Text
              key={`${index}-${paragraphe.slice(0, 10)}`}
              className="text-base leading-7 text-omda-black"
            >
              {paragraphe}
            </Text>
          ))}
        </View>
      </View>

      <View className="mt-6">
        <Button
          libelle="Retour à la liste des guides"
          variante="secondary"
          pleineLargeur
          onPress={() => router.back()}
        />
      </View>
    </ScreenContainer>
  );
}

