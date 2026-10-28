import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StepProgress,
  TextField,
  UploadTile,
  type NomIcone,
  type StatutUpload,
} from '../../src/components/ui';
import { useAdhesionDraft, type AdhesionDraft } from '../../src/context/AdhesionDraftContext';
import {
  TAILLE_MAX_FICHIER_MO,
  TAILLE_MAX_FICHIER_OCTETS,
  TYPES_MIME_ATTESTATION,
  TYPES_MIME_AUTORISES,
  type BucketStockage,
  type Categorie,
  type TypeMime,
  type TypePiece,
} from '../../src/models';
import type {
  ErreurApp,
  FichierDepose,
  OeuvreAdhesionEntree,
  PieceEntree,
} from '../../src/services/contracts';
import { candidateApi, publicContentService } from '../../src/services/factory';
import {
  AIDE_ATTESTATION_FORMATS,
  MESSAGE_ATTESTATION_FORMAT_INVALIDE,
  isAllowedAttestationMime,
} from '../../src/utils';

/* -------------------------------------------------------------- Constantes */

/** Nombre minimum d'œuvres exigé par la règle métier 8. */
const NOMBRE_MINIMUM_OEUVRES = 2;

/** Nombre minimum d'attestations de diffusion par œuvre (règle métier 8). */
const NOMBRE_MINIMUM_ATTESTATIONS = 1;

/** Bucket de destination des pièces justificatives. */
const BUCKET_PIECES: BucketStockage = 'pieces';

/** Bucket de destination des œuvres et de leurs attestations. */
const BUCKET_OEUVRES: BucketStockage = 'oeuvres';

/** Formats acceptés, par bucket (rappelés dans les messages d'erreur). */
const LIBELLE_FORMATS: Record<BucketStockage, string> = {
  pieces: 'JPEG, PNG ou PDF',
  oeuvres: 'MP3, WAV, PDF, JPEG ou PNG',
};

type ExigencePiece = {
  type: TypePiece;
  libelle: string;
  /** Information de format affichée sous la tuile tant qu'aucun fichier n'est envoyé. */
  aide: string;
  icone: NomIcone;
};

/** Pièces obligatoires du dossier d'adhésion (écran J). */
const PIECES_OBLIGATOIRES: ExigencePiece[] = [
  {
    type: 'PHOTO',
    libelle: 'Photo d’identité',
    aide: 'Portrait récent et net, JPEG ou PNG.',
    icone: 'camera',
  },
  {
    type: 'CIN',
    libelle: 'CIN légalisée',
    aide: 'Copie légalisée recto-verso (JPEG, PNG ou PDF).',
    icone: 'id-card',
  },
  {
    type: 'ACTE_NAISSANCE',
    libelle: 'Acte de naissance',
    aide: 'Extrait récent (JPEG, PNG ou PDF).',
    icone: 'file-lines',
  },
  {
    type: 'CERTIFICAT_RESIDENCE',
    libelle: 'Certificat de résidence',
    aide: 'Certificat de moins de 3 mois (JPEG, PNG ou PDF).',
    icone: 'house',
  },
];

/** Pièce supplémentaire exigée pour les candidats de 15 à 17 ans (règle métier 7). */
const PIECE_AUTORISATION_PARENTALE: ExigencePiece = {
  type: 'AUTORISATION_PARENTALE',
  libelle: 'Autorisation parentale',
  aide: 'Document signé par le parent ou le tuteur (JPEG, PNG ou PDF).',
  icone: 'user-shield',
};

/* ------------------------------------------------------------------- Types */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

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

/** Œuvre en cours de composition : titre + fichier + au moins 1 attestation. */
type OeuvreEnCours = {
  cle: string;
  titre: string;
  fichier: EnvoiFichier;
  attestation: EnvoiFichier;
};

/** Cible d'un envoi de fichier sur cet écran. */
type CibleEnvoi =
  | { nature: 'piece'; type: TypePiece }
  | { nature: 'oeuvre'; cle: string }
  | { nature: 'attestation'; cle: string };

/** Fichier brut renvoyé par expo-image-picker / expo-document-picker. */
type CandidatFichier = {
  uri: string;
  nom: string;
  mime_fourni: string | null;
  taille_octets: number;
};

type ResultatValidation =
  | { ok: true; selection: FichierSelectionne }
  | { ok: false; motif: string };
/* ------------------------------------------------------------- Utilitaires */

/** Extensions reconnues lorsque le système ne fournit pas de type MIME. */
const MIME_PAR_EXTENSION: Record<string, TypeMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** Tous les types MIME autorisés par le schéma (union des buckets). */
const MIMES_CONNUS: readonly string[] = [
  ...TYPES_MIME_AUTORISES.pieces,
  ...TYPES_MIME_AUTORISES.oeuvres,
];

function estMimeConnu(valeur: string): valeur is TypeMime {
  return MIMES_CONNUS.includes(valeur);
}

/** Déduit un type MIME autorisé à partir du type système, sinon de l'extension. */
function deduireMime(nomFichier: string, mimeFourni: string | null | undefined): TypeMime | null {
  const propre = (mimeFourni ?? '').trim().toLowerCase();
  const normalise = propre === 'image/jpg' ? 'image/jpeg' : propre;
  if (estMimeConnu(normalise)) {
    return normalise;
  }
  const extension = nomFichier.split('.').pop()?.trim().toLowerCase() ?? '';
  return MIME_PAR_EXTENSION[extension] ?? null;
}

/** Type MIME autorisé pour un bucket donné. */
function mimeAutorise(bucket: BucketStockage, mime: TypeMime): boolean {
  return (TYPES_MIME_AUTORISES[bucket] as readonly string[]).includes(mime);
}

/** Chemin de stockage transmis au service de téléversement. */
function cheminStockage(bucket: BucketStockage, dossier: string, nomFichier: string): string {
  const nomPropre = nomFichier.replace(/[^\w.\-]+/g, '_') || 'fichier';
  return `${bucket}/${dossier}/${Date.now().toString(36)}-${nomPropre}`;
}

/** Taille lisible par l'utilisateur (Mo, une décimale). */
function formaterTaille(octets: number): string {
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

/** Message français affichable pour une erreur de la couche data. */
function messageErreurEnvoi(erreur: ErreurApp): string {
  if (erreur.type === 'metier') {
    return erreur.message;
  }
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service est momentanément indisponible. Veuillez réessayer dans un instant.';
}

/**
 * Valide un fichier choisi : 20 Mo maximum et type MIME autorisé pour le
 * bucket. Une attestation de diffusion n'accepte que des DOCUMENTS (PDF, JPEG
 * ou PNG) : l'audio est réservé au fichier de l'œuvre.
 */
function validerCandidat(
  bucket: BucketStockage,
  candidat: CandidatFichier,
  estAttestation = false,
): ResultatValidation {
  const nom = candidat.nom.trim() || 'fichier';

  if (candidat.taille_octets > TAILLE_MAX_FICHIER_OCTETS) {
    return {
      ok: false,
      motif: `Ce fichier fait ${formaterTaille(candidat.taille_octets)} : la taille maximale acceptée est de ${TAILLE_MAX_FICHIER_MO} Mo.`,
    };
  }

  const mime = deduireMime(nom, candidat.mime_fourni);
  if (!mime || !mimeAutorise(bucket, mime) || (estAttestation && !isAllowedAttestationMime(mime))) {
    return {
      ok: false,
      motif: estAttestation
        ? MESSAGE_ATTESTATION_FORMAT_INVALIDE
        : `Ce format de fichier n’est pas accepté pour ce dépôt (${LIBELLE_FORMATS[bucket]}).`,
    };
  }

  return {
    ok: true,
    selection: {
      uri: candidat.uri,
      nom,
      mime_type: mime,
      taille_octets: candidat.taille_octets,
    },
  };
}

/** Nom de fichier affiché dans la tuile d'envoi. */
function nomFichierAffiche(envoi: EnvoiFichier): string | undefined {
  if (envoi.selection) {
    return envoi.selection.nom;
  }
  if (envoi.depose) {
    return envoi.depose.chemin_stockage.split('/').pop();
  }
  return undefined;
}

/** Message affiché sous la tuile : aide, succès ou erreur. */
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

/**
 * Étape 3 — Documents + œuvres (écran J du cahier des charges).
 *
 * Sans menu (navigation linéaire).
 * Pièces obligatoires : PHOTO, CIN légalisée, ACTE_NAISSANCE et
 * CERTIFICAT_RESIDENCE, plus AUTORISATION_PARENTALE pour les candidats de
 * 15 à 17 ans (règle métier 7).
 * Œuvres : au moins 2, chacune accompagnée d'une attestation de diffusion
 * (règle métier 8 : « 2 œuvres minimum, 1 attestation par œuvre »).
 *
 * Contraintes d'envoi : 20 Mo maximum, types MIME restreints par bucket,
 * progression visible, reprise sur erreur (coupure réseau), remplacement d'un
 * fichier déjà envoyé et suppression confirmée tant que la demande n'est pas
 * envoyée, annulation sans perte de la saisie. Les envois passent par
 * `candidateApi.televerserFichier` (contrat unique, via la
 * fabrique) et sont
 * affichés par `UploadTile`.
 *
 * Gère les 4 états obligatoires : Loading (brouillon + catégories),
 * Erreur + « Réessayer », Vide (catégorie d'adhésion introuvable) et Contenu.
 * Tout est sauvegardé dans le store persistant `AdhesionDraft` (AsyncStorage).
 */
/** Reconstruit l'état d'un envoi à partir d'un dépôt déjà confirmé. */
function envoiDepuisDepot(depose: FichierDepose | null | undefined): EnvoiFichier {
  if (!depose) {
    return ENVOI_VIDE;
  }
  return { statut: 'reussi', progression: 100, selection: null, depose, erreur: null };
}

/** Reprise des pièces déjà enregistrées dans le brouillon. */
function envoisDepuisBrouillon(pieces: PieceEntree[]): Partial<Record<TypePiece, EnvoiFichier>> {
  const envois: Partial<Record<TypePiece, EnvoiFichier>> = {};
  for (const piece of pieces) {
    envois[piece.type] = envoiDepuisDepot(piece);
  }
  return envois;
}

/** Signature stable d'une liste de pièces (comparaison avec le brouillon). */
function signaturePieces(pieces: PieceEntree[]): string {
  return JSON.stringify(
    pieces.map((piece) => [piece.type, piece.chemin_stockage, piece.mime_type, piece.taille_octets]),
  );
}

/** Signature stable d'une liste d'œuvres (comparaison avec le brouillon). */
function signatureOeuvres(oeuvres: OeuvreAdhesionEntree[]): string {
  return JSON.stringify(
    oeuvres.map((oeuvre) => [
      oeuvre.titre,
      oeuvre.categorie_id,
      oeuvre.fichier.chemin_stockage,
      oeuvre.fichier.mime_type,
      oeuvre.fichier.taille_octets,
      oeuvre.attestations.map((attestation) => [
        attestation.chemin_stockage,
        attestation.mime_type,
        attestation.taille_octets,
      ]),
    ]),
  );
}

let compteurOeuvres = 0;

/** Clé locale stable pour une ligne d'œuvre. */
function nouvelleCleOeuvre(): string {
  compteurOeuvres += 1;
  return `oeuvre-${compteurOeuvres}`;
}

/** Ligne d'œuvre vide : titre, fichier et attestation à fournir. */
function oeuvreVide(): OeuvreEnCours {
  return {
    cle: nouvelleCleOeuvre(),
    titre: '',
    fichier: ENVOI_VIDE,
    attestation: ENVOI_VIDE,
  };
}

/** Reprise des œuvres du brouillon, complétée jusqu'au minimum exigé. */
function oeuvresInitiales(oeuvres: OeuvreAdhesionEntree[]): OeuvreEnCours[] {
  const lignes: OeuvreEnCours[] = oeuvres.map((oeuvre) => ({
    cle: nouvelleCleOeuvre(),
    titre: oeuvre.titre,
    fichier: envoiDepuisDepot(oeuvre.fichier),
    attestation: envoiDepuisDepot(oeuvre.attestations[0]),
  }));

  while (lignes.length < NOMBRE_MINIMUM_OEUVRES) {
    lignes.push(oeuvreVide());
  }

  return lignes;
}

export default function DocumentsOeuvresScreen() {
  const {
    brouillon,
    estCharge,
    mettreAJourPieces,
    mettreAJourOeuvres,
    definirIdentifiantsDossier,
    estMineur15A17,
  } = useAdhesionDraft();

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [messageVide, setMessageVide] = useState('');
  const [categorieRetenue, setCategorieRetenue] = useState<Categorie | null>(null);
  const [envoisPieces, setEnvoisPieces] = useState<Partial<Record<TypePiece, EnvoiFichier>>>({});
  const [oeuvres, setOeuvres] = useState<OeuvreEnCours[]>([]);

  /** Pièces exigées : les 4 obligatoires + l'autorisation parentale si 15–17 ans. */
  const exigences = useMemo<ExigencePiece[]>(
    () =>
      estMineur15A17 ? [...PIECES_OBLIGATOIRES, PIECE_AUTORISATION_PARENTALE] : PIECES_OBLIGATOIRES,
    [estMineur15A17],
  );

  /* --------------------------------------------- Chargement des données */

  /** Charge les catégories (données dynamiques) puis reprend le brouillon local. */
  const initialiserEcran = useCallback(async (draft: AdhesionDraft) => {
    setEtat('chargement');
    setMessageErreur('');

    const resultat = await publicContentService.listerCategories();
    if (!resultat.ok) {
      setMessageErreur(
        resultat.erreur.type === 'reseau'
          ? 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet et réessayez.'
          : 'Le service des catégories d’adhésion est momentanément indisponible.',
      );
      setEtat('erreur');
      return;
    }

    const categorie =
      draft.categorie_id === null
        ? null
        : (resultat.valeur.find((element) => element.id === draft.categorie_id) ?? null);

    if (!categorie) {
      setMessageVide(
        resultat.valeur.length === 0
          ? 'Aucune catégorie d’adhésion n’est active pour le moment.'
          : 'La catégorie choisie à l’étape précédente n’est plus disponible.',
      );
      setCategorieRetenue(null);
      setEtat('vide');
      return;
    }

    setCategorieRetenue(categorie);
    setEnvoisPieces(envoisDepuisBrouillon(draft.pieces));
    setOeuvres(oeuvresInitiales(draft.oeuvres));
    setEtat('contenu');
  }, []);

  useEffect(() => {
    if (!estCharge) {
      return;
    }
    // Le brouillon (données locales relues d'AsyncStorage) n'est repris qu'au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void initialiserEcran(brouillon);
  }, [estCharge, initialiserEcran]);

  /* ------------------------------- Listes dérivées et sauvegarde continue */

  /** Pièces réellement enregistrées (envoi confirmé par le service). */
  const piecesCompletes = useMemo<PieceEntree[]>(() => {
    const liste: PieceEntree[] = [];
    for (const exigence of exigences) {
      const envoi = envoisPieces[exigence.type] ?? ENVOI_VIDE;
      if (envoi.statut === 'reussi' && envoi.depose) {
        liste.push({ type: exigence.type, ...envoi.depose });
      }
    }
    return liste;
  }, [envoisPieces, exigences]);

  /** Œuvres complètes : titre + fichier + au moins une attestation de diffusion. */
  const oeuvresCompletes = useMemo<OeuvreAdhesionEntree[]>(() => {
    if (!categorieRetenue) {
      return [];
    }
    const liste: OeuvreAdhesionEntree[] = [];
    for (const oeuvre of oeuvres) {
      const titre = oeuvre.titre.trim();
      if (!titre || oeuvre.fichier.statut !== 'reussi' || !oeuvre.fichier.depose) {
        continue;
      }
      const attestations: FichierDepose[] = [];
      if (oeuvre.attestation.statut === 'reussi' && oeuvre.attestation.depose) {
        attestations.push(oeuvre.attestation.depose);
      }
      if (attestations.length < NOMBRE_MINIMUM_ATTESTATIONS) {
        continue;
      }
      liste.push({
        titre,
        categorie_id: categorieRetenue.id,
        description: null,
        annee: null,
        fichier: oeuvre.fichier.depose,
        attestations,
      });
    }
    return liste;
  }, [categorieRetenue, oeuvres]);

  const signaturePiecesCourante = signaturePieces(piecesCompletes);
  const signaturePiecesBrouillon = signaturePieces(brouillon.pieces);
  const signatureOeuvresCourante = signatureOeuvres(oeuvresCompletes);
  const signatureOeuvresBrouillon = signatureOeuvres(brouillon.oeuvres);

  /** Sauvegarde continue des pièces dans le brouillon persistant. */
  useEffect(() => {
    if (etat !== 'contenu' || signaturePiecesCourante === signaturePiecesBrouillon) {
      return;
    }
    void mettreAJourPieces(piecesCompletes);
  }, [
    etat,
    mettreAJourPieces,
    piecesCompletes,
    signaturePiecesBrouillon,
    signaturePiecesCourante,
  ]);

  /** Sauvegarde continue des œuvres dans le brouillon persistant. */
  useEffect(() => {
    if (etat !== 'contenu' || signatureOeuvresCourante === signatureOeuvresBrouillon) {
      return;
    }
    void mettreAJourOeuvres(oeuvresCompletes);
  }, [
    etat,
    mettreAJourOeuvres,
    oeuvresCompletes,
    signatureOeuvresBrouillon,
    signatureOeuvresCourante,
  ]);

  /* ----------------------------------------------------------- Moteur d'envoi */

  /** État d'envoi courant d'une cible. */
  const envoiDe = useCallback(
    (cible: CibleEnvoi): EnvoiFichier => {
      if (cible.nature === 'piece') {
        return envoisPieces[cible.type] ?? ENVOI_VIDE;
      }
      const oeuvre = oeuvres.find((element) => element.cle === cible.cle);
      if (!oeuvre) {
        return ENVOI_VIDE;
      }
      return cible.nature === 'oeuvre' ? oeuvre.fichier : oeuvre.attestation;
    },
    [envoisPieces, oeuvres],
  );

  /** Applique une modification à l'envoi visé (pièce, fichier d'œuvre, attestation). */
  const definirEnvoi = useCallback((cible: CibleEnvoi, maj: Partial<EnvoiFichier>) => {
    if (cible.nature === 'piece') {
      setEnvoisPieces((precedent) => ({
        ...precedent,
        [cible.type]: { ...(precedent[cible.type] ?? ENVOI_VIDE), ...maj },
      }));
      return;
    }
    setOeuvres((precedent) =>
      precedent.map((oeuvre) => {
        if (oeuvre.cle !== cible.cle) {
          return oeuvre;
        }
        return cible.nature === 'oeuvre'
          ? { ...oeuvre, fichier: { ...oeuvre.fichier, ...maj } }
          : { ...oeuvre, attestation: { ...oeuvre.attestation, ...maj } };
      }),
    );
  }, []);

  /** Envoi d'un fichier par le service (progression visible et reprise sur erreur). */
  const televerser = useCallback(
    async (cible: CibleEnvoi, selection: FichierSelectionne) => {
      // Les attestations sont des documents : elles vont dans le bucket « pieces » (exigé par l'API et la base).
      const bucket = cible.nature === 'oeuvre' ? BUCKET_OEUVRES : BUCKET_PIECES;
      const dossier =
        cible.nature === 'piece'
          ? cible.type
          : `${brouillon.numero_dossier ?? 'BROUILLON'}/${cible.nature}`;

      definirEnvoi(cible, {
        statut: 'enCours',
        progression: 0,
        selection,
        depose: null,
        erreur: null,
      });

      // Créer le brouillon avant le premier téléversement afin que le serveur
      // puisse vérifier le code de suivi avant d'accepter un fichier.
      let numeroDossier = brouillon.numero_dossier;
      let codeSuivi = brouillon.code_suivi;
      if (!numeroDossier || !codeSuivi) {
        const identite = brouillon.identite;
        if (!brouillon.categorie_id || !identite.date_naissance) {
          definirEnvoi(cible, { statut: 'erreur', erreur: 'Complétez votre identité et choisissez une catégorie avant de déposer les fichiers.' });
          return;
        }
        const creation = await candidateApi.creerDemande({
          identite: {
            nom: identite.nom.trim(),
            prenom: identite.prenom.trim(),
            date_naissance: identite.date_naissance,
            cin: identite.cin.trim(),
            telephone: identite.telephone.trim(),
            email: identite.email.trim(),
            adresse: identite.adresse.trim(),
          },
          categorie_id: brouillon.categorie_id,
        });
        if (!creation.ok) {
          definirEnvoi(cible, { statut: 'erreur', erreur: messageErreurEnvoi(creation.erreur) });
          return;
        }
        numeroDossier = creation.valeur.numero_dossier;
        codeSuivi = creation.valeur.code_suivi;
        await definirIdentifiantsDossier(numeroDossier, codeSuivi);
      } else {
        // Réhydrater le contexte mémoire après fermeture ou redémarrage de l'app.
        const reprise = await candidateApi.mettreAJourDemande(numeroDossier, codeSuivi, {
          identite: {
            nom: brouillon.identite.nom.trim(),
            prenom: brouillon.identite.prenom.trim(),
            date_naissance: brouillon.identite.date_naissance || undefined,
            cin: brouillon.identite.cin.trim(),
            telephone: brouillon.identite.telephone.trim(),
            email: brouillon.identite.email.trim(),
            adresse: brouillon.identite.adresse.trim(),
          },
          categorie_id: brouillon.categorie_id ?? undefined,
        });
        if (!reprise.ok) {
          definirEnvoi(cible, { statut: 'erreur', erreur: messageErreurEnvoi(reprise.erreur) });
          return;
        }
      }

      const resultat = await candidateApi.televerserFichier(
        {
          bucket,
          chemin_stockage: cheminStockage(bucket, dossier, selection.nom),
          fichier_uri: selection.uri,
          nom_fichier: selection.nom,
          mime_type: selection.mime_type,
          taille_octets: selection.taille_octets,
        },
        { onProgression: (pourcentage) => definirEnvoi(cible, { progression: pourcentage }) },
      );

      if (!resultat.ok) {
        definirEnvoi(cible, { statut: 'erreur', erreur: messageErreurEnvoi(resultat.erreur) });
        return;
      }

      definirEnvoi(cible, {
        statut: 'reussi',
        progression: 100,
        depose: resultat.valeur,
        erreur: null,
      });
    },
    [brouillon, definirEnvoi, definirIdentifiantsDossier],
  );

  /** Sélection d'une image dans la bibliothèque (photo d'identité). */
  const choisirImage = useCallback(async (): Promise<CandidatFichier | null> => {
    const resultat = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (resultat.canceled) {
      return null;
    }
    const actif = resultat.assets[0];
    if (!actif) {
      return null;
    }
    return {
      uri: actif.uri,
      nom: actif.fileName ?? 'photo.jpg',
      mime_fourni: actif.mimeType ?? null,
      taille_octets: actif.fileSize ?? 0,
    };
  }, []);

  /**
   * Sélection d'un document : formats autorisés du bucket visé, ou formats
   * documentaires de l'attestation de diffusion (PDF, JPEG, PNG — pas d'audio).
   */
  const choisirDocument = useCallback(
    async (bucket: BucketStockage, estAttestation = false): Promise<CandidatFichier | null> => {
      const typesAcceptes = estAttestation
        ? TYPES_MIME_ATTESTATION
        : (TYPES_MIME_AUTORISES[bucket] as readonly string[]);
      const resultat = await DocumentPicker.getDocumentAsync({
        type: [...typesAcceptes],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (resultat.canceled) {
        return null;
      }
      const actif = resultat.assets[0];
      if (!actif) {
        return null;
      }
      return {
        uri: actif.uri,
        nom: actif.name,
        mime_fourni: actif.mimeType ?? null,
        taille_octets: actif.size ?? 0,
      };
    },
    [],
  );

  /** Choix d'un fichier puis envoi : contrôle 20 Mo / type MIME avant téléversement. */
  const selectionner = useCallback(
    async (cible: CibleEnvoi) => {
      // Les attestations sont des documents : elles vont dans le bucket « pieces » (exigé par l'API et la base).
      const bucket = cible.nature === 'oeuvre' ? BUCKET_OEUVRES : BUCKET_PIECES;
      const estAttestation = cible.nature === 'attestation';
      const estPhoto = cible.nature === 'piece' && cible.type === 'PHOTO';

      try {
        if (estPhoto) {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            definirEnvoi(cible, {
              statut: 'erreur',
              erreur:
                'L’accès à vos photos est nécessaire pour ce document. Autorisez-le dans les réglages du téléphone puis réessayez.',
            });
            return;
          }
        }

        const candidat = estPhoto ? await choisirImage() : await choisirDocument(bucket, estAttestation);
        if (!candidat) {
          // Annulation par l'utilisateur : la saisie en cours est conservée.
          return;
        }

        const validation = validerCandidat(bucket, candidat, estAttestation);
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
        console.warn('[DocumentsOeuvres] Sélection de fichier impossible :', erreur);
        definirEnvoi(cible, {
          statut: 'erreur',
          erreur: 'La sélection du fichier a échoué. Veuillez réessayer.',
        });
      }
    },
    [choisirDocument, choisirImage, definirEnvoi, televerser],
  );

  /** Reprise : relance l'envoi retenu, ou rouvre le sélecteur si le fichier a été refusé. */
  const reessayer = useCallback(
    async (cible: CibleEnvoi) => {
      const envoi = envoiDe(cible);
      if (envoi.selection) {
        await televerser(cible, envoi.selection);
        return;
      }
      await selectionner(cible);
    },
    [envoiDe, selectionner, televerser],
  );

  /**
   * Remplacement d'un fichier déjà choisi : le sélecteur est rouvert, le nouveau
   * fichier est contrôlé (20 Mo, type MIME) puis envoyé : le précédent dépôt est
   * écrasé dans l'état local et dans le brouillon persistant.
   */
  const remplacer = useCallback(
    async (cible: CibleEnvoi) => {
      if (envoiDe(cible).statut === 'enCours') {
        return;
      }
      await selectionner(cible);
    },
    [envoiDe, selectionner],
  );

  /**
   * Suppression d'un fichier (déclenchée après la confirmation affichée par
   * `UploadTile`) : l'élément repasse à l'état « manquant » via une NOUVELLE
   * valeur immuable, sans aucun champ conservé (fichier local, référence de
   * dépôt, progression, message d'erreur). Les effets de sauvegarde ci-dessus
   * réécrivent aussitôt le brouillon `AdhesionDraft` (AsyncStorage).
   */
  const supprimer = useCallback(
    (cible: CibleEnvoi) => {
      if (envoiDe(cible).statut === 'enCours') {
        return;
      }
      definirEnvoi(cible, { ...ENVOI_VIDE });
    },
    [definirEnvoi, envoiDe],
  );

  /* ------------------------------------------------------- Œuvres du dossier */

  const ajouterOeuvre = useCallback(() => {
    setOeuvres((precedent) => [...precedent, oeuvreVide()]);
  }, []);

  /** Retrait possible uniquement au-delà du minimum de 2 œuvres. */
  const retirerOeuvre = useCallback((cle: string) => {
    setOeuvres((precedent) =>
      precedent.length <= NOMBRE_MINIMUM_OEUVRES
        ? precedent
        : precedent.filter((element) => element.cle !== cle),
    );
  }, []);

  const definirTitreOeuvre = useCallback((cle: string, titre: string) => {
    setOeuvres((precedent) =>
      precedent.map((element) => (element.cle === cle ? { ...element, titre } : element)),
    );
  }, []);

  /* --------------------------------------------- Complétude du dossier */

  /** Points manquants : affichés en clair et utilisés pour bloquer « Continuer ». */
  const manques = useMemo<string[]>(() => {
    const liste: string[] = [];

    for (const exigence of exigences) {
      const envoi = envoisPieces[exigence.type] ?? ENVOI_VIDE;
      if (envoi.statut === 'reussi') {
        continue;
      }
      liste.push(
        envoi.statut === 'enCours'
          ? `${exigence.libelle} : envoi en cours…`
          : `${exigence.libelle} : fichier à fournir ou envoi à reprendre.`,
      );
    }

    oeuvres.forEach((oeuvre, index) => {
      const nom = `Œuvre ${index + 1}`;
      if (!oeuvre.titre.trim()) {
        liste.push(`${nom} : indiquez le titre.`);
      }
      if (oeuvre.fichier.statut !== 'reussi') {
        liste.push(`${nom} : fichier de l’œuvre à envoyer.`);
      }
      if (oeuvre.attestation.statut !== 'reussi') {
        liste.push(`${nom} : attestation de diffusion obligatoire.`);
      }
    });

    if (oeuvresCompletes.length < NOMBRE_MINIMUM_OEUVRES) {
      liste.push(
        `${NOMBRE_MINIMUM_OEUVRES} œuvres complètes minimum (${oeuvresCompletes.length} validée${
          oeuvresCompletes.length > 1 ? 's' : ''
        }).`,
      );
    }

    return liste;
  }, [envoisPieces, exigences, oeuvres, oeuvresCompletes.length]);

  const dossierComplet = categorieRetenue !== null && manques.length === 0;

  const continuer = useCallback(() => {
    if (!dossierComplet) {
      return;
    }
    router.push('/(adhesion)/recapitulatif');
  }, [dossierComplet]);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Documents et œuvres" sousTitre="Demande d’adhésion">
        <StepProgress etapeCourante={3} />
        <LoadingState message="Chargement du dossier et des catégories d’adhésion…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Documents et œuvres" sousTitre="Demande d’adhésion">
        <StepProgress etapeCourante={3} />
        <ErrorState
          titre="Service indisponible"
          message={messageErreur}
          onReessayer={() => void initialiserEcran(brouillon)}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide' || !categorieRetenue) {
    return (
      <ScreenContainer titre="Documents et œuvres" sousTitre="Demande d’adhésion">
        <StepProgress etapeCourante={3} />
        <EmptyState
          titre="Catégorie d’adhésion indisponible"
          message={`${messageVide} Sélectionnez une catégorie pour reprendre votre dossier.`}
          actionLibelle="Choisir ma catégorie"
          onAction={() => router.push('/(adhesion)/categorie')}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Documents et œuvres" sousTitre="Demande d’adhésion">
      <StepProgress etapeCourante={3} />

      <Text className="text-base text-omda-textGray">
        {`Joignez les pièces de votre dossier puis au moins ${NOMBRE_MINIMUM_OEUVRES} œuvres, chacune accompagnée d’une attestation de diffusion. Chaque fichier est limité à ${TAILLE_MAX_FICHIER_MO} Mo.`}
      </Text>

      <View className="mt-4 rounded-2xl border border-omda-borderGray bg-omda-white p-4">
        <View className="flex-row items-center">
          <Icone nom="paperclip" taille={16} classeCouleur="text-omda-textGray" />
          <Text className="ml-2 flex-1 text-sm font-semibold text-omda-black">
            {`Pièces enregistrées : ${piecesCompletes.length} / ${exigences.length}`}
          </Text>
        </View>

        <View className="mt-2 flex-row items-center">
          <Icone nom="music" taille={16} classeCouleur="text-omda-textGray" />
          <Text className="ml-2 flex-1 text-sm font-semibold text-omda-black">
            {`Œuvres complètes : ${oeuvresCompletes.length} / ${NOMBRE_MINIMUM_OEUVRES} minimum`}
          </Text>
        </View>

        <Text className="mt-2 text-sm text-omda-textGray">
          {`Catégorie retenue : ${categorieRetenue.libelle}`}
        </Text>
      </View>

      {estMineur15A17 ? (
        <View className="mt-5">
          <InfoBanner
            variante="info"
            titre="Autorisation parentale obligatoire"
            message="Vous avez entre 15 et 17 ans : l’autorisation signée par votre parent ou tuteur doit figurer dans les pièces du dossier."
          />
        </View>
      ) : null}

      <Text className="mt-7 text-lg font-bold text-omda-black">1. Pièces justificatives</Text>
      <Text className="mt-1 text-sm text-omda-textGray">
        {`Formats acceptés : ${LIBELLE_FORMATS.pieces}. Un fichier refusé peut être remplacé.`}
      </Text>

      <View className="mt-3 gap-3">
        {exigences.map((exigence) => {
          const envoi = envoisPieces[exigence.type] ?? ENVOI_VIDE;
          const cible: CibleEnvoi = { nature: 'piece', type: exigence.type };

          return (
            <UploadTile
              key={exigence.type}
              libelle={exigence.libelle}
              icone={exigence.icone}
              obligatoire
              statut={envoi.statut}
              nomFichier={nomFichierAffiche(envoi)}
              progression={envoi.progression}
              message={messageEnvoi(envoi, exigence.aide)}
              onSelectionner={() => void selectionner(cible)}
              onReessayer={() => void reessayer(cible)}
              onRemplacer={() => void remplacer(cible)}
              onSupprimer={() => supprimer(cible)}
            />
          );
        })}
      </View>

      <Text className="mt-8 text-lg font-bold text-omda-black">2. Œuvres</Text>
      <Text className="mt-1 text-sm text-omda-textGray">
        {`${NOMBRE_MINIMUM_OEUVRES} œuvres minimum — 1 attestation par œuvre. Formats acceptés : ${LIBELLE_FORMATS.oeuvres}.`}
      </Text>

      <View className="mt-3 gap-4">
        {oeuvres.map((oeuvre, index) => (
          <View
            key={oeuvre.cle}
            className="rounded-2xl border border-omda-borderGray bg-omda-white p-4"
          >
            <Text className="text-base font-bold text-omda-black">{`Œuvre ${index + 1}`}</Text>

            <View className="mt-3">
              <TextField
                libelle="Titre de l’œuvre"
                valeur={oeuvre.titre}
                placeholder="Ex. La varangue"
                obligatoire
                onChangeValeur={(valeur) => definirTitreOeuvre(oeuvre.cle, valeur)}
              />
            </View>

            <View className="mt-3 gap-3">
              <UploadTile
                libelle="Fichier de l’œuvre"
                icone="file-audio"
                obligatoire
                statut={oeuvre.fichier.statut}
                nomFichier={nomFichierAffiche(oeuvre.fichier)}
                progression={oeuvre.fichier.progression}
                message={messageEnvoi(
                  oeuvre.fichier,
                  'Œuvre complète : texte, audio ou image.',
                )}
                onSelectionner={() => void selectionner({ nature: 'oeuvre', cle: oeuvre.cle })}
                onReessayer={() => void reessayer({ nature: 'oeuvre', cle: oeuvre.cle })}
                onRemplacer={() => void remplacer({ nature: 'oeuvre', cle: oeuvre.cle })}
                onSupprimer={() => supprimer({ nature: 'oeuvre', cle: oeuvre.cle })}
              />

              <UploadTile
                libelle="Attestation de diffusion"
                icone="paperclip"
                obligatoire
                statut={oeuvre.attestation.statut}
                nomFichier={nomFichierAffiche(oeuvre.attestation)}
                progression={oeuvre.attestation.progression}
                message={messageEnvoi(oeuvre.attestation, AIDE_ATTESTATION_FORMATS)}
                onSelectionner={() => void selectionner({ nature: 'attestation', cle: oeuvre.cle })}
                onReessayer={() => void reessayer({ nature: 'attestation', cle: oeuvre.cle })}
                onRemplacer={() => void remplacer({ nature: 'attestation', cle: oeuvre.cle })}
                onSupprimer={() => supprimer({ nature: 'attestation', cle: oeuvre.cle })}
              />
            </View>

            {oeuvres.length > NOMBRE_MINIMUM_OEUVRES ? (
              <View className="mt-4">
                <Button
                  libelle="Retirer cette œuvre"
                  icone="trash"
                  variante="destructive"
                  pleineLargeur
                  onPress={() => retirerOeuvre(oeuvre.cle)}
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <View className="mt-4">
        <Button
          libelle="Ajouter une œuvre"
          icone="plus"
          variante="secondary"
          pleineLargeur
          onPress={ajouterOeuvre}
        />
      </View>

      {manques.length > 0 ? (
        <View className="mt-8">
          <InfoBanner
            variante="pending"
            titre="Dossier incomplet"
            message={manques.map((element) => `• ${element}`).join('\n')}
          />
        </View>
      ) : (
        <View className="mt-8">
          <InfoBanner
            variante="info"
            titre="Dossier complet"
            message="Toutes les pièces et les œuvres exigées sont enregistrées. Vous pouvez passer au récapitulatif : aucun paiement n’est demandé à l’envoi."
          />
        </View>
      )}

      <View className="mt-8 gap-3">
        <Button
          libelle="Continuer vers le récapitulatif"
          pleineLargeur
          desactive={!dossierComplet}
          onPress={continuer}
        />
        <Button
          libelle="Retour à la catégorie"
          variante="secondary"
          pleineLargeur
          onPress={() => router.back()}
        />
      </View>
    </ScreenContainer>
  );
}
