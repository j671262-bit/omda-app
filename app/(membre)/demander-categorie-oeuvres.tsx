import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
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
  StatusPill,
  TextField,
  UploadTile,
  type StatutUpload,
} from '../../src/components/ui';
import {
  TAILLE_MAX_FICHIER_MO,
  TAILLE_MAX_FICHIER_OCTETS,
  TYPES_MIME_ATTESTATION,
  TYPES_MIME_AUTORISES,
  type Categorie,
  type TypeMime,
} from '../../src/models';
import type { ErreurApp, FichierDepose } from '../../src/services/contracts';
import { memberRepository, publicContentService } from '../../src/services/factory';
import {
  AIDE_ATTESTATION_FORMATS,
  MESSAGE_ATTESTATION_FORMAT_INVALIDE,
  isAllowedAttestationMime,
} from '../../src/utils';

/* -------------------------------------------------------------- Constantes */

/** Nombre minimum d'œuvres exigé (règles métier 9 + 8). */
const NOMBRE_MINIMUM_OEUVRES = 2;

/**
 * Une attestation de diffusion par œuvre (règle métier 8) : imposée
 * structurellement par la tuile « Attestation de diffusion » de chaque ligne.
 */
const NOMBRE_ATTESTATIONS_PAR_OEUVRE = 1;

/** Bucket de destination des œuvres et de leurs attestations. */
const BUCKET_OEUVRES = 'oeuvres';

/** Formats acceptés, rappelés dans les messages d'erreur. */
const LIBELLE_FORMATS = 'MP3, WAV, PDF, JPEG ou PNG';

/**
 * Délai de sécurité du chargement : au-delà, la réponse est considérée perdue —
 * l'écran sort du chargement et propose « Réessayer ».
 */
const DELAI_MAX_CHARGEMENT_MS = 9000;

/* ------------------------------------------------------------------- Types */

/**
 * États de rendu de l'écran HORS chargement : les états obligatoires `erreur`,
 * `vide` et `contenu`, plus `succes` (accusé de réception de la demande).
 *
 * L'état `chargement` est porté par le drapeau booléen `chargement` : il est
 * désactivé dans le `finally` de la fonction de chargement, l'écran ne peut donc
 * jamais rester bloqué sur le message « Chargement… ».
 */
type EtatEcran = 'erreur' | 'vide' | 'contenu' | 'succes';

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

/** Ligne d'œuvre en cours : titre + fichier + attestation de diffusion. */
type OeuvreEnCours = {
  cle: string;
  titre: string;
  fichier: EnvoiFichier;
  attestation: EnvoiFichier;
};

/** Cible d'un envoi de fichier sur cet écran. */
type CibleEnvoi = { nature: 'oeuvre' | 'attestation'; cle: string };

/** Fichier brut renvoyé par expo-document-picker. */
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
function cheminStockage(dossier: string, nomFichier: string): string {
  const nomPropre = nomFichier.replace(/[^\w.\-]+/g, '_') || 'fichier';
  return `${BUCKET_OEUVRES}/${dossier}/${Date.now().toString(36)}-${nomPropre}`;
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

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Clé locale stable pour une ligne d'œuvre. */
let compteurOeuvres = 0;
function nouvelleCleOeuvre(): string {
  compteurOeuvres += 1;
  return `oeuvre-demande-${compteurOeuvres}`;
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

/**
 * Demande de catégorie supplémentaire — écran 2/2, HORS onglets (règles
 * métier 9 + 8).
 *
 * Le membre joint à sa demande AU MOINS 2 œuvres, chacune avec un titre, un
 * fichier et une attestation de diffusion, puis envoie la demande :
 * `memberRepository.demanderCategorieSupplementaireAvecOeuvres` crée
 * l'appartenance au statut `EN_ATTENTE` — seule la décision d'un agent OMDA
 * l'activera, aucun paiement, aucune ligne `oeuvre` créée localement.
 *
 * Contraintes d'envoi : 20 Mo maximum, types MIME du bucket `oeuvres`,
 * progression visible, reprise sur erreur (coupure réseau), remplacement et
 * suppression (confirmée par `UploadTile`) d'un fichier, retrait d'une ligne
 * d'œuvre confirmé DANS l'écran (aucun `Alert`). Les envois passent par
 * `memberRepository.televerserFichier` (Supabase Storage, dossier du membre).
 *
 * Paramètres d'entrée : `categorie_id` (obligatoire) + `categorie_libelle`.
 * Revalide la catégorie au chargement (catégorie retirée du référentiel ou
 * demande déjà `EN_ATTENTE` ⇒ état `vide`).
 * Gère les 4 états obligatoires : `LoadingState`, `ErrorState` + « Réessayer »,
 * `EmptyState` et contenu ; `succes` affiche l'accusé de réception avec retour
 * au Profil (l'onglet Profil se recharge au focus et affiche la nouvelle
 * « Demande en attente »).
 */
export default function DemanderCategorieOeuvresScreen() {
  const parametres = useLocalSearchParams<{ categorie_id?: string; categorie_libelle?: string }>();
  const categorieId =
    typeof parametres.categorie_id === 'string' && parametres.categorie_id
      ? parametres.categorie_id
      : null;
  const libelleParametre =
    typeof parametres.categorie_libelle === 'string' ? parametres.categorie_libelle : '';

  const [chargement, setChargement] = useState(true);
  const [etat, setEtat] = useState<EtatEcran>('vide');
  const [messageErreur, setMessageErreur] = useState('');
  const [messageVide, setMessageVide] = useState('');
  const [categorieRetenue, setCategorieRetenue] = useState<Categorie | null>(null);
  const [libelleDemande, setLibelleDemande] = useState('');
  const [oeuvres, setOeuvres] = useState<OeuvreEnCours[]>([oeuvreVide(), oeuvreVide()]);
  const [confirmationRetrait, setConfirmationRetrait] = useState<string | null>(null);
  const [envoiDemande, setEnvoiDemande] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [erreurEnvoiEstCategorie, setErreurEnvoiEstCategorie] = useState(false);

  /* ---------------------------------------------------------- Chargement */

  /**
   * Valide la catégorie reçue (référentiel actif, pas d'appartenance `ACTIVE`
   * ni de demande déjà `EN_ATTENTE`) — puis ouvre le contenu.
   * `setChargement(false)` est appelé dans le `finally` : l'écran sort donc
   * TOUJOURS du chargement, quelle que soit l'issue.
   */
  const chargerDonnees = useCallback(async () => {
    setChargement(true);
    setMessageErreur('');
    setErreurEnvoi(null);
    setErreurEnvoiEstCategorie(false);

    if (!categorieId) {
      setMessageVide(
        'Aucune catégorie n’a été transmise à cet écran. Revenez au choix de catégorie pour continuer.',
      );
      setCategorieRetenue(null);
      setEtat('vide');
      setChargement(false);
      return;
    }

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

      const categorie = categoriesActives.valeur.find((element) => element.id === categorieId);
      if (!categorie) {
        setMessageVide(
          'Cette catégorie n’est plus proposée par l’OMDA. Revenez au choix pour sélectionner une autre catégorie.',
        );
        setCategorieRetenue(null);
        setEtat('vide');
        return;
      }

      const appartenance = appartenances.valeur.membre_categories.find(
        (element) => element.categorie_id === categorieId,
      );
      if (
        appartenance &&
        (appartenance.statut === 'EN_ATTENTE' || appartenance.statut === 'ACTIVE')
      ) {
        setMessageVide(
          appartenance.statut === 'EN_ATTENTE'
            ? 'Une demande est déjà en attente pour cette catégorie : consultez-la depuis votre profil.'
            : 'Cette catégorie est déjà active dans votre profil : aucune nouvelle demande n’est nécessaire.',
        );
        setCategorieRetenue(null);
        setEtat('vide');
        return;
      }

      setCategorieRetenue(categorie);
      setOeuvres([oeuvreVide(), oeuvreVide()]);
      setConfirmationRetrait(null);
      setEtat('contenu');
    } catch {
      setMessageErreur(
        'Une erreur inattendue est survenue pendant le chargement de la demande. Veuillez réessayer dans quelques instants.',
      );
      setEtat('erreur');
    } finally {
      if (minuteurSecurite) {
        clearTimeout(minuteurSecurite);
      }
      setChargement(false);
    }
  }, [categorieId]);

  /** Chargement initial : sans cet appel, l'écran resterait bloqué. */
  useEffect(() => {
    void chargerDonnees();
  }, [chargerDonnees]);

  /* --------------------------------------------------------- Moteur d'envoi */

  /** Applique une modification à l'envoi visé (fichier d'œuvre ou attestation). */
  const definirEnvoi = useCallback((cible: CibleEnvoi, maj: Partial<EnvoiFichier>) => {
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

  /** État d'envoi courant d'une cible. */
  const envoiDe = useCallback(
    (cible: CibleEnvoi): EnvoiFichier => {
      const oeuvre = oeuvres.find((element) => element.cle === cible.cle);
      if (!oeuvre) {
        return ENVOI_VIDE;
      }
      return cible.nature === 'oeuvre' ? oeuvre.fichier : oeuvre.attestation;
    },
    [oeuvres],
  );

  /** Envoi d'un fichier par le service (progression visible et reprise sur erreur). */
  const televerser = useCallback(
    async (cible: CibleEnvoi, selection: FichierSelectionne) => {
      definirEnvoi(cible, {
        statut: 'enCours',
        progression: 0,
        selection,
        depose: null,
        erreur: null,
      });

      const resultat = await memberRepository.televerserFichier(
        {
          bucket: BUCKET_OEUVRES,
          chemin_stockage: cheminStockage(cible.nature, selection.nom),
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
    [definirEnvoi],
  );

  /**
   * Sélection d'un document : formats autorisés du bucket `oeuvres`, ou formats
   * documentaires de l'attestation de diffusion (PDF, JPEG, PNG — pas d'audio).
   */
  const choisirDocument = useCallback(
    async (estAttestation = false): Promise<CandidatFichier | null> => {
      const typesAcceptes = estAttestation
        ? TYPES_MIME_ATTESTATION
        : (TYPES_MIME_AUTORISES[BUCKET_OEUVRES] as readonly string[]);
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
      try {
        const estAttestation = cible.nature === 'attestation';
        const candidat = await choisirDocument(estAttestation);
        if (!candidat) {
          // Annulation par l'utilisateur : la saisie en cours est conservée.
          return;
        }

        const validation = validerCandidat(candidat, estAttestation);
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
      } catch {
        definirEnvoi(cible, {
          statut: 'erreur',
          erreur: 'La sélection du fichier a échoué. Veuillez réessayer.',
        });
      }
    },
    [choisirDocument, definirEnvoi, televerser],
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

  /** Remplacement d'un fichier déjà choisi : le sélecteur est rouvert puis le nouveau fichier est envoyé. */
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
   * valeur immuable, sans aucun champ conservé.
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

  /* ------------------------------------------------- Œuvres de la demande */

  const ajouterOeuvre = useCallback(() => {
    setConfirmationRetrait(null);
    setOeuvres((precedent) => [...precedent, oeuvreVide()]);
  }, []);

  /** Retrait d'une ligne d'œuvre (confirmation affichée dans l'écran) — interdit sous le minimum. */
  const retirerOeuvre = useCallback((cle: string) => {
    setConfirmationRetrait(null);
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

  /* --------------------------------------------------------- Complétude */

  /** Œuvres complètes : titre + fichier + attestation de diffusion envoyée. */
  const oeuvresCompletes = useMemo(() => {
    const liste: { titre: string; fichier: FichierDepose; attestation: FichierDepose }[] = [];
    for (const oeuvre of oeuvres) {
      const titre = oeuvre.titre.trim();
      if (!titre || oeuvre.fichier.statut !== 'reussi' || !oeuvre.fichier.depose) {
        continue;
      }
      if (oeuvre.attestation.statut !== 'reussi' || !oeuvre.attestation.depose) {
        continue;
      }
      liste.push({ titre, fichier: oeuvre.fichier.depose, attestation: oeuvre.attestation.depose });
    }
    return liste;
  }, [oeuvres]);

  /** Points manquants : affichés en clair et utilisés pour bloquer « Envoyer ». */
  const manques = useMemo<string[]>(() => {
    const liste: string[] = [];

    oeuvres.forEach((oeuvre, index) => {
      const nom = `Œuvre ${index + 1}`;
      if (!oeuvre.titre.trim()) {
        liste.push(`${nom} : indiquez le titre.`);
      }
      if (oeuvre.fichier.statut !== 'reussi') {
        liste.push(
          oeuvre.fichier.statut === 'enCours'
            ? `${nom} : envoi du fichier en cours…`
            : `${nom} : fichier de l’œuvre à envoyer.`,
        );
      }
      if (oeuvre.attestation.statut !== 'reussi') {
        liste.push(
          oeuvre.attestation.statut === 'enCours'
            ? `${nom} : envoi de l’attestation en cours…`
            : `${nom} : attestation de diffusion obligatoire.`,
        );
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
  }, [oeuvres, oeuvresCompletes.length]);

  const demandePrete = categorieRetenue !== null && manques.length === 0;

  /* --------------------------------------------------------------- Envoi */

  const envoyerDemande = useCallback(async () => {
    if (!categorieRetenue || !demandePrete || envoiDemande) {
      return;
    }

    setEnvoiDemande(true);
    setErreurEnvoi(null);
    setErreurEnvoiEstCategorie(false);

    try {
      const resultat = await memberRepository.demanderCategorieSupplementaireAvecOeuvres({
        categorie_id: categorieRetenue.id,
        oeuvres: oeuvresCompletes,
      });

      if (!resultat.ok) {
        const estCategorie =
          resultat.erreur.type === 'metier' && resultat.erreur.code.startsWith('CATEGORIE_');
        setErreurEnvoiEstCategorie(estCategorie);
        setErreurEnvoi(traduireErreur(resultat.erreur));
        return;
      }

      setLibelleDemande(categorieRetenue.libelle);
      setEtat('succes');
    } catch {
      setErreurEnvoi(
        'Une erreur inattendue est survenue pendant l’envoi de votre demande. Veuillez réessayer dans quelques instants.',
      );
    } finally {
      // Le bouton ne doit jamais rester bloqué sur son indicateur de chargement.
      setEnvoiDemande(false);
    }
  }, [categorieRetenue, demandePrete, envoiDemande, oeuvresCompletes]);

  /* ---------------------------------------------------------- Navigation */

  const retourProfil = useCallback(() => {
    if (router.canDismiss()) {
      router.dismissAll();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/(tabs)/profil');
  }, []);

  const retourChoix = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/demander-categorie');
  }, []);

  /* --------------------------------------------------------------- Rendu */

  if (chargement) {
    return (
      <ScreenContainer titre="Joindre vos œuvres" sousTitre="Demander une catégorie">
        <LoadingState message="Chargement de votre demande de catégorie…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Joindre vos œuvres" sousTitre="Demander une catégorie">
        <ErrorState
          titre="Service indisponible"
          message={messageErreur}
          onReessayer={() => void chargerDonnees()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide') {
    return (
      <ScreenContainer titre="Joindre vos œuvres" sousTitre="Demander une catégorie">
        <EmptyState
          titre="Demande impossible pour cette catégorie"
          message={messageVide}
          icone="layer-group"
          actionLibelle="Revenir au choix"
          onAction={retourChoix}
        />
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

  if (etat === 'succes') {
    return (
      <ScreenContainer titre="Joindre vos œuvres" sousTitre="Demander une catégorie">
        <InfoBanner
          variante="success"
          titre="Demande transmise"
          message={`Votre demande pour la catégorie « ${libelleDemande} », avec ${oeuvresCompletes.length} œuvre${
            oeuvresCompletes.length > 1 ? 's' : ''
          } et leur attestation, a bien été envoyée. Elle apparaît dans votre profil sous le statut « Demande en attente ».`}
        />

        <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <Text className="text-base font-semibold text-omda-black">{libelleDemande}</Text>

          <View className="mt-3">
            <StatusPill statut="pending" libelle="Demande en attente" />
          </View>

          <Text className="mt-3 text-sm text-omda-textGray">
            Rien à faire de votre côté : un agent OMDA examinera votre demande. La catégorie
            sera activée après sa décision — elle n’est pas encore utilisable en l’état.
          </Text>
        </View>

        <View className="mt-5">
          <Button libelle="Retour à mon profil" icone="user" pleineLargeur onPress={retourProfil} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Joindre vos œuvres" sousTitre="Demander une catégorie">
      <InfoBanner
        variante="info"
        titre="Comment cela fonctionne"
        message={`Joignez au moins ${NOMBRE_MINIMUM_OEUVRES} œuvres, chacune avec ${NOMBRE_ATTESTATIONS_PAR_OEUVRE} attestation de diffusion. Chaque fichier est limité à ${TAILLE_MAX_FICHIER_MO} Mo (${LIBELLE_FORMATS}). Votre demande reste « en attente » jusqu’à la décision d’un agent OMDA : aucun paiement, aucune activation automatique.`}
      />

      <View className="mt-5 rounded-2xl border border-omda-borderGray bg-omda-white p-4">
        <View className="flex-row items-center">
          <Icone nom="layer-group" taille={16} classeCouleur="text-omda-textGray" />
          <Text className="ml-2 flex-1 text-sm font-semibold text-omda-black">
            {`Catégorie : ${categorieRetenue?.libelle ?? libelleParametre}`}
          </Text>
        </View>

        <View className="mt-2 flex-row items-center">
          <Icone nom="music" taille={16} classeCouleur="text-omda-textGray" />
          <Text className="ml-2 flex-1 text-sm font-semibold text-omda-black">
            {`Œuvres complètes : ${oeuvresCompletes.length} / ${NOMBRE_MINIMUM_OEUVRES} minimum`}
          </Text>
        </View>
      </View>

      <Text className="mt-6 text-lg font-bold text-omda-black">Vos œuvres</Text>
      <Text className="mt-1 text-sm text-omda-textGray">
        {`${NOMBRE_MINIMUM_OEUVRES} œuvres minimum — ${NOMBRE_ATTESTATIONS_PAR_OEUVRE} attestation par œuvre. Formats acceptés : ${LIBELLE_FORMATS}.`}
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
              confirmationRetrait === oeuvre.cle ? (
                <View className="mt-4 rounded-xl border border-omda-borderGray bg-omda-warmGray p-4">
                  <Text className="text-sm text-omda-black">
                    Retirer cette œuvre de la demande ? Les fichiers déjà envoyés pour elle
                    seront perdus.
                  </Text>
                  <View className="mt-3 gap-3">
                    <Button
                      libelle="Oui, retirer cette œuvre"
                      icone="trash"
                      variante="destructive"
                      pleineLargeur
                      onPress={() => retirerOeuvre(oeuvre.cle)}
                    />
                    <Button
                      libelle="Annuler"
                      variante="secondary"
                      pleineLargeur
                      onPress={() => setConfirmationRetrait(null)}
                    />
                  </View>
                </View>
              ) : (
                <View className="mt-4">
                  <Button
                    libelle="Retirer cette œuvre"
                    icone="trash"
                    variante="destructive"
                    pleineLargeur
                    onPress={() => setConfirmationRetrait(oeuvre.cle)}
                  />
                </View>
              )
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
            titre="Demande incomplète"
            message={manques.map((element) => `• ${element}`).join('\n')}
          />
        </View>
      ) : (
        <View className="mt-8">
          <InfoBanner
            variante="success"
            titre="Demande prête"
            message={`Les ${NOMBRE_MINIMUM_OEUVRES} œuvres exigées sont complètes, attestations comprises. Vous pouvez envoyer votre demande.`}
          />
        </View>
      )}

      {erreurEnvoi ? (
        <View className="mt-4">
          <InfoBanner
            variante="error"
            titre={erreurEnvoiEstCategorie ? 'Catégorie indisponible' : 'Envoi impossible'}
            message={erreurEnvoi}
            actionLibelle={erreurEnvoiEstCategorie ? 'Revenir au choix' : 'Réessayer'}
            onAction={erreurEnvoiEstCategorie ? retourChoix : () => void envoyerDemande()}
          />
        </View>
      ) : null}

      <View className="mt-8 gap-3">
        <Button
          libelle="Envoyer ma demande"
          icone="paper-plane"
          pleineLargeur
          chargement={envoiDemande}
          desactive={!demandePrete || envoiDemande}
          onPress={() => void envoyerDemande()}
        />
        <Button
          libelle="Retour au choix de catégorie"
          variante="secondary"
          pleineLargeur
          desactive={envoiDemande}
          onPress={retourChoix}
        />
      </View>
    </ScreenContainer>
  );
}