import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { DateISO, UUID } from '../models';
import type {
  OeuvreAdhesionEntree,
  PieceEntree,
} from '../services/contracts';

/** Clé de stockage local pour le brouillon d'adhésion (hors secrets). */
const CLE_STORAGE_ADHESION_DRAFT = 'omda_adhesion_draft_v1';

/**
 * Clé du trousseau sécurisé pour les identifiants du dossier (numéro + code de suivi).
 * Le code de suivi est un secret : il n'est JAMAIS écrit dans `AsyncStorage` (non chiffré).
 */
const CLE_SECURE_IDENTIFIANTS_DOSSIER = 'omda_adhesion_identifiants_v1';

type IdentifiantsDossier = { numero_dossier: string; code_suivi: string };

async function lireIdentifiantsSecurises(): Promise<IdentifiantsDossier | null> {
  try {
    const brut = await SecureStore.getItemAsync(CLE_SECURE_IDENTIFIANTS_DOSSIER);
    if (!brut) return null;
    const analyse = JSON.parse(brut) as Partial<IdentifiantsDossier>;
    return typeof analyse.numero_dossier === 'string' && typeof analyse.code_suivi === 'string'
      ? { numero_dossier: analyse.numero_dossier, code_suivi: analyse.code_suivi }
      : null;
  } catch {
    return null;
  }
}

/** Écrit le brouillon : identité/choix dans AsyncStorage, identifiants du dossier dans le trousseau. */
async function persisterBrouillon(brouillon: AdhesionDraft): Promise<void> {
  try {
    if (brouillon === BROUILLON_INITIAL) {
      await AsyncStorage.removeItem(CLE_STORAGE_ADHESION_DRAFT);
      await SecureStore.deleteItemAsync(CLE_SECURE_IDENTIFIANTS_DOSSIER);
      return;
    }
    await AsyncStorage.setItem(
      CLE_STORAGE_ADHESION_DRAFT,
      JSON.stringify({ ...brouillon, code_suivi: null }),
    );
    if (brouillon.numero_dossier && brouillon.code_suivi) {
      await SecureStore.setItemAsync(
        CLE_SECURE_IDENTIFIANTS_DOSSIER,
        JSON.stringify({ numero_dossier: brouillon.numero_dossier, code_suivi: brouillon.code_suivi }),
      );
    } else {
      await SecureStore.deleteItemAsync(CLE_SECURE_IDENTIFIANTS_DOSSIER);
    }
  } catch (erreur) {
    console.warn('[AdhesionDraft] Erreur de sauvegarde locale :', erreur);
  }
}

/**
 * Données d'identité du candidat dans le brouillon.
 * Tolère des champs vides pendant la saisie progressive.
 */
export type IdentiteDraft = {
  nom: string;
  prenom: string;
  /** Pseudonyme ou nom d'artiste — distinct du nom et du prénom officiels (Règle métier 1). */
  pseudonyme: string;
  date_naissance: DateISO | '';
  cin: string;
  telephone: string;
  email: string;
  adresse: string;
};

/**
 * Données complètes du brouillon d'adhésion conservées en local.
 */
export type AdhesionDraft = {
  identite: IdentiteDraft;
  categorie_id: UUID | null;
  /** Identifiant interne de la demande côté serveur (retourné par `creerDemande`). Nécessaire pour les mises à jour PATCH ultérieures. */
  demande_id: UUID | null;
  pieces: PieceEntree[];
  oeuvres: OeuvreAdhesionEntree[];
  numero_dossier: string | null;
  code_suivi: string | null;
  derniere_mise_a_jour: string;
};

export const IDENTITE_VIDE: IdentiteDraft = {
  nom: '',
  prenom: '',
  pseudonyme: '',
  date_naissance: '',
  cin: '',
  telephone: '+261',
  email: '',
  adresse: '',
};

export const BROUILLON_INITIAL: AdhesionDraft = {
  identite: IDENTITE_VIDE,
  categorie_id: null,
  demande_id: null,
  pieces: [],
  oeuvres: [],
  numero_dossier: null,
  code_suivi: null,
  derniere_mise_a_jour: new Date().toISOString(),
};

/**
 * Calcule l'âge révolu à la date courante à partir d'une date de naissance (AAAA-MM-JJ).
 * Renvoie `null` si la date est incomplète ou invalide.
 */
export function calculerAge(date_naissance: string): number | null {
  const propre = date_naissance.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(propre)) {
    return null;
  }
  const dateObj = new Date(`${propre}T00:00:00.000Z`);
  if (Number.isNaN(dateObj.getTime())) {
    return null;
  }
  const aujourdHui = new Date();
  let age = aujourdHui.getUTCFullYear() - dateObj.getUTCFullYear();
  const ecartMois = aujourdHui.getUTCMonth() - dateObj.getUTCMonth();
  if (ecartMois < 0 || (ecartMois === 0 && aujourdHui.getUTCDate() < dateObj.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export type AdhesionDraftContextType = {
  brouillon: AdhesionDraft;
  estCharge: boolean;
  mettreAJourIdentite: (partial: Partial<IdentiteDraft>) => Promise<void>;
  definirCategorie: (categorieId: UUID) => Promise<void>;
  mettreAJourPieces: (pieces: PieceEntree[]) => Promise<void>;
  mettreAJourOeuvres: (oeuvres: OeuvreAdhesionEntree[]) => Promise<void>;
  definirIdentifiantsDossier: (numeroDossier: string, codeSuivi: string, demandeId?: UUID | null) => Promise<void>;
  reinitialiserBrouillon: () => Promise<void>;
  age: number | null;
  estMineur15A17: boolean;
  estMoinsDe15Ans: boolean;
  identiteEstValide: boolean;
};

const AdhesionDraftContext = createContext<AdhesionDraftContextType | undefined>(undefined);

export function AdhesionDraftProvider({ children }: { children: ReactNode }) {
  const [brouillon, setBrouillon] = useState<AdhesionDraft>(BROUILLON_INITIAL);
  const [estCharge, setEstCharge] = useState(false);

  // Chargement : identité et choix depuis AsyncStorage, identifiants du dossier depuis le trousseau.
  useEffect(() => {
    let actif = true;
    async function chargerDepuisStockage() {
      try {
        const contenu = await AsyncStorage.getItem(CLE_STORAGE_ADHESION_DRAFT);
        const parse = contenu ? (JSON.parse(contenu) as Partial<AdhesionDraft>) : null;
        let identifiants = await lireIdentifiantsSecurises();
        // Migration : d'anciennes versions stockaient le code de suivi en clair dans le brouillon.
        if (!identifiants && parse?.numero_dossier && parse.code_suivi) {
          identifiants = { numero_dossier: parse.numero_dossier, code_suivi: parse.code_suivi };
        }
        if (actif && (parse || identifiants)) {
          setBrouillon((precedent) => ({
            ...precedent,
            ...(parse ?? {}),
            identite: { ...precedent.identite, ...(parse?.identite ?? {}) },
            numero_dossier: identifiants?.numero_dossier ?? null,
            code_suivi: identifiants?.code_suivi ?? null,
          }));
        }
      } catch (erreur) {
        console.warn('[AdhesionDraft] Erreur de lecture locale :', erreur);
      } finally {
        if (actif) {
          setEstCharge(true);
        }
      }
    }
    void chargerDepuisStockage();
    return () => {
      actif = false;
    };
  }, []);

  // Persistance : un seul effet, hors des fonctions de mise à jour d'état (qui doivent rester pures).
  useEffect(() => {
    if (estCharge) {
      void persisterBrouillon(brouillon);
    }
  }, [brouillon, estCharge]);

  const mettreAJourIdentite = useCallback(async (partial: Partial<IdentiteDraft>) => {
    setBrouillon((precedent) => ({
      ...precedent,
      identite: { ...precedent.identite, ...partial },
      derniere_mise_a_jour: new Date().toISOString(),
    }));
  }, []);

  const definirCategorie = useCallback(async (categorieId: UUID) => {
    setBrouillon((precedent) => ({
      ...precedent,
      categorie_id: categorieId,
      derniere_mise_a_jour: new Date().toISOString(),
    }));
  }, []);

  const mettreAJourPieces = useCallback(async (pieces: PieceEntree[]) => {
    setBrouillon((precedent) => ({
      ...precedent,
      pieces,
      derniere_mise_a_jour: new Date().toISOString(),
    }));
  }, []);

  const mettreAJourOeuvres = useCallback(async (oeuvres: OeuvreAdhesionEntree[]) => {
    setBrouillon((precedent) => ({
      ...precedent,
      oeuvres,
      derniere_mise_a_jour: new Date().toISOString(),
    }));
  }, []);

  const definirIdentifiantsDossier = useCallback(async (numeroDossier: string, codeSuivi: string, demandeId?: UUID | null) => {
    setBrouillon((precedent) => ({
      ...precedent,
      numero_dossier: numeroDossier,
      code_suivi: codeSuivi,
      demande_id: demandeId ?? precedent.demande_id,
      derniere_mise_a_jour: new Date().toISOString(),
    }));
  }, []);

  const reinitialiserBrouillon = useCallback(async () => {
    // L'état initial (même référence) déclenche l'effacement d'AsyncStorage ET du trousseau.
    setBrouillon(BROUILLON_INITIAL);
  }, []);

  const age = useMemo(() => {
    if (!brouillon.identite.date_naissance) {
      return null;
    }
    return calculerAge(brouillon.identite.date_naissance);
  }, [brouillon.identite.date_naissance]);

  const estMoinsDe15Ans = age !== null && age < 15;
  const estMineur15A17 = age !== null && age >= 15 && age < 18;

  const identiteEstValide = useMemo(() => {
    const i = brouillon.identite;
    if (!i.nom.trim() || !i.prenom.trim()) return false;
    if (!i.pseudonyme.trim()) return false;
    if (!i.cin.trim() || !/^\d{12}$/.test(i.cin.trim())) return false;
    if (!i.telephone.trim() || !i.telephone.startsWith('+261') || i.telephone.length < 13) return false;
    if (!i.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())) return false;
    if (!i.adresse.trim()) return false;
    if (age === null || age < 15) return false;
    return true;
  }, [age, brouillon.identite]);

  const valeur = useMemo<AdhesionDraftContextType>(
    () => ({
      brouillon,
      estCharge,
      mettreAJourIdentite,
      definirCategorie,
      mettreAJourPieces,
      mettreAJourOeuvres,
      definirIdentifiantsDossier,
      reinitialiserBrouillon,
      age,
      estMineur15A17,
      estMoinsDe15Ans,
      identiteEstValide,
    }),
    [
      age,
      brouillon,
      definirCategorie,
      definirIdentifiantsDossier,
      estCharge,
      estMineur15A17,
      estMoinsDe15Ans,
      identiteEstValide,
      mettreAJourIdentite,
      mettreAJourOeuvres,
      mettreAJourPieces,
      reinitialiserBrouillon,
    ],
  );

  return (
    <AdhesionDraftContext.Provider value={valeur}>
      {children}
    </AdhesionDraftContext.Provider>
  );
}

export function useAdhesionDraft(): AdhesionDraftContextType {
  const contexte = useContext(AdhesionDraftContext);
  if (!contexte) {
    throw new Error('useAdhesionDraft doit être utilisé dans un AdhesionDraftProvider');
  }
  return contexte;
}

