import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Icone,
  LoadingState,
  ScreenContainer,
  StepProgress,
} from '../../src/components/ui';
import { useAdhesionDraft } from '../../src/context/AdhesionDraftContext';
import type { Categorie } from '../../src/models';
import { publicContentService } from '../../src/services/factory';

type EtatChargement = 'chargement' | 'erreur' | 'vide' | 'contenu';

/**
 * Étape 2 — Catégorie (écran I du cahier des charges).
 *
 * Sans menu (navigation linéaire).
 * Données issues de `publicContentService.listerCategories()` (aucune codée en dur).
 * Gère obligatoirement les 4 états :
 * - `LoadingState`
 * - `ErrorState` + bouton « Réessayer »
 * - `EmptyState`
 * - Contenu normal (sélection obligatoire d'une catégorie active + courte explication)
 *
 * Sauvegarde continue dans le store persistant `AdhesionDraft`.
 */
export default function CategorieScreen() {
  const { brouillon, definirCategorie } = useAdhesionDraft();

  const [etat, setEtat] = useState<EtatChargement>('chargement');
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [messageErreur, setMessageErreur] = useState<string>('');
  const [tentativeValidation, setTentativeValidation] = useState(false);

  const categorieSelectionnee = brouillon.categorie_id;

  const chargerCategories = useCallback(async () => {
    setEtat('chargement');
    setMessageErreur('');

    const resultat = await publicContentService.listerCategories();

    if (!resultat.ok) {
      const message =
        resultat.erreur.type === 'reseau'
          ? 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet et réessayez.'
          : 'Le service des catégories d’adhésion est momentanément indisponible.';
      setMessageErreur(message);
      setEtat('erreur');
      return;
    }

    if (resultat.valeur.length === 0) {
      setCategories([]);
      setEtat('vide');
      return;
    }

    setCategories(resultat.valeur);
    setEtat('contenu');
  }, []);

  useEffect(() => {
    void chargerCategories();
  }, [chargerCategories]);

  const continuer = useCallback(() => {
    setTentativeValidation(true);
    if (!categorieSelectionnee) {
      return;
    }
    router.push('/(adhesion)/documents-oeuvres');
  }, [categorieSelectionnee]);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Catégorie" sousTitre="Demande d’adhésion">
        <StepProgress etapeCourante={2} />
        <LoadingState message="Chargement des catégories d’adhésion…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Catégorie" sousTitre="Demande d’adhésion">
        <StepProgress etapeCourante={2} />
        <ErrorState
          titre="Catégories indisponibles"
          message={messageErreur}
          onReessayer={() => void chargerCategories()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide') {
    return (
      <ScreenContainer titre="Catégorie" sousTitre="Demande d’adhésion">
        <StepProgress etapeCourante={2} />
        <EmptyState
          titre="Aucune catégorie active"
          message="Aucune catégorie d’adhésion n’est proposée pour le moment. Veuillez réessayer plus tard."
          icone="folder-open"
          actionLibelle="Réessayer"
          onAction={() => void chargerCategories()}
        />
      </ScreenContainer>
    );
  }

  const enErreurSelection = tentativeValidation && !categorieSelectionnee;

  return (
    <ScreenContainer titre="Catégorie" sousTitre="Demande d’adhésion">
      <StepProgress etapeCourante={2} />

      <Text className="text-base text-omda-textGray">
        Sélectionnez la catégorie principale qui correspond à votre activité artistique. Vous
        pourrez déclarer d’autres catégories plus tard depuis votre espace membre.
      </Text>

      {enErreurSelection ? (
        <View className="mt-4 flex-row items-center rounded-xl border border-status-error bg-omda-white p-3">
          <Icone nom="circle-xmark" taille={16} classeCouleur="text-status-error" />
          <Text className="ml-2 flex-1 text-sm font-semibold text-status-error">
            Veuillez choisir une catégorie avant de continuer.
          </Text>
        </View>
      ) : null}

      <View className="mt-5 gap-3">
        {categories.map((element) => {
          const estChoisie = element.id === categorieSelectionnee;

          const classeBordure = estChoisie
            ? 'border-omda-green bg-omda-warmGray'
            : 'border-omda-borderGray bg-omda-white';

          return (
            <Pressable
              key={element.id}
              accessibilityRole="radio"
              accessibilityLabel={`${element.libelle}${element.description ? ` : ${element.description}` : ''}`}
              accessibilityState={{ selected: estChoisie }}
              onPress={() => {
                setTentativeValidation(false);
                void definirCategorie(element.id);
              }}
              className="w-full"
            >
              {({ pressed }) => (
                <View
                  className={`min-h-14 rounded-2xl border p-4 ${classeBordure} ${
                    pressed && !estChoisie ? 'bg-omda-warmGray' : ''
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="mr-3 flex-1">
                      <Text
                        className={`text-lg text-omda-black ${
                          estChoisie ? 'font-bold' : 'font-semibold'
                        }`}
                      >
                        {element.libelle}
                      </Text>
                      {element.description ? (
                        <Text className="mt-1 text-sm leading-5 text-omda-textGray">
                          {element.description}
                        </Text>
                      ) : null}
                    </View>

                    <View
                      className={`h-6 w-6 items-center justify-center rounded-full border ${
                        estChoisie
                          ? 'border-omda-green bg-omda-green'
                          : 'border-omda-borderGray bg-omda-white'
                      }`}
                    >
                      {estChoisie ? (
                        <Icone nom="check" taille={12} classeCouleur="text-omda-white" />
                      ) : null}
                    </View>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View className="mt-8 gap-3">
        <Button
          libelle="Continuer vers les documents"
          pleineLargeur
          onPress={continuer}
        />
        <Button
          libelle="Retour à l’identité"
          variante="secondary"
          pleineLargeur
          onPress={() => router.back()}
        />
      </View>
    </ScreenContainer>
  );
}


