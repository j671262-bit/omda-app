import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  UploadTile,
  type OptionSelect,
  type StatutUpload,
} from '../../src/components/ui';
import {
  TAILLE_MAX_FICHIER_MO,
  TAILLE_MAX_FICHIER_OCTETS,
  TYPES_MIME_ATTESTATION,
  TYPES_MIME_AUTORISES,
  type Categorie,
  type Oeuvre,
  type TypeMime,
} from '../../src/models';
import { CODES_ERREUR_MEMBRE } from '../../src/services/contracts';
import type { ErreurApp, FichierDepose } from '../../src/services/contracts';
import { memberRepository, publicContentService } from '../../src/services/factory';
import { CODES_ERREUR_DONNEES } from '../../src/services/contracts';
import {
  AIDE_ATTESTATION_FORMATS,
  MESSAGE_ATTESTATION_FORMAT_INVALIDE,
  isAllowedAttestationMime,
} from '../../src/utils';

/**
 * Écran R — Dépôt d'une œuvre (hors onglets).
 *
 * Règles métier appliquées :
 * - brouillon d'abord (`creerOeuvre` / `mettreAJourOeuvre`), puis envoi
 *   (`soumettreOeuvre`) : l'envoi passe l'œuvre à `ENVOYEE` et ne déclenche
 *   AUCUN paiement (le paiement des frais de dépôt n'est proposé qu'après
 *   `VALIDEE`, depuis la fiche de l'œuvre) ;
 * - au moins une attestation de diffusion par œuvre (règle métier 8) ;
 * - les catégories proposées viennent du service : appartenances `ACTIVE` du
 *   membre croisées avec le référentiel actif — aucune catégorie codée en dur ;
 * - téléversement avec progression, annulation et reprise (`UploadTile`),
 *   contrôle local 20 Mo et types MIME autorisés avant envoi ;
 * - 4 états obligatoires : chargement / erreur + « Réessayer » / vide / contenu,
 *   auxquels s'ajoute l'état « Œuvre envoyée » (accusé de réception du serveur).
 */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu' | 'succes';

/** Bucket de destination des œuvres et de leurs attestations. */
const BUCKET_OEUVRES = 'oeuvres';

/** Formats acceptés pour une œuvre, rappelés dans les messages. */
const LIBELLE_FORMATS = 'MP3, WAV, PDF, JPEG ou PNG';

/** Bornes de l'année de création d'une œuvre. */
const ANNEE_MINIMUM = 1900;

/** Fichier retenu localement en attendant la confirmation du service. */
type FichierSelectionne = {
  uri: string;
  nom: string;
  mime_type: TypeMime;
  taille_octets: number;
};

/** Suivi d'un envoi : statut, progression, fichier retenu et référence déposée. */
type EnvoiFichier = {
  statut: StatutUpload;
  progression: number;
  selection: FichierSelectionne | null;
  depose: FichierDepose | null;
  erreur: string | null;
};

const ENVOI_VIDE: EnvoiFichier = {
  statut: 'vide',
  progression: 0,
  selection: null,
  depose: null,
  erreur: null,
};

/** Cible d'un envoi de fichier sur cet écran. */
type CibleEnvoi = 'fichier' | 'attestation';

/** Fichier brut renvoyé par `expo-document-picker`. */
type CandidatFichier = {
  uri: string;
  nom: string;
  mime_fourni: string | null | undefined;
  taille_octets: number;
};

type ResultatValidation =
  | { ok: true; selection: FichierSelectionne }
  | { ok: false; motif: string };

/** Extensions reconnues lorsque le système ne fournit pas de type MIME. */
const MIME_PAR_EXTENSION: Record<string, TypeMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** Déduit un type MIME autorisé à partir du type système, sinon de l'extension. */
function deduireMime(nomFichier: string, mimeFourni: string | null | undefined): TypeMime | null {
  const propre = (mimeFourni ?? '').trim().toLowerCase();
  const normalise = propre === 'image/jpg' ? 'image/jpeg' : propre;
  if ((TYPES_MIME_AUTORISES.oeuvres as readonly string[]).includes(normalise)) {
    return normalise as TypeMime;
  }
  const extension = nomFichier.split('.').pop()?.trim().toLowerCase() ?? '';
  return MIME_PAR_EXTENSION[extension] ?? null;
}

/** Chemin de stockage transmis au service de téléversement. */
function cheminStockage(nomFichier: string): string {
  const nomPropre = nomFichier.replace(/[^\w.\-]+/g, '_') || 'fichier';
  return `${BUCKET_OEUVRES}/brouillons/${Date.now().toString(36)}-${nomPropre}`;
}

/** Taille lisible par l'utilisateur (Mo, une décimale). */
function formaterTaille(octets: number): string {
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Message affiché lorsqu'un envoi de fichier échoue. */
function messageErreurEnvoi(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'La connexion a été interrompue pendant l’envoi. Vérifiez votre réseau puis réessayez.';
  }
  return 'L’envoi du fichier a échoué (service indisponible). Veuillez réessayer.';
}

/** Paramètre d'URL unique (chaîne) ou absent. */
function parametreTexte(valeur: string | string[] | undefined): string {
  if (typeof valeur === 'string') return valeur.trim();
  if (Array.isArray(valeur) && valeur.length > 0 && typeof valeur[0] === 'string') {
    return valeur[0].trim();
  }
  return '';
}

/**
 * Valide un fichier choisi : 20 Mo maximum et type MIME autorisé pour les
 * œuvres. Une attestation de diffusion n'accepte que des DOCUMENTS (PDF, JPEG
 * ou PNG) : l'audio est réservé au fichier de l'œuvre.
 */
function validerCandidat(candidat: CandidatFichier, estAttestation = false): ResultatValidation {
  const nom = candidat.nom.trim() || 'fichier';

  if (candidat.taille_octets > TAILLE_MAX_FICHIER_OCTETS) {
    return {
      ok: false,
      motif: `Ce fichier fait ${formaterTaille(candidat.taille_octets)} : la taille maximale acceptée est de ${TAILLE_MAX_FICHIER_MO} Mo.`,
    };
  }

  const mime = deduireMime(nom, candidat.mime_fourni);
  if (!mime || (estAttestation && !isAllowedAttestationMime(mime))) {
    return {
      ok: false,
      motif: estAttestation
        ? MESSAGE_ATTESTATION_FORMAT_INVALIDE
        : `Ce format de fichier n’est pas accepté pour ce dépôt (${LIBELLE_FORMATS}).`,
    };
  }

  return {
    ok: true,
    selection: { uri: candidat.uri, nom, mime_type: mime, taille_octets: candidat.taille_octets },
  };
}

/** Nom de fichier affiché dans la tuile d'envoi. */
function nomFichierAffiche(envoi: EnvoiFichier): string | undefined {
  if (envoi.selection) return envoi.selection.nom;
  if (envoi.depose) return envoi.depose.chemin_stockage.split('/').pop();
  return undefined;
}

/** Message affiché sous la tuile : aide, progression, succès ou erreur. */
function messageEnvoi(envoi: EnvoiFichier, aide: string): string {
  if (envoi.statut === 'erreur') {
    return envoi.erreur ?? 'L’envoi a échoué. Vous pouvez réessayer.';
  }
  if (envoi.statut === 'reussi' && envoi.depose) {
    return `Fichier accepté (${formaterTaille(envoi.depose.taille_octets)}).`;
  }
  if (envoi.statut === 'enCours') {
    return 'Envoi en cours : ne quittez pas cet écran.';
  }
  return aide;
}

export default function DepotOeuvreScreen() {
  const parametres = useLocalSearchParams<{ oeuvre_id?: string }>();
  const oeuvreIdParam = parametreTexte(parametres.oeuvre_id);

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [messageVide, setMessageVide] = useState('');

  const [oeuvreId, setOeuvreId] = useState<string | null>(null);
  const [optionsCategories, setOptionsCategories] = useState<OptionSelect[]>([]);
  const [titre, setTitre] = useState('');
  const [categorieId, setCategorieId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [annee, setAnnee] = useState('');
  const [envoiFichier, setEnvoiFichier] = useState<EnvoiFichier>(ENVOI_VIDE);
  const [envoiAttestation, setEnvoiAttestation] = useState<EnvoiFichier>(ENVOI_VIDE);

  const [erreurTitre, setErreurTitre] = useState<string | null>(null);
  const [erreurCategorie, setErreurCategorie] = useState<string | null>(null);
  const [erreurAnnee, setErreurAnnee] = useState<string | null>(null);

  const [brouillonEnCours, setBrouillonEnCours] = useState(false);
  const [messageBrouillon, setMessageBrouillon] = useState<string | null>(null);
  const [information, setInformation] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [oeuvreEnvoyee, setOeuvreEnvoyee] = useState<Oeuvre | null>(null);

  /** Vrai tant que l'écran est affiché (aucun `setState` après démontage). */
  const monteRef = useRef(true);
  /** Contrôleur d'annulation de l'envoi en cours (bouton « Annuler l'envoi »). */
  const abandonRef = useRef<AbortController | null>(null);

  useEffect(() => {
    monteRef.current = true;
    return () => {
      monteRef.current = false;
      abandonRef.current?.abort();
    };
  }, []);

  /**
   * Charge les catégories ACTIVES du membre et, si un `oeuvre_id` est fourni, le
   * brouillon à reprendre (seul un `BROUILLON` se complète et s’envoie ici :
   * les corrections d’une œuvre déjà envoyée passent par `modifier-oeuvre`).
   */
  const chargerDepot = useCallback(async () => {
    setEtat('chargement');
    setMessageErreur('');
    setErreurEnvoi(null);
    setMessageBrouillon(null);

    try {
      const [appartenances, referentiel] = await Promise.all([
        memberRepository.listerCategoriesMembre(),
        publicContentService.listerCategories(),
      ]);

      if (!appartenances.ok) {
        setMessageErreur(traduireErreur(appartenances.erreur));
        setEtat('erreur');
        return;
      }
      if (!referentiel.ok) {
        setMessageErreur(traduireErreur(referentiel.erreur));
        setEtat('erreur');
        return;
      }

      const options = appartenances.valeur.membre_categories
        .filter((element) => element.statut === 'ACTIVE')
        .map(
          (element) =>
            referentiel.valeur.find((categorie) => categorie.id === element.categorie_id) ?? null,
        )
        .filter((categorie): categorie is Categorie => categorie !== null)
        .map((categorie) => ({
          valeur: categorie.id,
          libelle: categorie.libelle,
          description: categorie.description ?? undefined,
        }));

      if (options.length === 0) {
        setOptionsCategories([]);
        setMessageVide(
          'Aucune catégorie active n’est rattachée à votre profil. Demandez d’abord une catégorie depuis votre profil pour pouvoir déposer une œuvre.',
        );
        setEtat('vide');
        return;
      }

      if (!oeuvreIdParam) {
        setOptionsCategories(options);
        setEtat('contenu');
        return;
      }

      const reponse = await memberRepository.obtenirOeuvre(oeuvreIdParam);

      if (!reponse.ok) {
        if (
          reponse.erreur.type === 'metier' &&
          reponse.erreur.code === CODES_ERREUR_MEMBRE.OEUVRE_INTROUVABLE
        ) {
          setMessageVide(reponse.erreur.message);
          setEtat('vide');
          return;
        }
        setMessageErreur(traduireErreur(reponse.erreur));
        setEtat('erreur');
        return;
      }

      const brouillon = reponse.valeur;
      if (brouillon.statut !== 'BROUILLON') {
        setMessageVide(
          'Cette œuvre a déjà été envoyée à l’OMDA : elle n’est plus modifiable depuis cet écran.',
        );
        setEtat('vide');
        return;
      }

      /** La catégorie du brouillon reste proposée, même si l’appartenance a changé. */
      const categorieConnue = options.some((option) => option.valeur === brouillon.categorie_id);
      const categorieBrouillon = referentiel.valeur.find(
        (categorie) => categorie.id === brouillon.categorie_id,
      );

      setOptionsCategories(
        categorieConnue || !categorieBrouillon
          ? options
          : [
              ...options,
              {
                valeur: categorieBrouillon.id,
                libelle: categorieBrouillon.libelle,
                description: categorieBrouillon.description ?? undefined,
              },
            ],
      );
      setOeuvreId(brouillon.id);
      setTitre(brouillon.titre);
      setCategorieId(brouillon.categorie_id);
      setDescription(brouillon.description ?? '');
      setAnnee(brouillon.annee ? `${brouillon.annee}` : '');

      if (brouillon.chemin_fichier && brouillon.mime_type && brouillon.taille_octets) {
        setEnvoiFichier({
          statut: 'reussi',
          progression: 100,
          selection: null,
          depose: {
            chemin_stockage: brouillon.chemin_fichier,
            mime_type: brouillon.mime_type,
            taille_octets: brouillon.taille_octets,
          },
          erreur: null,
        });
      }

      setEtat('contenu');
    } catch {
      setMessageErreur(
        'Une erreur inattendue est survenue pendant le chargement du dépôt. Veuillez réessayer.',
      );
      setEtat('erreur');
    }
  }, [oeuvreIdParam]);

  /** Chargement initial : sans cet appel, l'écran resterait bloqué. */
  useEffect(() => {
    void chargerDepot();
  }, [chargerDepot]);

  /* -------------------------------------------------------- Moteur d'envoi */

  /** Applique une modification à l'envoi visé (fichier de l'œuvre ou attestation). */
  const definirEnvoi = useCallback((cible: CibleEnvoi, maj: Partial<EnvoiFichier>) => {
    if (cible === 'fichier') {
      setEnvoiFichier((precedent) => ({ ...precedent, ...maj }));
      return;
    }
    setEnvoiAttestation((precedent) => ({ ...precedent, ...maj }));
  }, []);

  /**
   * Téléverse un fichier dans le bucket `oeuvres` (progression 0 → 100, annulation
   * possible). Le fichier ne devient « accepté » qu'après la réponse du service.
   */
  const televerser = useCallback(
    async (cible: CibleEnvoi, selection: FichierSelectionne) => {
      const controleur = new AbortController();
      abandonRef.current = controleur;

      definirEnvoi(cible, {
        statut: 'enCours',
        progression: 0,
        selection,
        depose: null,
        erreur: null,
      });

      const envoi = await memberRepository.televerserFichier(
        {
          bucket: BUCKET_OEUVRES,
          chemin_stockage: cheminStockage(selection.nom),
          fichier_uri: selection.uri,
          nom_fichier: selection.nom,
          mime_type: selection.mime_type,
          taille_octets: selection.taille_octets,
        },
        {
          onProgression: (pourcentage) => {
            if (!monteRef.current) return;
            definirEnvoi(cible, { progression: pourcentage });
          },
          signal: controleur.signal,
        },
      );

      abandonRef.current = null;
      if (!monteRef.current) return;

      if (!envoi.ok) {
        if (
          envoi.erreur.type === 'metier' &&
          envoi.erreur.code === CODES_ERREUR_DONNEES.TELEVERSEMENT_ANNULE
        ) {
          definirEnvoi(cible, {
            statut: 'vide',
            progression: 0,
            selection: null,
            depose: null,
            erreur: null,
          });
          setInformation(
            'Envoi annulé : le fichier n’a pas été transmis. Vous pouvez le renvoyer quand vous le souhaitez.',
          );
          return;
        }

        definirEnvoi(cible, {
          statut: 'erreur',
          progression: 0,
          selection,
          depose: null,
          erreur: messageErreurEnvoi(envoi.erreur),
        });
        return;
      }

      setInformation(null);
      definirEnvoi(cible, {
        statut: 'reussi',
        progression: 100,
        selection,
        depose: envoi.valeur,
        erreur: null,
      });
    },
    [definirEnvoi],
  );

  /** Sélection d'un document : formats et taille contrôlés AVANT tout envoi. */
  const selectionnerFichier = useCallback(
    async (cible: CibleEnvoi) => {
      const estAttestation = cible === 'attestation';
      try {
        const resultat = await DocumentPicker.getDocumentAsync({
          type: estAttestation ? [...TYPES_MIME_ATTESTATION] : [...TYPES_MIME_AUTORISES.oeuvres],
          multiple: false,
          copyToCacheDirectory: true,
        });

        if (resultat.canceled) return;

        const actif = resultat.assets[0];
        if (!actif) return;

        const validation = validerCandidat(
          {
            uri: actif.uri,
            nom: actif.name ?? 'fichier',
            mime_fourni: actif.mimeType,
            taille_octets: actif.size ?? 0,
          },
          estAttestation,
        );

        if (!validation.ok) {
          definirEnvoi(cible, {
            statut: 'erreur',
            progression: 0,
            selection: null,
            depose: null,
            erreur: validation.motif,
          });
          return;
        }

        await televerser(cible, validation.selection);
      } catch (erreur) {
        console.warn('[Dépôt œuvre] Sélection de fichier impossible :', erreur);
        if (!monteRef.current) return;
        definirEnvoi(cible, {
          statut: 'erreur',
          progression: 0,
          selection: null,
          depose: null,
          erreur: 'La sélection du fichier a échoué. Veuillez réessayer.',
        });
      }
    },
    [definirEnvoi, televerser],
  );

  /** Reprise après une coupure : relance l'envoi retenu, sinon rouvre le sélecteur. */
  const reessayerEnvoi = useCallback(
    (cible: CibleEnvoi, envoi: EnvoiFichier) => {
      if (envoi.selection) {
        void televerser(cible, envoi.selection);
        return;
      }
      void selectionnerFichier(cible);
    },
    [selectionnerFichier, televerser],
  );

  const supprimerEnvoi = useCallback(
    (cible: CibleEnvoi) => {
      definirEnvoi(cible, {
        statut: 'vide',
        progression: 0,
        selection: null,
        depose: null,
        erreur: null,
      });
      setInformation(null);
    },
    [definirEnvoi],
  );

  /** Annulation d'un envoi en cours (le service renvoie `TELEVERSEMENT_ANNULE`). */
  const annulerEnvoi = useCallback(() => {
    abandonRef.current?.abort();
  }, []);

  /* ------------------------------------------- Validation et enregistrement */

  const anneeSaisie = useMemo(() => {
    const valeur = Number.parseInt(annee.trim(), 10);
    return Number.isNaN(valeur) ? null : valeur;
  }, [annee]);

  /** Bornes de l'année (affichées dans l'aide du champ). */
  const anneeMax = useMemo(() => new Date().getFullYear(), []);

  /** Points à compléter avant l'envoi (messages explicites, ordre du formulaire). */
  const manques = useMemo(() => {
    const liste: string[] = [];

    if (!titre.trim()) {
      liste.push('Indiquez le titre de votre œuvre.');
    }
    if (!categorieId) {
      liste.push('Choisissez la catégorie de votre œuvre.');
    }
    if (
      annee.trim() &&
      (anneeSaisie === null || anneeSaisie < ANNEE_MINIMUM || anneeSaisie > anneeMax)
    ) {
      liste.push(`L’année doit être comprise entre ${ANNEE_MINIMUM} et ${anneeMax}.`);
    }
    if (!envoiFichier.depose) {
      liste.push('Joignez le fichier de votre œuvre.');
    }
    if (!envoiAttestation.depose) {
      liste.push('Joignez l’attestation de diffusion de votre œuvre.');
    }

    return liste;
  }, [annee, anneeSaisie, anneeMax, categorieId, envoiAttestation.depose, envoiFichier.depose, titre]);

  /**
   * Crée le brouillon (première fois) ou le met à jour, puis renvoie son
   * identifiant. Aucun paiement n'est déclenché ici.
   */
  const sauvegarderBrouillon = useCallback(async (): Promise<string | null> => {
    setErreurEnvoi(null);

    if (!titre.trim()) {
      setErreurTitre('Indiquez le titre de votre œuvre.');
      return null;
    }
    setErreurTitre(null);

    if (!categorieId) {
      setErreurCategorie('Choisissez la catégorie de votre œuvre.');
      return null;
    }
    setErreurCategorie(null);

    if (
      annee.trim() &&
      (anneeSaisie === null || anneeSaisie < ANNEE_MINIMUM || anneeSaisie > anneeMax)
    ) {
      setErreurAnnee(`L’année doit être comprise entre ${ANNEE_MINIMUM} et ${anneeMax}.`);
      return null;
    }
    setErreurAnnee(null);

    const entree = {
      titre: titre.trim(),
      categorie_id: categorieId,
      description: description.trim() ? description.trim() : null,
      annee: anneeSaisie,
    };

    const reponse = oeuvreId
      ? await memberRepository.mettreAJourOeuvre(oeuvreId, entree)
      : await memberRepository.creerOeuvre(entree);

    if (!monteRef.current) return null;

    if (!reponse.ok) {
      setErreurEnvoi(traduireErreur(reponse.erreur));
      return null;
    }

    setOeuvreId(reponse.valeur.id);
    return reponse.valeur.id;
  }, [annee, anneeMax, anneeSaisie, categorieId, description, oeuvreId, titre]);

  /** « Enregistrer le brouillon » : l'œuvre reste `BROUILLON`, aucune notification OMDA. */
  const enregistrerBrouillon = useCallback(async () => {
    setBrouillonEnCours(true);
    setMessageBrouillon(null);

    const id = await sauvegarderBrouillon();

    if (!monteRef.current) return;
    setBrouillonEnCours(false);

    if (!id) return;
    setMessageBrouillon(
      'Brouillon enregistré. Vous pouvez le reprendre à tout moment depuis la liste de vos œuvres.',
    );
  }, [sauvegarderBrouillon]);

  /**
   * « Envoyer mon œuvre » : brouillon (créé ou mis à jour) puis `soumettreOeuvre`.
   * ⚠️ Statut final `ENVOYEE` : AUCUN paiement, aucune notification de succès
   * avant la validation de l'œuvre par l'OMDA.
   */
  const envoyerOeuvre = useCallback(async () => {
    if (manques.length > 0) {
      setErreurEnvoi(manques.map((element) => `• ${element}`).join('\n'));
      return;
    }

    setEnvoiEnCours(true);
    const id = await sauvegarderBrouillon();

    if (!monteRef.current) return;

    if (!id || !envoiFichier.depose || !envoiAttestation.depose) {
      setEnvoiEnCours(false);
      return;
    }

    const reponse = await memberRepository.soumettreOeuvre({
      oeuvre_id: id,
      fichier: envoiFichier.depose,
      attestations: [envoiAttestation.depose],
    });

    if (!monteRef.current) return;
    setEnvoiEnCours(false);

    if (!reponse.ok) {
      setErreurEnvoi(traduireErreur(reponse.erreur));
      return;
    }

    setOeuvreEnvoyee(reponse.valeur);
    setEtat('succes');
  }, [envoiAttestation.depose, envoiFichier.depose, manques, sauvegarderBrouillon]);

  /* --------------------------------------------------------------- Actions */

  const retourOeuvres = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/(tabs)/oeuvres');
  }, []);

  const ouvrirFicheEnvoyee = useCallback(() => {
    if (!oeuvreEnvoyee) return;
    router.push({ pathname: '/(membre)/fiche-oeuvre', params: { oeuvre_id: oeuvreEnvoyee.id } });
  }, [oeuvreEnvoyee]);

  const envoiEnCoursSurEcran = envoiFichier.statut === 'enCours' || envoiAttestation.statut === 'enCours';

  /* ------------------------------------------------------ États de l'écran */

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Dépôt d’une œuvre" sousTitre="Espace membre">
        <LoadingState message="Préparation du dépôt…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Dépôt d’une œuvre" sousTitre="Espace membre">
        <ErrorState
          titre="Dépôt indisponible"
          message={messageErreur}
          libelleAction="Réessayer"
          onReessayer={() => void chargerDepot()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide') {
    return (
      <ScreenContainer titre="Dépôt d’une œuvre" sousTitre="Espace membre">
        <EmptyState
          titre="Dépôt impossible"
          message={messageVide}
          icone="folder-open"
          actionLibelle="Voir mes œuvres"
          onAction={retourOeuvres}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'succes' && oeuvreEnvoyee) {
    return (
      <ScreenContainer titre="Dépôt d’une œuvre" sousTitre="Espace membre">
        <View className="w-full gap-4 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <StatusPill statut="pending" libelle="Œuvre envoyée à l’OMDA" />

          <Text className="text-lg font-bold text-omda-black">{oeuvreEnvoyee.titre}</Text>

          <Text className="text-base text-omda-black">
            Votre œuvre a bien été transmise à l’OMDA. Un agent va la vérifier : vous serez informé
            du résultat depuis vos notifications.
          </Text>

          <InfoBanner
            variante="info"
            titre="Aucun paiement à cette étape"
            message="L’envoi d’une œuvre est gratuit. Les frais de dépôt ne sont proposés qu’après la validation de l’œuvre, depuis sa fiche."
          />

          <Button
            libelle="Voir la fiche de mon œuvre"
            icone="file-lines"
            pleineLargeur
            onPress={ouvrirFicheEnvoyee}
          />
          <Button
            libelle="Retour à mes œuvres"
            variante="secondary"
            icone="folder-open"
            pleineLargeur
            onPress={retourOeuvres}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Dépôt d’une œuvre" sousTitre="Espace membre">
      <Text className="text-base text-omda-textGray">
        Renseignez votre œuvre, joignez son fichier et son attestation de diffusion. L’envoi ne
        déclenche aucun paiement : les frais de dépôt ne seront proposés qu’après la validation de
        l’œuvre par l’OMDA.
      </Text>

      <View className="mt-5 gap-4">
        <TextField
          libelle="Titre de l’œuvre"
          valeur={titre}
          onChangeValeur={setTitre}
          placeholder="Ex. La varangue"
          obligatoire
          maxCaracteres={150}
          erreur={erreurTitre ?? undefined}
          desactive={envoiEnCours}
        />

        <SelectField
          libelle="Catégorie"
          options={optionsCategories}
          valeur={categorieId}
          onChangeValeur={setCategorieId}
          obligatoire
          erreur={erreurCategorie ?? undefined}
          aide="Catégories actives de votre profil, fournies par le serveur OMDA."
          desactive={envoiEnCours}
        />

        <TextField
          libelle="Description (facultatif)"
          valeur={description}
          onChangeValeur={setDescription}
          placeholder="Présentez brièvement votre œuvre."
          multiligne
          desactive={envoiEnCours}
        />

        <TextField
          libelle="Année de création (facultatif)"
          valeur={annee}
          onChangeValeur={setAnnee}
          clavier="number-pad"
          maxCaracteres={4}
          aide={`Entre ${ANNEE_MINIMUM} et ${anneeMax}.`}
          erreur={erreurAnnee ?? undefined}
          desactive={envoiEnCours}
        />
      </View>

      <View className="mt-6 gap-4">
        <UploadTile
          libelle="Fichier de l’œuvre"
          obligatoire
          statut={envoiFichier.statut}
          nomFichier={nomFichierAffiche(envoiFichier)}
          progression={envoiFichier.progression}
          message={messageEnvoi(
            envoiFichier,
            `Formats acceptés : ${LIBELLE_FORMATS} — ${TAILLE_MAX_FICHIER_MO} Mo maximum.`,
          )}
          onSelectionner={() => void selectionnerFichier('fichier')}
          onReessayer={() => reessayerEnvoi('fichier', envoiFichier)}
          onRemplacer={() => void selectionnerFichier('fichier')}
          onSupprimer={() => supprimerEnvoi('fichier')}
        />

        <UploadTile
          libelle="Attestation de diffusion"
          obligatoire
          statut={envoiAttestation.statut}
          nomFichier={nomFichierAffiche(envoiAttestation)}
          progression={envoiAttestation.progression}
          message={messageEnvoi(envoiAttestation, AIDE_ATTESTATION_FORMATS)}
          onSelectionner={() => void selectionnerFichier('attestation')}
          onReessayer={() => reessayerEnvoi('attestation', envoiAttestation)}
          onRemplacer={() => void selectionnerFichier('attestation')}
          onSupprimer={() => supprimerEnvoi('attestation')}
        />

        {envoiEnCoursSurEcran ? (
          <Button
            libelle="Annuler l’envoi"
            variante="secondary"
            icone="xmark"
            pleineLargeur
            onPress={annulerEnvoi}
          />
        ) : null}
      </View>

      {information ? (
        <View className="mt-4">
          <InfoBanner variante="info" titre="Envoi interrompu" message={information} />
        </View>
      ) : null}

      {messageBrouillon ? (
        <View className="mt-4">
          <InfoBanner variante="info" titre="Brouillon enregistré" message={messageBrouillon} />
        </View>
      ) : null}

      {manques.length > 0 ? (
        <View className="mt-6">
          <InfoBanner
            variante="pending"
            titre="Dépôt incomplet"
            message={manques.map((element) => `• ${element}`).join('\n')}
          />
        </View>
      ) : (
        <View className="mt-6">
          <InfoBanner
            variante="pending"
            titre="Dépôt prêt à être envoyé"
            message="Titre, catégorie, fichier et attestation de diffusion sont réunis. Vous pouvez envoyer votre œuvre : aucun paiement n’est demandé à cette étape."
          />
        </View>
      )}

      {erreurEnvoi ? (
        <View className="mt-4">
          <InfoBanner
            variante="error"
            titre="Envoi impossible"
            message={erreurEnvoi}
            actionLibelle="Réessayer"
            onAction={() => void envoyerOeuvre()}
          />
        </View>
      ) : null}

      <View className="mt-8 gap-3">
        <Button
          libelle="Envoyer mon œuvre"
          icone="paper-plane"
          pleineLargeur
          chargement={envoiEnCours}
          desactive={manques.length > 0 || envoiEnCours || envoiEnCoursSurEcran}
          onPress={() => void envoyerOeuvre()}
        />
        <Button
          libelle="Enregistrer le brouillon"
          variante="secondary"
          icone="floppy-disk"
          pleineLargeur
          chargement={brouillonEnCours}
          desactive={envoiEnCours}
          onPress={() => void enregistrerBrouillon()}
        />
        <Button
          libelle="Mes œuvres"
          variante="secondary"
          icone="folder-open"
          pleineLargeur
          desactive={envoiEnCours}
          onPress={retourOeuvres}
        />
      </View>
    </ScreenContainer>
  );
}
