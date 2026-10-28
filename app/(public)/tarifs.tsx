import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  AmountCard,
  EmptyState,
  ErrorState,
  InfoBanner,
  LoadingState,
  type OptionSelect,
  ScreenContainer,
  SelectField,
} from '../../src/components/ui';
import type { Categorie, Tarif, TypeOperationTarif } from '../../src/models';
import type { EstimationMontant } from '../../src/services/contracts';
import { publicContentService } from '../../src/services/factory';

type EtatChargement = 'chargement' | 'erreur' | 'vide' | 'contenu';
type EtatEstimation = 'initial' | 'chargement' | 'erreur' | 'succes';

const VALEUR_GENERAL = 'GENERAL';

const LIBELLES_OPERATION: Record<TypeOperationTarif, string> = {
  ADHESION: 'Frais d’adhésion',
  DEPOT_OEUVRE: 'Dépôt d’une œuvre',
};

function estTypeOperation(valeur: string): valeur is TypeOperationTarif {
  return valeur === 'ADHESION' || valeur === 'DEPOT_OEUVRE';
}

/**
 * Tarifs / Simulateur (écran D du cahier des charges).
 *
 * Sans menu (navigation linéaire).
 * Données issues de `publicContentService` :
 * - liste des tarifs & catégories (aucun montant codé en dur)
 * - choix du type d'opération (ADHESION / DEPOT_OEUVRE)
 * - choix de catégorie si le tarif dépend de la catégorie
 * - montant estimatif calculé par le service
 * - mention obligatoire : « Estimation — le montant final est confirmé par le serveur. »
 */
export default function TarifsScreen() {
  const [etat, setEtat] = useState<EtatChargement>('chargement');
  const [tarifs, setTarifs] = useState<Tarif[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [messageErreur, setMessageErreur] = useState<string>('');

  const [operation, setOperation] = useState<TypeOperationTarif>('ADHESION');
  const [categorie, setCategorie] = useState<string>(VALEUR_GENERAL);

  const [estimation, setEstimation] = useState<EstimationMontant | null>(null);
  const [etatEstimation, setEtatEstimation] = useState<EtatEstimation>('initial');
  const [messageErreurEstimation, setMessageErreurEstimation] = useState<string>('');

  const chargerReferentiels = useCallback(async () => {
    setEtat('chargement');
    setMessageErreur('');

    const [resultatTarifs, resultatCategories] = await Promise.all([
      publicContentService.listerTarifs(),
      publicContentService.listerCategories(),
    ]);

    if (!resultatTarifs.ok) {
      const message =
        resultatTarifs.erreur.type === 'reseau'
          ? 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet.'
          : 'La grille tarifaire est temporairement indisponible.';
      setMessageErreur(message);
      setEtat('erreur');
      return;
    }

    if (!resultatCategories.ok) {
      const message =
        resultatCategories.erreur.type === 'reseau'
          ? 'Impossible de charger les catégories d’adhésion. Vérifiez votre connexion.'
          : 'Les catégories d’adhésion sont temporairement indisponibles.';
      setMessageErreur(message);
      setEtat('erreur');
      return;
    }

    // N'afficher que les types d'opération supportés par l'application mobile.
    const tarifsConserves = resultatTarifs.valeur.filter((tarif) =>
      estTypeOperation(tarif.type_operation),
    );

    if (tarifsConserves.length === 0) {
      setTarifs([]);
      setCategories([]);
      setEtat('vide');
      return;
    }

    setTarifs(tarifsConserves);
    setCategories(resultatCategories.valeur);
    setOperation(tarifsConserves[0].type_operation);

    setEtat('contenu');
  }, []);

  useEffect(() => {
    void chargerReferentiels();
  }, [chargerReferentiels]);

  const tarifsPourOperation = tarifs.filter((t) => t.type_operation === operation);
  const categorieRequise = tarifsPourOperation.some((t) => t.categorie_id !== null);

  const estimer = useCallback(async () => {
    if (etat !== 'contenu') {
      return;
    }
    setEtatEstimation('chargement');
    setMessageErreurEstimation('');

    const categorieId = categorie === VALEUR_GENERAL ? null : categorie;
    const resultat = await publicContentService.estimerMontant({
      type_operation: operation,
      categorie_id: categorieId,
    });

    if (!resultat.ok) {
      const message =
        resultat.erreur.type === 'reseau'
          ? 'Impossible d’obtenir l’estimation (problème réseau).'
          : resultat.erreur.type === 'serveur'
            ? 'Le serveur n’a pas pu estimer ce tarif.'
            : resultat.erreur.message;
      setMessageErreurEstimation(message);
      setEtatEstimation('erreur');
      return;
    }

    setEstimation(resultat.valeur);
    setEtatEstimation('succes');
  }, [categorie, etat, operation]);

  useEffect(() => {
    if (etat === 'contenu') {
      void estimer();
    }
  }, [estimer, etat]);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Tarifs">
        <LoadingState message="Chargement de la grille tarifaire…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Tarifs">
        <ErrorState message={messageErreur} onReessayer={() => void chargerReferentiels()} />
      </ScreenContainer>
    );
  }

  if (etat === 'vide') {
    return (
      <ScreenContainer titre="Tarifs">
        <EmptyState
          titre="Aucun tarif disponible"
          message="La grille tarifaire n’est pas disponible pour le moment. Veuillez réessayer dans quelques instants."
          icone="money-bill-wave"
          actionLibelle="Réessayer"
          onAction={() => void chargerReferentiels()}
        />
      </ScreenContainer>
    );
  }

  const operationsDisponibles = Array.from(
    new Set(tarifs.map((tarif) => tarif.type_operation).filter(estTypeOperation)),
  );

  const optionsOperation: OptionSelect[] = operationsDisponibles.map((valeur) => ({
    valeur,
    libelle: LIBELLES_OPERATION[valeur],
  }));

  const optionsCategorie: OptionSelect[] = [
    {
      valeur: VALEUR_GENERAL,
      libelle: 'Tarif général',
      description: 'Tarif appliqué sans catégorie particulière',
    },
    ...categories.map((element) => ({
      valeur: element.id,
      libelle: element.libelle,
      description: element.description ?? undefined,
    })),
  ];

  return (
    <ScreenContainer titre="Tarifs" sousTitre="Simulateur — estimation uniquement">
      <Text className="text-base text-omda-textGray">
        Choisissez une opération : le montant affiché est une estimation calculée à partir de la
        grille tarifaire en vigueur.
      </Text>

      <View className="mt-5 gap-4">
        <SelectField
          libelle="Type d’opération"
          options={optionsOperation}
          valeur={operation}
          obligatoire
          onChangeValeur={(valeur) => {
            if (estTypeOperation(valeur)) {
              setOperation(valeur);
            }
          }}
        />

        {categorieRequise ? (
          <SelectField
            libelle="Catégorie"
            options={optionsCategorie}
            valeur={categorie}
            aide="Pour cette opération, le tarif dépend de la catégorie d’adhésion."
            onChangeValeur={setCategorie}
          />
        ) : null}
      </View>

      <View className="mt-6">
        {etatEstimation === 'chargement' ? (
          <LoadingState message="Calcul de l’estimation…" />
        ) : etatEstimation === 'erreur' ? (
          <ErrorState
            titre="Estimation indisponible"
            message={messageErreurEstimation}
            onReessayer={() => void estimer()}
          />
        ) : estimation ? (
          <>
            <AmountCard
              objet={LIBELLES_OPERATION[estimation.type_operation]}
              montant={estimation.montant}
              mention={estimation.mention}
            />
            {estimation.valide_jusqu_au ? (
              <Text className="mt-2 text-sm text-omda-textGray">
                {`Tarif applicable jusqu’au ${estimation.valide_jusqu_au}.`}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>

      <View className="mt-6">
        <InfoBanner
          variante="info"
          titre="Estimation seulement"
          message="Aucun paiement n’est effectué depuis cet écran. Le paiement se fait dans le parcours d’adhésion ou dans votre espace membre, après confirmation du serveur."
        />
      </View>
    </ScreenContainer>
  );
}


