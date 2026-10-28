import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { EmptyState, ErrorState, Icone, LoadingState, ScreenContainer } from '../../src/components/ui';
import type { Documentation } from '../../src/models';
import { publicContentService } from '../../src/services/factory';

type EtatChargement = 'chargement' | 'erreur' | 'vide' | 'contenu';

/**
 * Documentation (écran C du cahier des charges).
 *
 * Sans menu (navigation linéaire).
 * Données issues de `publicContentService.listerDocumentation()` (aucun contenu codé en dur).
 * Gère obligatoirement les 4 états :
 * - `LoadingState`
 * - `ErrorState` + bouton « Réessayer »
 * - `EmptyState`
 * - Contenu normal (liste des articles publiés avec lien vers la lecture)
 */
export default function DocumentationScreen() {
  const [etat, setEtat] = useState<EtatChargement>('chargement');
  const [articles, setArticles] = useState<Documentation[]>([]);
  const [messageErreur, setMessageErreur] = useState<string>('');

  const chargerArticles = useCallback(async () => {
    setEtat('chargement');
    setMessageErreur('');

    const resultat = await publicContentService.listerDocumentation();

    if (!resultat.ok) {
      const message =
        resultat.erreur.type === 'reseau'
          ? 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet et réessayez.'
          : resultat.erreur.type === 'serveur'
            ? 'Le service de documentation est momentanément indisponible. Veuillez réessayer dans quelques instants.'
            : resultat.erreur.message;
      setMessageErreur(message);
      setEtat('erreur');
      return;
    }

    if (resultat.valeur.length === 0) {
      setArticles([]);
      setEtat('vide');
      return;
    }

    setArticles(resultat.valeur);
    setEtat('contenu');
  }, []);

  useEffect(() => {
    void chargerArticles();
  }, [chargerArticles]);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Documentation">
        <LoadingState message="Chargement des articles de documentation…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Documentation">
        <ErrorState
          titre="Documentation indisponible"
          message={messageErreur}
          onReessayer={() => void chargerArticles()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide') {
    return (
      <ScreenContainer titre="Documentation">
        <EmptyState
          titre="Aucun article disponible"
          message="Aucun guide n’est publié pour le moment. Veuillez revenir un peu plus tard."
          icone="file-lines"
          actionLibelle="Actualiser"
          onAction={() => void chargerArticles()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      titre="Documentation"
      sousTitre="Guides pratiques & démarches"
    >
      <Text className="text-base text-omda-textGray">
        Retrouvez ci-dessous les informations officielles sur les adhésions, les pièces
        justificatives et le fonctionnement de l’OMDA.
      </Text>

      <View className="mt-5 gap-3">
        {articles.map((article) => {
          const extrait =
            article.contenu.length > 120
              ? `${article.contenu.slice(0, 120).trim()}…`
              : article.contenu;

          return (
            <Pressable
              key={article.id}
              accessibilityRole="button"
              accessibilityLabel={`Lire l’article : ${article.titre}`}
              onPress={() =>
                router.push({
                  pathname: '/(public)/article',
                  params: { slug: article.slug },
                })
              }
              className="w-full"
            >
              {({ pressed }) => (
                <View
                  className={`rounded-2xl border border-omda-borderGray p-4 ${
                    pressed ? 'bg-omda-warmGray' : 'bg-omda-white'
                  }`}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="mr-3 flex-1">
                      <Text className="text-lg font-bold text-omda-black">{article.titre}</Text>
                      <Text className="mt-1 text-sm leading-5 text-omda-textGray">{extrait}</Text>
                    </View>
                    <Icone nom="chevron-right" taille={14} classeCouleur="text-omda-textGray" />
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScreenContainer>
  );
}

