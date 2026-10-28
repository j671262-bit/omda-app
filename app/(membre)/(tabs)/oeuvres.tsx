import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  SelectField,
  StatusPill,
  TextField,
  type StatutPill,
} from '../../../src/components/ui';
import {
  STATUTS_OEUVRE,
  type Categorie,
  type Oeuvre,
  type StatutOeuvre,
} from '../../../src/models';
import type { ErreurApp } from '../../../src/services/contracts';
import { memberRepository, publicContentService } from '../../../src/services/factory';

/**
 * Écran Q — Œuvres du membre (onglet 2/5).
 *
 * Règles appliquées :
 * - données exclusivement issues de `memberRepository.listerOeuvres()` (le
 *   filtre par statut est appliqué CÔTÉ SERVICE, jamais dans l'UI) et libellés de
 *   catégories issus de `publicContentService.listerCategories()` ;
 * - 4 états obligatoires : chargement / erreur + « Réessayer » / vide / contenu ;
 * - recherche LOCALE insensible à la casse sur le titre et la description, plus
 *   filtre local par catégorie affiché UNIQUEMENT si le membre appartient à
 *   2 catégories ou plus (options issues de `listerCategoriesMembre()` et du
 *   référentiel : aucun libellé de catégorie codé en dur) ;
 * - une seule pastille verte est autorisée : `DEPOT_FINALISE` (effet serveur
 *   après un paiement `REUSSI`) — `VALIDEE` reste en `info`, jamais en vert,
 *   puisque les frais de dépôt ne sont pas encore réglés ;
 * - aucun statut n'est inventé : les libellés dérivent de l'ENUM `STATUTS_OEUVRE`
 *   (source unique de vérité du schéma).
 */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Valeur du filtre « toutes les œuvres » : aucun statut transmis au service. */
const FILTRE_TOUS = 'TOUS';

/** Valeur du filtre « toutes les catégories » : aucun critère local appliqué. */
const FILTRE_CATEGORIE_TOUTES = 'TOUTES';

/** Libellés et pastilles des statuts d'œuvre (cahier des charges §6). */
const STATUTS_AFFICHES: Record<StatutOeuvre, { variante: StatutPill; libelle: string }> = {
  BROUILLON: { variante: 'pending', libelle: 'Brouillon' },
  ENVOYEE: { variante: 'pending', libelle: 'Envoyée à l’OMDA' },
  EN_COURS_DE_VALIDATION: { variante: 'pending', libelle: 'En cours de validation' },
  VALIDEE: { variante: 'info', libelle: 'Validée — frais de dépôt à régler' },
  REJETEE: { variante: 'error', libelle: 'Rejetée' },
  DEPOT_FINALISE: { variante: 'success', libelle: 'Dépôt finalisé' },
};

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Vos œuvres sont momentanément indisponibles. Veuillez réessayer dans quelques instants.';
}

/** Date ISO affichée en `JJ/MM/AAAA` (formatage manuel, sans `Intl`). */
function formaterDateCourte(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  return `${jour}/${mois}/${date.getFullYear()}`;
}

type PropsCarteOeuvre = {
  oeuvre: Oeuvre;
  libelleCategorie: string;
  onOuvrir: () => void;
};

/** Carte d'une œuvre : titre, catégorie, année, statut et motif de rejet éventuel. */
function CarteOeuvre({ oeuvre, libelleCategorie, onOuvrir }: PropsCarteOeuvre) {
  const statut = STATUTS_AFFICHES[oeuvre.statut];
  const dateSoumission = formaterDateCourte(oeuvre.date_soumission);

  return (
    <View className="w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
      <Text className="text-lg font-bold text-omda-black">{oeuvre.titre}</Text>

      <View className="mt-2 flex-row items-center">
        <Icone nom="tag" taille={14} classeCouleur="text-omda-textGray" />
        <Text className="ml-2 flex-1 text-base text-omda-textGray">
          {oeuvre.annee ? `${libelleCategorie} — ${oeuvre.annee}` : libelleCategorie}
        </Text>
      </View>

      <View className="mt-3">
        <StatusPill statut={statut.variante} libelle={statut.libelle} />
      </View>

      {dateSoumission ? (
        <Text className="mt-3 text-sm text-omda-textGray">{`Envoyée le ${dateSoumission}`}</Text>
      ) : null}

      {oeuvre.statut === 'REJETEE' && oeuvre.motif_rejet ? (
        <Text className="mt-3 text-sm text-status-error">
          {`Motif du rejet : ${oeuvre.motif_rejet}`}
        </Text>
      ) : null}

      <View className="mt-4">
        <Button
          libelle="Ouvrir la fiche"
          variante="secondary"
          icone="file-lines"
          pleineLargeur
          onPress={onOuvrir}
        />
      </View>
    </View>
  );
}

export default function OeuvresScreen() {
  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [oeuvres, setOeuvres] = useState<Oeuvre[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [filtre, setFiltre] = useState<string>(FILTRE_TOUS);

  /** Recherche locale (titre + description), conservée entre deux affichages. */
  const [termeRecherche, setTermeRecherche] = useState('');
  /** Filtre local par catégorie (`TOUTES` = aucun critère). */
  const [filtreCategorie, setFiltreCategorie] = useState<string>(FILTRE_CATEGORIE_TOUTES);
  /** Catégories du membre (`membre_categorie`) : alimenteront le filtre affiché. */
  const [categoriesMembre, setCategoriesMembre] = useState<Categorie[]>([]);

  const statutFiltre: StatutOeuvre | null =
    filtre === FILTRE_TOUS ? null : (filtre as StatutOeuvre);

  /** Charge les œuvres (filtre transmis au service), le référentiel et les catégories du membre. */
  const chargerOeuvres = useCallback(async (statut: StatutOeuvre | null) => {
    setEtat('chargement');
    setMessageErreur('');

    try {
      const [reponseOeuvres, reponseCategories, reponseAppartenances] = await Promise.all([
        memberRepository.listerOeuvres(statut ? { statut } : undefined),
        publicContentService.listerCategories(),
        memberRepository.listerCategoriesMembre(),
      ]);

      if (!reponseOeuvres.ok) {
        setOeuvres([]);
        setMessageErreur(traduireErreur(reponseOeuvres.erreur));
        setEtat('erreur');
        return;
      }

      if (!reponseCategories.ok) {
        setOeuvres([]);
        setMessageErreur(traduireErreur(reponseCategories.erreur));
        setEtat('erreur');
        return;
      }

      if (!reponseAppartenances.ok) {
        setOeuvres([]);
        setMessageErreur(traduireErreur(reponseAppartenances.erreur));
        setEtat('erreur');
        return;
      }

      setOeuvres(reponseOeuvres.valeur);
      setCategories(reponseCategories.valeur);
      setCategoriesMembre(reponseAppartenances.valeur.categories);
      setEtat(reponseOeuvres.valeur.length === 0 ? 'vide' : 'contenu');
    } catch {
      setOeuvres([]);
      setMessageErreur(
        'Une erreur inattendue est survenue pendant le chargement de vos œuvres. Veuillez réessayer.',
      );
      setEtat('erreur');
    }
  }, []);

  /** Recharge à chaque retour sur l'onglet (un statut évolue côté serveur). */
  useFocusEffect(
    useCallback(() => {
      void chargerOeuvres(statutFiltre);
    }, [chargerOeuvres, statutFiltre]),
  );

  /** Libellés de catégories (repli explicite si le référentiel ne la contient plus). */
  const libellesCategories = useMemo(() => {
    const table = new Map<string, string>();
    categories.forEach((categorie) => table.set(categorie.id, categorie.libelle));
    return table;
  }, [categories]);

  const optionsFiltre = useMemo(
    () => [
      { valeur: FILTRE_TOUS, libelle: 'Toutes mes œuvres' },
      ...STATUTS_OEUVRE.map((statut) => ({
        valeur: statut,
        libelle: STATUTS_AFFICHES[statut].libelle,
      })),
    ],
    [],
  );

  /** Catégories du membre (libellés issus du service, jamais écrits dans l'écran). */
  const optionsCategorie = useMemo(
    () =>
      categoriesMembre.map((categorie) => ({
        valeur: categorie.id,
        libelle: categorie.libelle,
      })),
    [categoriesMembre],
  );

  /** Le filtre par catégorie n'existe que si le membre est dans 2 catégories ou plus. */
  const afficherFiltreCategorie = optionsCategorie.length >= 2;

  /** Options effectivement rendues : « Toutes les catégories » + celles du membre. */
  const optionsSelectCategorie = useMemo(
    () => [
      { valeur: FILTRE_CATEGORIE_TOUTES, libelle: 'Toutes les catégories' },
      ...optionsCategorie,
    ],
    [optionsCategorie],
  );

  /**
   * Catégorie effectivement appliquée : `null` si le filtre n'est pas affiché
   * ou si la valeur choisie n'appartient plus au profil (catégorie retirée
   * entre deux affichages) — la liste ne peut alors jamais être vidée à tort.
   */
  const categorieFiltre = useMemo(() => {
    if (!afficherFiltreCategorie) return null;
    return optionsCategorie.some((option) => option.valeur === filtreCategorie)
      ? filtreCategorie
      : null;
  }, [afficherFiltreCategorie, filtreCategorie, optionsCategorie]);

  /** Œuvres affichées : filtres LOCAUX (recherche + catégorie) sur la liste du service. */
  const oeuvresAffichees = useMemo(() => {
    const terme = termeRecherche.trim().toLowerCase();

    return oeuvres.filter((oeuvre) => {
      const rechercheOk =
        terme.length === 0 ||
        oeuvre.titre.toLowerCase().includes(terme) ||
        (oeuvre.description ?? '').toLowerCase().includes(terme);
      const categorieOk = categorieFiltre === null || oeuvre.categorie_id === categorieFiltre;

      return rechercheOk && categorieOk;
    });
  }, [categorieFiltre, oeuvres, termeRecherche]);

  /** Vrai dès qu'un filtre local (recherche ou catégorie) s'applique. */
  const filtreLocalActif =
    termeRecherche.trim().length > 0 || categorieFiltre !== null;

  /** Efface la recherche et le filtre local (sans recharger les données). */
  const effacerFiltres = useCallback(() => {
    setTermeRecherche('');
    setFiltreCategorie(FILTRE_CATEGORIE_TOUTES);
  }, []);

  const ouvrirDepot = useCallback(() => {
    router.push('/(membre)/depot-oeuvre');
  }, []);

  const ouvrirFiche = useCallback((oeuvre: Oeuvre) => {
    router.push({ pathname: '/(membre)/fiche-oeuvre', params: { oeuvre_id: oeuvre.id } });
  }, []);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Œuvres" afficherRetour={false}>
        <LoadingState message="Chargement de vos œuvres…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Œuvres" afficherRetour={false}>
        <ErrorState
          titre="Œuvres indisponibles"
          message={messageErreur}
          libelleAction="Réessayer"
          onReessayer={() => void chargerOeuvres(statutFiltre)}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Œuvres" afficherRetour={false}>
      <Text className="text-base text-omda-textGray">
        Retrouvez ici toutes vos œuvres et l’avancement de leur dépôt auprès de l’OMDA.
      </Text>

      <View className="mt-5">
        <TextField
          libelle="Recherche"
          valeur={termeRecherche}
          onChangeValeur={setTermeRecherche}
          placeholder="Rechercher une œuvre…"
          aide="Par titre ou description, insensible à la casse."
        />
      </View>

      {afficherFiltreCategorie ? (
        <View className="mt-4">
          <SelectField
            libelle="Filtrer par catégorie"
            options={optionsSelectCategorie}
            valeur={categorieFiltre ?? FILTRE_CATEGORIE_TOUTES}
            onChangeValeur={setFiltreCategorie}
            aide="Vos catégories d’adhésion, fournies par le serveur OMDA."
          />
        </View>
      ) : null}

      <View className="mt-4">
        <SelectField
          libelle="Filtrer par statut"
          options={optionsFiltre}
          valeur={filtre}
          onChangeValeur={setFiltre}
          aide="Le filtre est appliqué par le serveur OMDA."
        />
      </View>

      {etat === 'vide' ? (
        <View className="mt-5">
          <EmptyState
            titre={
              statutFiltre ? 'Aucune œuvre dans ce statut' : 'Aucune œuvre déposée pour le moment'
            }
            message={
              statutFiltre
                ? 'Changez de filtre ou déposez une nouvelle œuvre pour la voir apparaître ici.'
                : 'Déposez votre première œuvre : titre, catégorie, fichier et attestation de diffusion. Aucun paiement n’est demandé à l’envoi.'
            }
            icone="folder-open"
            actionLibelle="Déposer une œuvre"
            onAction={ouvrirDepot}
          />
        </View>
      ) : oeuvresAffichees.length === 0 ? (
        <View className="mt-5">
          <EmptyState
            titre="Aucun résultat"
            message="Aucune œuvre ne correspond à votre recherche."
            icone="folder-open"
            actionLibelle={
              termeRecherche.trim().length > 0 ? 'Effacer la recherche' : 'Effacer les filtres'
            }
            onAction={effacerFiltres}
          />
        </View>
      ) : (
        <View className="mt-5 gap-4">
          <Text className="text-base font-semibold text-omda-black">
            {filtreLocalActif
              ? `${oeuvresAffichees.length} résultat${oeuvresAffichees.length > 1 ? 's' : ''}`
              : `${oeuvresAffichees.length} œuvre${oeuvresAffichees.length > 1 ? 's' : ''}`}
          </Text>

          {oeuvresAffichees.map((oeuvre) => (
            <CarteOeuvre
              key={oeuvre.id}
              oeuvre={oeuvre}
              libelleCategorie={
                libellesCategories.get(oeuvre.categorie_id) ?? 'Catégorie non précisée'
              }
              onOuvrir={() => ouvrirFiche(oeuvre)}
            />
          ))}

          <InfoBanner
            variante="info"
            titre="Dépôt d’œuvre"
            message="L’envoi d’une œuvre ne déclenche aucun paiement : les frais de dépôt ne sont réglés qu’après la validation de l’œuvre par l’OMDA."
          />
        </View>
      )}

      <View className="mt-6 gap-3">
        <Button libelle="Déposer une œuvre" icone="plus" pleineLargeur onPress={ouvrirDepot} />
        <Button
          libelle="Actualiser"
          variante="secondary"
          icone="rotate-right"
          pleineLargeur
          onPress={() => void chargerOeuvres(statutFiltre)}
        />
      </View>
    </ScreenContainer>
  );
}
