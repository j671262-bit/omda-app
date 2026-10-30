/**
 * `AuthService` réel, branché sur Supabase Auth (étape 17).
 *
 * Instancié par `src/services/factory.ts` (`authService`).
 *
 * Les refus Supabase sont traduits en `Result` :
 * - `reseau`  : incident de transport (fetch, timeout) → « Vérifiez votre connexion » ;
 * - `serveur` : réponse inexploitable ou incident Supabase ;
 * - `metier`  : refus explicite (`CODES_ERREUR_AUTH`) affichable tel quel.
 *
 * Aucune exception ne remonte à l'UI.
 */
import type { AuthError, Session, User } from '@supabase/supabase-js';

import type { Utilisateur } from '../../models';
import {
  CODES_ERREUR_AUTH,
  erreurMetier,
  erreurReseau,
  erreurServeur,
  ok,
  type AuthService,
  type ChangerMotDePasseEntree,
  type ConnexionEntree,
  type Result,
  type ResultErr,
  type SessionMembre,
} from '../contracts';
import { estSupabaseConfigure, getSupabaseClient, MESSAGE_SUPABASE_NON_CONFIGURE } from './client';

/** Détail technique d'une exception (journal seulement, jamais affiché brut). */
function texteDe(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return undefined;
}

/**
 * Drapeaux `doit_changer_mot_de_passe` lus dans la table `utilisateur`
 * (règle métier 10), mémoïsés par identifiant de compte : les événements de
 * session synchrones (`onAuthStateChange`) voient alors la même valeur que
 * les lectures explicites après connexion.
 */
const drapeauxChangementMotDePasse = new Map<string, boolean>();

/**
 * Recharge le drapeau depuis la table `utilisateur` APRÈS connexion.
 *
 * Lecture simple sur la ligne du compte connecté (politique
 * `utilisateur_select_self_or_staff`). En cas d'échec (réseau, politique
 * absente, ligne introuvable), le cache puis les métadonnées de session
 * restent utilisés : aucune exception ne remonte et le routing continue de
 * fonctionner avec le repli de l'étape 17.
 */
async function chargerDrapeauChangement(user: User): Promise<void> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('utilisateur')
      .select('doit_changer_mot_de_passe')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && data && typeof data.doit_changer_mot_de_passe === 'boolean') {
      drapeauxChangementMotDePasse.set(user.id, data.doit_changer_mot_de_passe);
    }
  } catch {
    // Repli silencieux sur les métadonnées de session.
  }
}

/**
 * Drapeau en vigueur pour le compte : table `utilisateur` dès qu'elle a pu
 * être lue (valeur mémorisée), sinon métadonnées `user_metadata`
 * (repli de l'étape 17, comportement inchangé en l'absence de base).
 */
function drapeauChangement(user: User): boolean {
  const memorise = drapeauxChangementMotDePasse.get(user.id);
  if (typeof memorise === 'boolean') {
    return memorise;
  }
  const metadonnees = (user.user_metadata ?? {}) as Record<string, unknown>;
  return metadonnees.doit_changer_mot_de_passe === true;
}

/**
 * Traduit une erreur Supabase Auth en `Result` typé.
 *
 * Les messages sont volontairement en français (vouvoiement) et ne reprennent
 * pas le texte anglais de Supabase ; `error.code` sert de référence technique.
 */
function classerErreurAuth(error: AuthError): ResultErr {
  const message = (error.message ?? '').toLowerCase();

  if (
    error.name === 'AuthRetryableFetchError' ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return erreurReseau(message || undefined);
  }

  if (error.status === 429 || message.includes('too many') || message.includes('rate limit')) {
    return erreurMetier(
      CODES_ERREUR_AUTH.TROP_DE_TENTATIVES,
      'Trop de tentatives échouées. Réessayez dans quelques minutes ou réinitialisez votre mot de passe.',
    );
  }

  if (message.includes('invalid login credentials') || message.includes('invalid_grant')) {
    return erreurMetier(CODES_ERREUR_AUTH.IDENTIFIANTS_INVALIDES, 'E-mail ou mot de passe incorrect.');
  }

  if (message.includes('email not confirmed')) {
    return erreurMetier(
      CODES_ERREUR_AUTH.EMAIL_NON_CONFIRME,
      'Votre adresse e-mail n’a pas encore été confirmée. Vérifiez votre boîte de réception.',
    );
  }

  if (message.includes('banned') || message.includes('disabled')) {
    return erreurMetier(
      CODES_ERREUR_AUTH.COMPTE_DESACTIVE,
      'Votre compte est désactivé. Contactez l’OMDA pour le réactiver.',
    );
  }

  if (message.includes('weak') || message.includes('at least') || message.includes('should be')) {
    return erreurMetier(
      CODES_ERREUR_AUTH.MOT_DE_PASSE_FAIBLE,
      'Le mot de passe ne respecte pas la politique de sécurité demandée.',
    );
  }

  return erreurServeur({
    reference: error.code ?? undefined,
    message: 'La connexion au service d’authentification a échoué. Réessayez dans un instant.',
  });
}

/**
 * Compte applicatif reconstruit depuis l'utilisateur Supabase.
 *
 * `role` est `MEMBRE` : l'application mobile ne sert que les adhérents (les
 * agents et administrateurs travaillent hors mobile). `statut` reflète le
 * drapeau de première connexion (`doit_changer_mot_de_passe`, règle métier 10).
 */
function utilisateurDepuisSupabase(user: User): Utilisateur {
  const metadonnees = (user.user_metadata ?? {}) as Record<string, unknown>;
  const telephone = typeof metadonnees.telephone === 'string' ? metadonnees.telephone : null;
  const doitChanger = drapeauChangement(user);
  const cree = user.created_at ?? new Date().toISOString();

  // Le rôle est lu depuis les métadonnées de session Supabase. Seuls les
  // comptes `role = 'MEMBRE'` utilisent l'application mobile (les agents et
  // administrateurs travaillent hors mobile). Le repli sur 'MEMBRE' conserve
  // la compatibilité avec les comptes créés avant ce contrôle.
  const role = typeof metadonnees.role === 'string' ? metadonnees.role : 'MEMBRE';

  return {
    id: user.id,
    email: user.email ?? '',
    telephone,
    role: role as 'MEMBRE' | 'AGENT' | 'ADMINISTRATEUR',
    statut: doitChanger ? 'EN_ATTENTE_CHANGEMENT_MDP' : 'ACTIF',
    doit_changer_mot_de_passe: doitChanger,
    derniere_connexion_at: user.last_sign_in_at ?? null,
    created_at: cree,
    updated_at: cree,
  };
}

/**
 * Session applicative construite depuis la session Supabase.
 *
 * `membre` reste `null` : le profil adhérent appartient à `MemberRepository`
 * (table `membre`), pas à l'authentification.
 */
function sessionDepuisSupabase(user: User, session: Session): SessionMembre {
  const utilisateur = utilisateurDepuisSupabase(user);
  const expire =
    typeof session.expires_at === 'number'
      ? new Date(session.expires_at * 1000).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return {
    utilisateur,
    membre: null,
    doit_changer_mot_de_passe: utilisateur.doit_changer_mot_de_passe,
    jeton_acces: session.access_token,
    expire_at: expire,
  };
}

/**
 * `AuthService` réel (Supabase Auth).
 *
 * Correspondance avec le contrat :
 * - `connecter`                 → `signInWithPassword`
 * - `deconnecter`               → `signOut`
 * - `obtenirSession`            → `getSession` (session restaurée au démarrage)
 * - `demanderReinitialisationMotDePasse` → `resetPasswordForEmail` (réponse
 *   constante : aucune fuite sur l'existence du compte)
 * - `doit_changer_mot_de_passe` relu dans la table `utilisateur` après
 *   connexion (règle métier 10), repli sur `user_metadata` si la lecture
 *   échoue ; remis à `false` en base lors du changement
 * - `changerMotDePasse`         → vérification du mot de passe actuel par
 *   ré-authentification puis `updateUser` (mot de passe + drapeau de première
 *   connexion remis à `false`)
 * - `ecouterSession`            → `onAuthStateChange`
 */
export class SupabaseAuthService implements AuthService {
  /** Connexion e-mail + mot de passe. */
  async connecter(entree: ConnexionEntree): Promise<Result<SessionMembre>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const { data, error } = await getSupabaseClient().auth.signInWithPassword({
        email: entree.email.trim().toLowerCase(),
        password: entree.mot_de_passe,
      });
      if (error) {
        return classerErreurAuth(error);
      }
      if (!data.user || !data.session) {
        return erreurServeur({
          message: 'Réponse d’authentification incomplète. Réessayez dans un instant.',
        });
      }
      await chargerDrapeauChangement(data.user);
      const session = sessionDepuisSupabase(data.user, data.session);
      if (session.utilisateur.role !== 'MEMBRE') {
        return erreurMetier(
          CODES_ERREUR_AUTH.COMPTE_DESACTIVE,
          'Ce compte n’est pas autorisé à accéder à l’application mobile OMDA.',
        );
      }
      return ok(session);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Déconnexion (retour au parcours public, sans menu). */
  async deconnecter(): Promise<Result<void>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const { error } = await getSupabaseClient().auth.signOut();
      if (error) {
        return classerErreurAuth(error);
      }
      drapeauxChangementMotDePasse.clear();
      return ok(undefined);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Session en cours (restaurée au démarrage), `null` si non connecté. */
  async obtenirSession(): Promise<Result<SessionMembre | null>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const { data, error } = await getSupabaseClient().auth.getSession();
      if (error) {
        return classerErreurAuth(error);
      }
      if (!data.session || !data.session.user) {
        return ok(null);
      }
      await chargerDrapeauChangement(data.session.user);
      const session = sessionDepuisSupabase(data.session.user, data.session);
      if (session.utilisateur.role !== 'MEMBRE') {
        return erreurMetier(
          CODES_ERREUR_AUTH.COMPTE_DESACTIVE,
          'Ce compte n’est pas autorisé à accéder à l’application mobile OMDA.',
        );
      }
      return ok(session);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /**
   * Demande de réinitialisation : la réponse est TOUJOURS un succès, que le
   * compte existe ou non (aucune fuite d'information).
   */
  async demanderReinitialisationMotDePasse(entree: { email: string }): Promise<Result<void>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
        entree.email.trim().toLowerCase(),
      );
      if (error) {
        // Si Supabase annonce l'absence de compte, la réponse reste IDENTIQUE
        // à celle d'un compte existant : aucune fuite d'information.
        const texte = (error.message ?? '').toLowerCase();
        const code = (error.code ?? '').toLowerCase();
        const compteInconnu =
          code === 'user_not_found' ||
          texte.includes('user not found') ||
          texte.includes('could not find user') ||
          texte.includes('no user found') ||
          texte.includes('email address not found');
        if (compteInconnu) {
          return ok(undefined);
        }
        return classerErreurAuth(error);
      }
      return ok(undefined);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Changement de mot de passe (obligatoire à la première connexion). */
  async changerMotDePasse(entree: ChangerMotDePasseEntree): Promise<Result<SessionMembre>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    if (entree.nouveau_mot_de_passe !== entree.confirmation_mot_de_passe) {
      return erreurMetier(
        CODES_ERREUR_AUTH.CONFIRMATION_DIFFERENTE,
        'Les deux mots de passe saisis ne sont pas identiques.',
      );
    }

    try {
      const client = getSupabaseClient();
      const { data: sessionData, error: erreurSession } = await client.auth.getSession();
      if (erreurSession) {
        return classerErreurAuth(erreurSession);
      }
      const email = sessionData.session?.user.email ?? null;
      const identifiant = sessionData.session?.user.id ?? null;
      if (!email || !identifiant) {
        return erreurMetier(
          CODES_ERREUR_AUTH.SESSION_EXPIREE,
          'Votre session a expiré. Reconnectez-vous pour continuer.',
        );
      }

      // Vérification du mot de passe actuel par ré-authentification.
      const verification = await client.auth.signInWithPassword({
        email,
        password: entree.mot_de_passe_actuel,
      });
      if (verification.error) {
        return erreurMetier(
          CODES_ERREUR_AUTH.IDENTIFIANTS_INVALIDES,
          'Le mot de passe actuel est incorrect.',
        );
      }
      if (entree.nouveau_mot_de_passe === entree.mot_de_passe_actuel) {
        return erreurMetier(
          CODES_ERREUR_AUTH.MOT_DE_PASSE_IDENTIQUE,
          'Choisissez un mot de passe différent de l’ancien.',
        );
      }

      const miseAJour = await client.auth.updateUser({
        password: entree.nouveau_mot_de_passe,
        data: { doit_changer_mot_de_passe: false },
      });
      if (miseAJour.error) {
        return classerErreurAuth(miseAJour.error);
      }

      // Règle métier 10 : le drapeau repasse à `false` EN BASE (table
      // `utilisateur`, politique `utilisateur_update_self_or_admin`) et en
      // mémoire — la prochaine connexion ne rebloque donc pas l'écran.
      drapeauxChangementMotDePasse.set(identifiant, false);
      try {
        await client
          .from('utilisateur')
          .update({ doit_changer_mot_de_passe: false })
          .eq('id', identifiant);
      } catch {
        // Échec best-effort : les métadonnées de session restent à jour.
      }

      const { data: apres, error: erreurApres } = await client.auth.getSession();
      if (erreurApres) {
        return classerErreurAuth(erreurApres);
      }
      if (!apres.session || !apres.session.user) {
        return erreurMetier(
          CODES_ERREUR_AUTH.SESSION_EXPIREE,
          'Votre session a expiré. Reconnectez-vous pour continuer.',
        );
      }
      return ok(sessionDepuisSupabase(apres.session.user, apres.session));
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Abonnement aux changements de session ; renvoie la fonction de désabonnement. */
  ecouterSession(rappel: (session: SessionMembre | null) => void): () => void {
    if (!estSupabaseConfigure()) {
      return () => undefined;
    }
    const { data } = getSupabaseClient().auth.onAuthStateChange((_evenement, session) => {
      if (!session || !session.user) {
        drapeauxChangementMotDePasse.clear();
        rappel(null);
        return;
      }
      rappel(sessionDepuisSupabase(session.user, session));
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }
}

