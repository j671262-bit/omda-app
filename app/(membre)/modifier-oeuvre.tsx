import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  SelectField,
  StatusPill,
  TextField,
  UploadTile,
  type OptionSelect,
  type StatutPill,
  type StatutUpload,
} from '../../src/components/ui';
import {
  STATUTS_OEUVRE_MODIFIABLES,
  TAILLE_MAX_FICHIER_MO,
  TAILLE_MAX_FICHIER_OCTETS,
  TYPES_MIME_ATTESTATION,
  TYPES_MIME_AUTORISES,
  type Categorie,
  type Oeuvre,
  type StatutOeuvre,
  type TypeMime,
} from '../../src/models';
import { CODES_ERREUR_MEMBRE } from '../../src/services/contracts';
import type {
  ErreurApp,
  FichierDepose,
  MettreAJourOeuvreEntree,
} from '../../src/services/contracts';
import { memberRepository, publicContentService } from '../../src/services/factory';
import { CODES_ERREUR_DONNEES } from '../../src/services/contracts';
import {
  AIDE_ATTESTATION_FORMATS,
  MESSAGE_ATTESTATION_FORMAT_INVALIDE,
  isAllowedAttestationMime,
} from '../../src/utils';

/**
 * Écran « Modifier l’œuvre » (hors onglets, ouvert depuis `fiche-oeuvre`).
 *
 * Règles métier appliquées :
 * - une œuvre reste corrigeable tant que l’OMDA n’a pas statué
 *   (`STATUTS_OEUVRE_MODIFIABLES` : `BROUILLON`, `ENVOYEE`,
 *   `EN_COURS_DE_VALIDATION`) ; tout autre statut affiche un état vide explicite ;
 * - le statut et la date d’envoi viennent du serveur et ne sont JAMAIS
 *   modifiables : l’écran les affiche en lecture seule ;
 * - le fichier de l’œuvre et l’attestation de diffusion sont affichés tels
 *   qu’enregistrés, puis REMPLAÇABLES un par un (jamais supprimables, règle
 *   métier 8) : seuls les documents réellement remplacés sont transmis ;
 * - seuls les champs modifiés partent au service (`mettreAJourOeuvre`) : aucun
 *   statut forcé, aucun paiement, aucun montant calculé dans l’écran ;
 * - 4 états obligatoires : chargement / erreur + « Réessayer » / vide / contenu.
 */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Bucket de destination des œuvres et de leurs attestations. */
const BUCKET_OEUVRES = 'oeuvres';

/** Formats acceptés, rappelés dans les messages. */
const LIBELLE_FORMATS = 'MP3, WAV, PDF, JPEG ou PNG';

/** Bornes de l’année de création d’une œuvre. */
const ANNEE_MINIMUM = 1900;

/** Libellés et pastilles des statuts d’œuvre (lecture seule ici). */
const STATUTS_AFFICHES: Record<StatutOeuvre, { variante: StatutPill; libelle: string }> = {
  BROUILLON: { variante: 'pending', libelle: 'Brouillon' },
  ENVOYEE: { variante: 'pending', libelle: 'Envoyée à l’OMDA' },
  EN_COURS_DE_VALIDATION: { variante: 'pending', libelle: 'En cours de validation' },
  VALIDEE: { variante: 'info', libelle: 'Validée — frais de dépôt à régler' },
  REJETEE: { variante: 'error', libelle: 'Rejetée' },
  DEPOT_FINALISE: { variante: 'success', libelle: 'Dépôt finalisé' },
};

/** Fichier retenu localement en attendant la confirmation du service. */
type FichierSelectionne = {
  uri: string;
  nom: string;
  mime_type: TypeMime;
  taille_octets: number;
};

/** Suivi d’un envoi : statut, progression, fichier retenu et référence déposée. */
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

/** Cible d’un envoi de fichier sur cet écran. */
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

/** Déduit un type MIME autorisé à partir du type système, sinon de l’extension. */
function deduireMime(nomFichier: string, mimeFourni: string | null | undefined): TypeMime | null {
  const propre = (mimeFourni ?? '').trim().toLowerCase();
  const normalise = propre === 'image/jpg' ? 'image/jpeg' : propre;
  if ((TYPES_MIME_AUTORISES.oeuvres as readonly string[]).includes(normalise)) {
    return normalise as TypeMime;
  }
  const extension = nomFichier.split('.').pop()?.trim().toLowerCase() ?? '';
  return MIME_PAR_EXTENSION[extension] ?? null;
}

/** Chemin de stockage transmis au service de téléversement (dossier des corrections). */
function cheminStockage(nomFichier: string): string {
  const nomPropre = nomFichier.replace(/[^\w.\-]+/g, '_') || 'fichier';
  return `${BUCKET_OEUVRES}/corrections/${Date.now().toString(36)}-${nomPropre}`;
}

/** Taille lisible par l’utilisateur (Mo, une décimale). */
function formaterTaille(octets: number): string {
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

/** Nom de fichier lisible à partir d’un chemin de stockage. */
function nomFichierDepose(chemin: string | null): string {
  if (!chemin) return '';
  const parties = chemin.split('/');
  return parties[parties.length - 1] ?? chemin;
}

/** Message compréhensible selon la famille d’erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Message affiché lorsqu’un envoi de fichier échoue. */
function messageErreurEnvoi(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'La connexion a été interrompue pendant l’envoi. Vérifiez votre réseau puis réessayez.';
  }
  return 'L’envoi du fichier a échoué (service indisponible). Veuillez réessayer.';
}

/** Paramètre d’URL unique (chaîne) ou absent. */
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

/** Nom de fichier affiché dans la tuile d’envoi. */
function nomFichierAffiche(envoi: EnvoiFichier): string | undefined {
  if (envoi.selection) return envoi.selection.nom;
  if (envoi.depose) return nomFichierDepose(envoi.depose.chemin_stockage);
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

/** Champs texte confirmés par le serveur (détection des changements réels). */
type ValeursOeuvre = {
  titre: string;
  categorie_id: string;
  description: string;
  annee: string;
};

export default function ModifierOeuvreScreen() {
  const parametres = useLocalSearchParams<{ oeuvre_id?: string }>();
  const oeuvreIdParam = parametreTexte(parametres.oeuvre_id);

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [messageVide, setMessageVide] = useState('');

  const [oeuvre, setOeuvre] = useState<Oeuvre | null>(null);
  const [optionsCategories, setOptionsCategories] = useState<OptionSelect[]>([]);

  const [titre, setTitre] = useState('');
  const [categorieId, setCategorieId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [annee, setAnnee] = useState('');
  const [envoiFichier, setEnvoiFichier] = useState<EnvoiFichier>(ENVOI_VIDE);
  const [envoiAttestation, setEnvoiAttestation] = useState<EnvoiFichier>(ENVOI_VIDE);

  /** Valeurs confirmées par le serveur : seuls les écarts lui sont transmis. */
  const [origine, setOrigine] = useState<ValeursOeuvre>({
    titre: '',
    categorie_id: '',
    description: '',
    annee: '',
  });

  /** Documents réellement REMPLACÉS sur cet écran (transmis par le service). */
  const [fichierRemplace, setFichierRemplace] = useState<FichierDepose | null>(null);
  const [attestationRemplacee, setAttestationRemplacee] = useState<FichierDepose | null>(null);

  const [erreurTitre, setErreurTitre] = useState<string | null>(null);
  const [erreurCategorie, setErreurCategorie] = useState<string | null>(null);
  const [erreurAnnee, setErreurAnnee] = useState<string | null>(null);

  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [erreurEnregistrement, setErreurEnregistrement] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [information, setInformation] = useState<string | null>(null);

  /** Vrai tant que l’écran est affiché (aucun `setState` après démontage). */
  const monteRef = useRef(true);
  /** Contrôleur d’annulation de l’envoi en cours (bouton « Annuler l’envoi »). */
  const abandonRef = useRef<AbortController | null>(null);

  /**
   * Dernier état STABLE de chaque tuile : document enregistré par le serveur ou
   * remplacement déjà confirmé. C’est lui qui est réaffiché si un envoi échoue
   * ou est annulé, pour que l’affichage corresponde toujours à ce qui sera
   * enregistré.
   */
  const stablesRef = useRef<{ fichier: EnvoiFichier; attestation: EnvoiFichier }>({
    fichier: ENVOI_VIDE,
    attestation: ENVOI_VIDE,
  });

  /** Dernier état stable d’une tuile (restauré après un échec ou une annulation). */
  const etatStable = useCallback(
    (cible: CibleEnvoi): EnvoiFichier =>
      cible === 'fichier' ? stablesRef.current.fichier : stablesRef.current.attestation,
    [],
  );

  /** Mémorise le nouvel état stable d’une tuile (envoi confirmé ou enregistrement). */
  const memoriserStable = useCallback((cible: CibleEnvoi, etat: EnvoiFichier) => {
    if (cible === 'fichier') {
      stablesRef.current.fichier = etat;
      return;
    }
    stablesRef.current.attestation = etat;
  }, []);

  useEffect(() => {
    monteRef.current = true;
    return () => {
      monteRef.current = false;
      abandonRef.current?.abort();
    };
  }, []);

  /**
   * Charge l’œuvre à corriger (statut faisant foi), les catégories ACTIVES du
   * membre et l’attestation de diffusion déjà enregistrée.
   * Refus explicite si le statut n’est plus modifiable (`STATUTS_OEUVRE_MODIFIABLES`).
   */
  const chargerOeuvre = useCallback(async () => {
    if (!oeuvreIdParam) {
      setMessageVide(
        'Aucune œuvre n’a été transmise à cet écran. Revenez à la liste de vos œuvres pour en modifier une.',
      );
      setEtat('vide');
      return;
    }

    setEtat('chargement');
    setMessageErreur('');
    setErreurEnregistrement(null);
    setConfirmation(null);
    setInformation(null);

    try {
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

      const chargee = reponse.valeur;
      if (!STATUTS_OEUVRE_MODIFIABLES.includes(chargee.statut)) {
        setMessageVide(
          chargee.statut === 'REJETEE'
            ? 'Cette œuvre a été rejetée : elle n’est plus modifiable. Déposez une nouvelle œuvre corrigée depuis « Mes œuvres ».'
            : 'Cette œuvre a déjà été traitée par l’OMDA : elle n’est plus modifiable. Déposez une nouvelle œuvre si vous devez la corriger.',
        );
        setEtat('vide');
        return;
      }

      const [appartenances, referentiel, reponseAttestations] = await Promise.all([
        memberRepository.listerCategoriesMembre(),
        publicContentService.listerCategories(),
        memberRepository.listerAttestationsOeuvre(chargee.id),
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
      if (!reponseAttestations.ok) {
        setMessageErreur(traduireErreur(reponseAttestations.erreur));
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
        setMessageVide(
          'Aucune catégorie active n’est rattachée à votre profil. Demandez d’abord une catégorie depuis votre profil pour pouvoir modifier cette œuvre.',
        );
        setEtat('vide');
        return;
      }

      /** La catégorie de l’œuvre reste proposée, même si l’appartenance a changé. */
      const categorieConnue = options.some((option) => option.valeur === chargee.categorie_id);
      const categorieOeuvre = referentiel.valeur.find(
        (categorie) => categorie.id === chargee.categorie_id,
      );

      setOptionsCategories(
        categorieConnue || !categorieOeuvre
          ? options
          : [
              ...options,
              {
                valeur: categorieOeuvre.id,
                libelle: categorieOeuvre.libelle,
                description: categorieOeuvre.description ?? undefined,
              },
            ],
      );

      setOeuvre(chargee);
      setTitre(chargee.titre);
      setCategorieId(chargee.categorie_id);
      setDescription(chargee.description ?? '');
      setAnnee(chargee.annee ? `${chargee.annee}` : '');
      setOrigine({
        titre: chargee.titre,
        categorie_id: chargee.categorie_id,
        description: chargee.description ?? '',
        annee: chargee.annee ? `${chargee.annee}` : '',
      });

      /** Fichier de l’œuvre déjà enregistré (affiché, remplaçable seulement). */
      const etatFichier: EnvoiFichier =
        chargee.chemin_fichier && chargee.mime_type && chargee.taille_octets
          ? {
              statut: 'reussi',
              progression: 100,
              selection: null,
              depose: {
                chemin_stockage: chargee.chemin_fichier,
                mime_type: chargee.mime_type,
                taille_octets: chargee.taille_octets,
              },
              erreur: null,
            }
          : ENVOI_VIDE;

      /** Attestation de diffusion déjà enregistrée (règle métier 8). */
      const attestation = reponseAttestations.valeur[0];
      const etatAttestation: EnvoiFichier = attestation
        ? {
            statut: 'reussi',
            progression: 100,
            selection: null,
            depose: {
              chemin_stockage: attestation.chemin_stockage,
              mime_type: attestation.mime_type,
              taille_octets: attestation.taille_octets,
            },
            erreur: null,
          }
        : ENVOI_VIDE;

      /** États stables initiaux : repli affiché si un envoi échoue ou est annulé. */
      stablesRef.current = { fichier: etatFichier, attestation: etatAttestation };
      setEnvoiFichier(etatFichier);
      setEnvoiAttestation(etatAttestation);

      setFichierRemplace(null);
      setAttestationRemplacee(null);
      setEtat('contenu');
    } catch {
      setMessageErreur(
        'Une erreur inattendue est survenue pendant le chargement de cette œuvre. Veuillez réessayer.',
      );
      setEtat('erreur');
    }
  }, [oeuvreIdParam]);

  /** Chargement initial : sans cet appel, l’écran resterait en chargement. */
  useEffect(() => {
    void chargerOeuvre();
  }, [chargerOeuvre]);

  /* -------------------------------------------------------- Moteur d’envoi */

  /** Applique une modification à l’envoi visé (fichier de l’œuvre ou attestation). */
  const definirEnvoi = useCallback((cible: CibleEnvoi, maj: Partial<EnvoiFichier>) => {
    if (cible === 'fichier') {
      setEnvoiFichier((precedent) => ({ ...precedent, ...maj }));
      return;
    }
    setEnvoiAttestation((precedent) => ({ ...precedent, ...maj }));
  }, []);

  /**
   * Téléverse un document dans le bucket `oeuvres` (progression 0 → 100,
   * annulation possible). Le document n’est considéré comme REMPLACÉ qu’après
   * confirmation du service : un échec laisse l’ancien document en place.
   */
  const televerser = useCallback(
    async (cible: CibleEnvoi, selection: FichierSelectionne) => {
      const controleur = new AbortController();
      abandonRef.current = controleur;

      /** En cours : le document déjà en place reste le bon état de référence. */
      definirEnvoi(cible, {
        statut: 'enCours',
        progression: 0,
        selection,
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
          definirEnvoi(cible, etatStable(cible));
          setInformation(
            'Envoi annulé : le fichier n’a pas été transmis et le document déjà enregistré est conservé.',
          );
          return;
        }

        /** Échec : le dernier état stable reste affiché, le fichier est réessayable. */
        definirEnvoi(cible, {
          ...etatStable(cible),
          statut: 'erreur',
          progression: 0,
          selection,
          erreur: messageErreurEnvoi(envoi.erreur),
        });
        return;
      }

      const etatEnvoye: EnvoiFichier = {
        statut: 'reussi',
        progression: 100,
        selection,
        depose: envoi.valeur,
        erreur: null,
      };
      setInformation(null);
      setConfirmation(null);
      definirEnvoi(cible, etatEnvoye);

      /** Le remplacement confirmé devient la nouvelle référence stable. */
      memoriserStable(cible, etatEnvoye);

      /** Seuls les documents RÉELLEMENT remplacés partent à l’enregistrement. */
      if (cible === 'fichier') {
        setFichierRemplace(envoi.valeur);
      } else {
        setAttestationRemplacee(envoi.valeur);
      }
    },
    [definirEnvoi, etatStable, memoriserStable],
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
            ...etatStable(cible),
            statut: 'erreur',
            progression: 0,
            selection: null,
            erreur: validation.motif,
          });
          return;
        }

        await televerser(cible, validation.selection);
      } catch (erreur) {
        console.warn('[Modifier œuvre] Sélection de fichier impossible :', erreur);
        if (!monteRef.current) return;
        definirEnvoi(cible, {
          ...etatStable(cible),
          statut: 'erreur',
          progression: 0,
          selection: null,
          erreur: 'La sélection du fichier a échoué. Veuillez réessayer.',
        });
      }
    },
    [definirEnvoi, etatStable, televerser],
  );

  /** Reprise après une coupure : relance l’envoi retenu, sinon rouvre le sélecteur. */
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

  /** Annulation d’un envoi en cours (le service renvoie `TELEVERSEMENT_ANNULE`). */
  const annulerEnvoi = useCallback(() => {
    abandonRef.current?.abort();
  }, []);

  /* ------------------------------------------- Validation et enregistrement */

  const anneeSaisie = useMemo(() => {
    const valeur = Number.parseInt(annee.trim(), 10);
    return Number.isNaN(valeur) ? null : valeur;
  }, [annee]);

  /** Bornes de l’année (affichées dans l’aide du champ). */
  const anneeMax = useMemo(() => new Date().getFullYear(), []);

  /**
   * Points à corriger avant l’enregistrement (ordre du formulaire).
   * Les documents n’y figurent pas : une correction de texte reste possible
   * sur un brouillon — ils sont exigés pour l’ENVOI (règle métier 8).
   */
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

    return liste;
  }, [annee, anneeSaisie, anneeMax, categorieId, titre]);

  /** Documents obligatoires encore absents (fichier de l’œuvre, attestation). */
  const documentsManquants = useMemo(() => {
    const liste: string[] = [];
    if (!envoiFichier.depose) liste.push('le fichier de l’œuvre');
    if (!envoiAttestation.depose) liste.push('l’attestation de diffusion');
    return liste;
  }, [envoiAttestation.depose, envoiFichier.depose]);

  /** Champs réellement modifiés : seuls ceux-là partent au service. */
  const modifications = useMemo<MettreAJourOeuvreEntree>(() => {
    const entree: MettreAJourOeuvreEntree = {};
    const titrePropre = titre.trim();
    const descriptionPropre = description.trim();

    if (titrePropre !== origine.titre) {
      entree.titre = titrePropre;
    }
    if (categorieId && categorieId !== origine.categorie_id) {
      entree.categorie_id = categorieId;
    }
    if (descriptionPropre !== origine.description) {
      entree.description = descriptionPropre ? descriptionPropre : null;
    }
    if (annee.trim() !== origine.annee) {
      entree.annee = anneeSaisie;
    }
    if (fichierRemplace) {
      entree.fichier = fichierRemplace;
    }
    if (attestationRemplacee) {
      entree.attestation = attestationRemplacee;
    }

    return entree;
  }, [
    annee,
    anneeSaisie,
    attestationRemplacee,
    categorieId,
    description,
    fichierRemplace,
    origine,
    titre,
  ]);

  /** Vrai tant qu’aucune correction n’a été saisie : rien n’est envoyé. */
  const aucunChangement = useMemo(
    () => Object.keys(modifications).length === 0,
    [modifications],
  );

  /**
   * « Enregistrer les modifications » : seuls les champs corrigés et les
   * documents réellement remplacés sont transmis. Le statut, la date d’envoi et
   * la décision de l’OMDA ne sont jamais touchés et aucun paiement n’est
   * déclenché (le paiement des frais de dépôt reste réservé à `VALIDEE`).
   */
  const enregistrerModifications = useCallback(async () => {
    if (!oeuvre) return;

    setErreurEnregistrement(null);
    setConfirmation(null);
    setInformation(null);

    if (!titre.trim()) {
      setErreurTitre('Indiquez le titre de votre œuvre.');
      return;
    }
    setErreurTitre(null);

    if (!categorieId) {
      setErreurCategorie('Choisissez la catégorie de votre œuvre.');
      return;
    }
    setErreurCategorie(null);

    if (
      annee.trim() &&
      (anneeSaisie === null || anneeSaisie < ANNEE_MINIMUM || anneeSaisie > anneeMax)
    ) {
      setErreurAnnee(`L’année doit être comprise entre ${ANNEE_MINIMUM} et ${anneeMax}.`);
      return;
    }
    setErreurAnnee(null);

    if (aucunChangement) {
      setInformation(
        'Aucune modification à enregistrer : corrigez un champ ou remplacez un document.',
      );
      return;
    }

    setEnregistrementEnCours(true);
    const reponse = await memberRepository.mettreAJourOeuvre(oeuvre.id, modifications);

    if (!monteRef.current) return;
    setEnregistrementEnCours(false);

    if (!reponse.ok) {
      setErreurEnregistrement(traduireErreur(reponse.erreur));
      return;
    }

    const aJour = reponse.valeur;
    setOeuvre(aJour);
    setOrigine({
      titre: aJour.titre,
      categorie_id: aJour.categorie_id,
      description: aJour.description ?? '',
      annee: aJour.annee ? `${aJour.annee}` : '',
    });
    setTitre(aJour.titre);
    setCategorieId(aJour.categorie_id);
    setDescription(aJour.description ?? '');
    setAnnee(aJour.annee ? `${aJour.annee}` : '');

    /** Les documents remplacés deviennent la nouvelle référence enregistrée. */
    const fichierAjour: EnvoiFichier = fichierRemplace
      ? {
          statut: 'reussi',
          progression: 100,
          selection: null,
          depose: fichierRemplace,
          erreur: null,
        }
      : envoiFichier;
    const attestationAjour: EnvoiFichier = attestationRemplacee
      ? {
          statut: 'reussi',
          progression: 100,
          selection: null,
          depose: attestationRemplacee,
          erreur: null,
        }
      : envoiAttestation;

    stablesRef.current = { fichier: fichierAjour, attestation: attestationAjour };
    setEnvoiFichier(fichierAjour);
    setEnvoiAttestation(attestationAjour);
    setFichierRemplace(null);
    setAttestationRemplacee(null);

    setConfirmation(
      aJour.statut === 'BROUILLON'
        ? 'Modifications enregistrées : votre brouillon est à jour. Vous pouvez l’envoyer depuis sa fiche ou « Reprendre le dépôt ».'
        : 'Modifications enregistrées : l’OMDA examinera cette nouvelle version. Aucun nouveau paiement n’est demandé.',
    );
  }, [
    annee,
    anneeMax,
    anneeSaisie,
    attestationRemplacee,
    aucunChangement,
    categorieId,
    envoiAttestation,
    envoiFichier,
    fichierRemplace,
    modifications,
    oeuvre,
    titre,
  ]);

  /* --------------------------------------------------------------- Actions */

  const retourOeuvres = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/(tabs)/oeuvres');
  }, []);

  /** Retour à la fiche (statut et décision faisant foi). */
  const ouvrirFiche = useCallback(() => {
    if (!oeuvre) return;
    router.push({ pathname: '/(membre)/fiche-oeuvre', params: { oeuvre_id: oeuvre.id } });
  }, [oeuvre]);

  const envoiEnCoursSurEcran =
    envoiFichier.statut === 'enCours' || envoiAttestation.statut === 'enCours';

  /* ------------------------------------------------------ États de l’écran */

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Modifier l’œuvre" sousTitre="Espace membre">
        <LoadingState message="Chargement de votre œuvre…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Modifier l’œuvre" sousTitre="Espace membre">
        <ErrorState
          titre="Modification indisponible"
          message={messageErreur}
          libelleAction="Réessayer"
          onReessayer={() => void chargerOeuvre()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide' || !oeuvre) {
    return (
      <ScreenContainer titre="Modifier l’œuvre" sousTitre="Espace membre">
        <EmptyState
          titre="Modification impossible"
          message={messageVide}
          icone="pen-to-square"
          actionLibelle="Voir mes œuvres"
          onAction={retourOeuvres}
        />
      </ScreenContainer>
    );
  }

  const statut = STATUTS_AFFICHES[oeuvre.statut];
  const enExamen = oeuvre.statut === 'ENVOYEE' || oeuvre.statut === 'EN_COURS_DE_VALIDATION';
  const ecranOccupe = enregistrementEnCours || envoiEnCoursSurEcran;

  return (
    <ScreenContainer titre="Modifier l’œuvre" sousTitre="Espace membre">
      <Text className="text-base text-omda-textGray">
        Corrigez les informations de votre œuvre ou remplacez son fichier et son attestation de
        diffusion. Seuls les changements sont transmis ; aucun paiement n’est demandé à cette étape.
      </Text>

      <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-xl font-bold text-omda-black">{oeuvre.titre}</Text>
        <View className="mt-3">
          <StatusPill statut={statut.variante} libelle={statut.libelle} />
        </View>
        <Text className="mt-3 text-sm text-omda-textGray">
          Statut et décision de l’OMDA : lecture seule. Aucun changement de statut n’est possible
          depuis cet écran.
        </Text>
      </View>

      {enExamen ? (
        <View className="mt-5">
          <InfoBanner
            variante="pending"
            titre="Œuvre en cours d’examen"
            message="L’OMDA n’a pas encore rendu sa décision : vos corrections (fichier et attestation compris) restent possibles et seront prises en compte."
          />
        </View>
      ) : null}

      <View className="mt-5 gap-4">
        <TextField
          libelle="Titre de l’œuvre"
          valeur={titre}
          onChangeValeur={setTitre}
          placeholder="Ex. La varangue"
          obligatoire
          maxCaracteres={150}
          erreur={erreurTitre ?? undefined}
          desactive={ecranOccupe}
        />

        <SelectField
          libelle="Catégorie"
          options={optionsCategories}
          valeur={categorieId}
          onChangeValeur={setCategorieId}
          obligatoire
          erreur={erreurCategorie ?? undefined}
          aide="Catégories actives de votre profil, fournies par le serveur OMDA."
          desactive={ecranOccupe}
        />

        <TextField
          libelle="Description (facultatif)"
          valeur={description}
          onChangeValeur={setDescription}
          placeholder="Présentez brièvement votre œuvre."
          multiligne
          desactive={ecranOccupe}
        />

        <TextField
          libelle="Année de création (facultatif)"
          valeur={annee}
          onChangeValeur={setAnnee}
          clavier="number-pad"
          maxCaracteres={4}
          aide={`Entre ${ANNEE_MINIMUM} et ${anneeMax}.`}
          erreur={erreurAnnee ?? undefined}
          desactive={ecranOccupe}
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
            `Remplacez-le seulement si nécessaire — ${LIBELLE_FORMATS}, ${TAILLE_MAX_FICHIER_MO} Mo maximum.`,
          )}
          onSelectionner={() => void selectionnerFichier('fichier')}
          onReessayer={() => reessayerEnvoi('fichier', envoiFichier)}
          onRemplacer={() => void selectionnerFichier('fichier')}
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
        />

        <Text className="text-sm text-omda-textGray">
          Un document déposé n’est jamais supprimé : il peut uniquement être remplacé.
        </Text>

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
          <InfoBanner variante="info" titre="Information" message={information} />
        </View>
      ) : null}

      {confirmation ? (
        <View className="mt-4">
          <InfoBanner
            variante="success"
            titre="Modifications enregistrées"
            message={confirmation}
          />
        </View>
      ) : null}

      {manques.length > 0 ? (
        <View className="mt-6">
          <InfoBanner
            variante="pending"
            titre="Modification incomplète"
            message={manques.map((element) => `• ${element}`).join('\n')}
          />
        </View>
      ) : (
        <View className="mt-6">
          <InfoBanner
            variante={aucunChangement ? 'info' : 'pending'}
            titre={aucunChangement ? 'Aucune correction' : 'Corrections prêtes à être enregistrées'}
            message={
              aucunChangement
                ? 'Modifiez un champ ou remplacez un document : seuls les changements seront transmis à l’OMDA.'
                : 'Seuls les champs corrigés et les documents remplacés seront transmis à l’OMDA. Le statut de l’œuvre, lui, ne change pas.'
            }
          />
        </View>
      )}

      {documentsManquants.length > 0 ? (
        <View className="mt-4">
          <InfoBanner
            variante="pending"
            titre="Documents obligatoires"
            message={`Il manque ${documentsManquants.join(' et ')} : joignez-les avant d’envoyer l’œuvre à l’OMDA.`}
          />
        </View>
      ) : null}

      {erreurEnregistrement ? (
        <View className="mt-4">
          <InfoBanner
            variante="error"
            titre="Enregistrement impossible"
            message={erreurEnregistrement}
            actionLibelle="Réessayer"
            onAction={() => void enregistrerModifications()}
          />
        </View>
      ) : null}

      <View className="mt-8 gap-3">
        <Button
          libelle="Enregistrer les modifications"
          icone="floppy-disk"
          pleineLargeur
          chargement={enregistrementEnCours}
          desactive={manques.length > 0 || aucunChangement || ecranOccupe}
          onPress={() => void enregistrerModifications()}
        />
        <Button
          libelle="Voir la fiche de mon œuvre"
          variante="secondary"
          icone="file-lines"
          pleineLargeur
          desactive={ecranOccupe}
          onPress={ouvrirFiche}
        />
        <Button
          libelle="Mes œuvres"
          variante="secondary"
          icone="folder-open"
          pleineLargeur
          desactive={ecranOccupe}
          onPress={retourOeuvres}
        />
      </View>
    </ScreenContainer>
  );
}
