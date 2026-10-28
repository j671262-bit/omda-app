import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  SelectField,
  type OptionSelect,
} from '../../src/components/ui';
import type { Categorie } from '../../src/models';
import type { ErreurApp } from '../../src/services/contracts';
import { memberRepository, publicContentService } from '../../src/services/factory';

/**
 * États de rendu de l'écran HORS chargement : les états obligatoires `erreur`,
 * `vide` et `contenu`.
 *
 * L'état `chargement` est porté par le drapeau booléen `chargement` : il est
 * désactivé dans le `finally` de la fonction de chargement, l'écran ne peut donc
 * jamais rester bloqué sur le message « Chargement… ».
 */
type EtatEcran = 'erreur' | 'vide' | 'contenu';

/**
 * Délai de sécurité du chargement : au-delà, la réponse est considérée perdue —
 * l'écran sort du chargement et propose « Réessayer ».
 */
const DELAI_MAX_CHARGEMENT_MS = 9000;

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Les catégories sont momentanément indisponibles. Veuillez réessayer dans quelques instants.';
}

/**
 * Demande de catégorie supplémentaire (règle métier 9) — écran 1/2, HORS
 * onglets, atteint depuis la section « Mes catégories » du Profil.
 *
 * Étape de CHOIX : le membre sélectionne une catégorie active qui n'est ni
 * déjà `ACTIVE` ni `EN_ATTENTE` dans son profil (une catégorie annulée ou
 * refusée reste demandable à nouveau), puis « Continuer » l'emmène vers
 * `demander-categorie-oeuvres` où il joindra AU MOINS 2 œuvres accompagnées de
 * leur attestation de diffusion (règles métier 9 + 8). Aucun envoi n'a lieu sur
 * cet écran : la demande n'est créée (`EN_ATTENTE`) qu'au terme de l'écran 2 —
 * seule la décision d'un agent OMDA l'activera, jamais de validation immédiate,
 * aucun paiement.
 *
 * Données : `memberRepository.listerCategoriesMembre()` et
 * `publicContentService.listerCategories()` — instances centralisées de la
 * couche data (`src/services/factory`, aucune classe HTTP ni interface instanciée
 * ici ; aucune catégorie codée en dur ; les catégories déjà au profil avec un
 * statut bloquant sont exclues du choix).
 * Gère obligatoirement les 4 états : `LoadingState`, `ErrorState` + « Réessayer »,
 * `EmptyState` (plus aucune catégorie disponible) et contenu normal.
 * Le choix est chargé par un `useEffect` au montage, sous try/catch/finally, avec
 * un délai de sécurité : l'écran ne peut jamais rester bloqué sur le chargement.
 */
export default function DemanderCategorieScreen() {
  const [chargement, setChargement] = useState(true);
  const [etat, setEtat] = useState<EtatEcran>('vide');
  const [messageErreur, setMessageErreur] = useState('');
  const [options, setOptions] = useState<OptionSelect[]>([]);
  const [libellesDejaPresents, setLibellesDejaPresents] = useState<string[]>([]);
  const [categorieSelectionnee, setCategorieSelectionnee] = useState<string | null>(null);
  const [erreurSelection, setErreurSelection] = useState<string | undefined>(undefined);

  /**
   * Charge le choix proposé : catégories déjà rattachées au profil
   * (`listerCategoriesMembre`) et catégories actives du référentiel public
   * (`listerCategories`), toutes deux fournies par la fabrique de services.
   *
   * `setChargement(false)` est appelé dans le `finally` : l'écran sort donc
   * TOUJOURS du chargement, qu'il réussisse, qu'il échoue, qu'une exception
   * survienne ou que le délai de sécurité soit dépassé.
   */
  const chargerChoix = useCallback(async () => {
    setChargement(true);
    setMessageErreur('');
    setErreurSelection(undefined);
    setCategorieSelectionnee(null);

    let minuteurSecurite: ReturnType<typeof setTimeout> | null = null;

    try {
      const reponses = await Promise.race([
        Promise.all([
          memberRepository.listerCategoriesMembre(),
          publicContentService.listerCategories(),
        ]),
        new Promise<null>((resoudre) => {
          minuteurSecurite = setTimeout(() => resoudre(null), DELAI_MAX_CHARGEMENT_MS);
        }),
      ]);

      if (reponses === null) {
        setMessageErreur(
          'Délai dépassé : le serveur OMDA met trop de temps à répondre. Vérifiez votre connexion Internet puis réessayez.',
        );
        setEtat('erreur');
        return;
      }

      const [appartenances, categoriesActives] = reponses;

      if (!appartenances.ok) {
        setMessageErreur(traduireErreur(appartenances.erreur));
        setEtat('erreur');
        return;
      }
      if (!categoriesActives.ok) {
        setMessageErreur(traduireErreur(categoriesActives.erreur));
        setEtat('erreur');
        return;
      }

      // Statuts bloquants : catégorie déjà active ou déjà demandée ⇒ jamais
      // proposée à nouveau. Une appartenance `ANNULEE` ou `REJETEE` reste
      // réouvrable : elle n'exclut pas la catégorie du choix.
      const statutsBloquants = new Set(['ACTIVE', 'EN_ATTENTE', 'INACTIVE']);
      const dejaRattachees = new Set(
        appartenances.valeur.membre_categories
          .filter((appartenance) => statutsBloquants.has(appartenance.statut))
          .map((appartenance) => appartenance.categorie_id),
      );
      const disponibles: Categorie[] = categoriesActives.valeur.filter(
        (categorie) => !dejaRattachees.has(categorie.id),
      );

      setOptions(
        disponibles.map((categorie) => ({
          valeur: categorie.id,
          libelle: categorie.libelle,
          description: categorie.description ?? undefined,
        })),
      );
      setLibellesDejaPresents(
        appartenances.valeur.categories
          .filter((categorie) => dejaRattachees.has(categorie.id))
          .map((categorie) => categorie.libelle),
      );
      setEtat(disponibles.length === 0 ? 'vide' : 'contenu');
    } catch {
      setMessageErreur(
        'Une erreur inattendue est survenue pendant le chargement des catégories. Veuillez réessayer dans quelques instants.',
      );
      setEtat('erreur');
    } finally {
      if (minuteurSecurite) {
        clearTimeout(minuteurSecurite);
      }
      setChargement(false);
    }
  }, []);

  /**
   * Chargement initial du choix : sans cet appel, l'écran resterait bloqué sur
   * « Chargement des catégories disponibles… ».
   */
  useEffect(() => {
    void chargerChoix();
  }, [chargerChoix]);

  /**
   * Étape suivante : contrôle de la sélection puis navigation vers l'écran 2
   * (joindre les œuvres) avec l'identifiant ET le libellé de la catégorie —
   * aucune demande n'est encore créée à ce stade.
   */
  const continuer = useCallback(() => {
    if (!categorieSelectionnee) {
      setErreurSelection('Sélectionnez la catégorie que vous souhaitez ajouter.');
      return;
    }
    router.push({
      pathname: '/(membre)/demander-categorie-oeuvres',
      params: {
        categorie_id: categorieSelectionnee,
        categorie_libelle:
          options.find((option) => option.valeur === categorieSelectionnee)?.libelle ?? '',
      },
    });
  }, [categorieSelectionnee, options]);

  const retourProfil = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/(tabs)/profil');
  }, []);

  if (chargement) {
    return (
      <ScreenContainer titre="Demander une catégorie" sousTitre="Mes catégories">
        <LoadingState message="Chargement des catégories disponibles…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Demander une catégorie" sousTitre="Mes catégories">
        <ErrorState
          titre="Catégories indisponibles"
          message={messageErreur}
          onReessayer={() => void chargerChoix()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Demander une catégorie" sousTitre="Mes catégories">
      <InfoBanner
        variante="info"
        titre="Comment cela fonctionne"
        message="Choisissez une catégorie à ajouter à votre profil puis, à l’étape suivante, joignez au moins 2 œuvres avec leur attestation de diffusion. Votre demande est ensuite transmise à l’équipe OMDA et reste « en attente » jusqu’à la décision d’un agent. Aucun paiement n’est requis et aucune catégorie n’est activée automatiquement."
      />

      {etat === 'vide' ? (
        <View className="mt-5">
          <EmptyState
            titre="Aucune catégorie supplémentaire disponible"
            message="Toutes les catégories actives sont déjà associées à votre profil ou font l’objet d’une demande en attente. Contactez l’OMDA si vous pensez qu’une catégorie manque."
            icone="layer-group"
            actionLibelle="Actualiser"
            onAction={() => void chargerChoix()}
          />
        </View>
      ) : (
        <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          {libellesDejaPresents.length > 0 ? (
            <Text className="text-sm text-omda-textGray">
              Déjà dans votre profil : {libellesDejaPresents.join(', ')}.
            </Text>
          ) : null}

          <View className={libellesDejaPresents.length > 0 ? 'mt-4' : undefined}>
            <SelectField
              libelle="Catégorie souhaitée"
              options={options}
              valeur={categorieSelectionnee}
              onChangeValeur={(valeur) => {
                setCategorieSelectionnee(valeur);
                setErreurSelection(undefined);
              }}
              placeholder="Sélectionnez une catégorie"
              aide="Seules les catégories actives, sans demande en cours ni enregistrement actif, sont proposées."
              erreur={erreurSelection}
              obligatoire
            />
          </View>

          <View className="mt-5">
            <Button
              libelle="Continuer vers les œuvres"
              icone="arrow-right"
              pleineLargeur
              onPress={continuer}
            />
          </View>
        </View>
      )}

      <View className="mt-5">
        <Button
          libelle="Retour à mon profil"
          variante="secondary"
          pleineLargeur
          onPress={retourProfil}
        />
      </View>
    </ScreenContainer>
  );
}
