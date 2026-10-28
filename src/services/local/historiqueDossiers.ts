import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { HorodatageISO, StatutDemande } from '../../models';
import { erreurServeur, ok, type Result } from '../contracts';

/**
 * Historique LOCAL des dossiers d'adhésion envoyés depuis ce téléphone.
 *
 * Pourquoi : le code de suivi n'est renvoyé **en clair qu'une seule fois** par
 * le service (cf. `docs/API_CANDIDAT.md` §5.1, écran L). L'application le
 * conserve donc sur l'appareil, ce qui couvre l'action « Sauvegarder » de
 * l'écran L et permet de réafficher les informations après un redémarrage.
 *
 * Aucune donnée transmise au serveur. Le code de suivi est un SECRET (il donne accès au
 * dossier) : il est donc conservé dans le trousseau sécurisé du téléphone (`expo-secure-store`,
 * Keychain iOS / Keystore Android) et non dans `AsyncStorage`, qui n'est pas chiffré.
 * Les versions précédentes écrivaient dans `AsyncStorage` : l'ancien contenu est migré puis effacé
 * à la première lecture.
 */

/** Clé de stockage local de l'historique (versionnée, comme le brouillon). */
const CLE_STORAGE_HISTORIQUE = 'omda_historique_dossiers_v1';

/** Nombre maximum de dossiers conservés (les plus récents d'abord). */
export const LIMITE_HISTORIQUE_DOSSIERS = 5;

/** Dossier envoyé, tel que conservé sur l'appareil. */
export type DossierSoumisLocal = {
  numero_dossier: string;
  code_suivi: string;
  statut: StatutDemande;
  date_soumission: HorodatageISO;
  /** Délai indicatif renvoyé par le service lors de l'envoi (heures). */
  delai_indicatif_heures: number | null;
};

/** Message affichable en cas de panne du stockage local. */
const MESSAGE_LECTURE_IMPOSSIBLE =
  'Les informations enregistrées sur ce téléphone n’ont pas pu être lues. Veuillez réessayer.';

const MESSAGE_ECRITURE_IMPOSSIBLE =
  'L’enregistrement sur ce téléphone a échoué. Vous pouvez réessayer ou noter ces informations manuellement.';

/** Garde de lecture : une entrée corrompue est ignorée, jamais affichée. */
function estDossierSoumisLocal(valeur: unknown): valeur is DossierSoumisLocal {
  if (typeof valeur !== 'object' || valeur === null) {
    return false;
  }
  const entree = valeur as Partial<DossierSoumisLocal>;
  return (
    typeof entree.numero_dossier === 'string' &&
    entree.numero_dossier.trim().length > 0 &&
    typeof entree.code_suivi === 'string' &&
    entree.code_suivi.trim().length > 0 &&
    typeof entree.statut === 'string' &&
    typeof entree.date_soumission === 'string'
  );
}

/**
 * Dossiers envoyés conservés sur l'appareil, du plus récent au plus ancien.
 * Échec de lecture ⇒ `Result` en erreur (jamais d'exception remontée à l'UI).
 */
export async function obtenirHistoriqueDossiers(): Promise<Result<DossierSoumisLocal[]>> {
  try {
    let contenu = await SecureStore.getItemAsync(CLE_STORAGE_HISTORIQUE);
    if (!contenu) {
      // Migration unique depuis l'ancien emplacement non chiffré.
      const ancien = await AsyncStorage.getItem(CLE_STORAGE_HISTORIQUE);
      if (ancien) {
        await SecureStore.setItemAsync(CLE_STORAGE_HISTORIQUE, ancien);
        await AsyncStorage.removeItem(CLE_STORAGE_HISTORIQUE);
        contenu = ancien;
      }
    }
    if (!contenu) {
      return ok([]);
    }

    const analyse: unknown = JSON.parse(contenu);
    if (!Array.isArray(analyse)) {
      return ok([]);
    }

    return ok(analyse.filter(estDossierSoumisLocal));
  } catch (erreur) {
    console.warn('[HistoriqueDossiers] Lecture impossible :', erreur);
    return erreurServeur({ message: MESSAGE_LECTURE_IMPOSSIBLE });
  }
}

/**
 * Ajoute (ou remplace) un dossier envoyé en tête de l'historique.
 * Le même numéro de dossier n'est jamais conservé deux fois, et l'historique
 * est plafonné à `LIMITE_HISTORIQUE_DOSSIERS` entrées.
 */
export async function enregistrerDossierSoumis(
  dossier: DossierSoumisLocal,
): Promise<Result<DossierSoumisLocal[]>> {
  const existants = await obtenirHistoriqueDossiers();
  if (!existants.ok) {
    return existants;
  }

  const autres = existants.valeur.filter(
    (element) => element.numero_dossier !== dossier.numero_dossier,
  );
  const historique = [dossier, ...autres].slice(0, LIMITE_HISTORIQUE_DOSSIERS);

  try {
    await SecureStore.setItemAsync(CLE_STORAGE_HISTORIQUE, JSON.stringify(historique));
    return ok(historique);
  } catch (erreur) {
    console.warn('[HistoriqueDossiers] Écriture impossible :', erreur);
    return erreurServeur({ message: MESSAGE_ECRITURE_IMPOSSIBLE });
  }
}
