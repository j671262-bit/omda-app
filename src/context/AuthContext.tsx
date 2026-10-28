import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  ChangerMotDePasseEntree,
  ConnexionEntree,
  Result,
  SessionMembre,
} from '../services/contracts';
import { authService } from '../services/factory';

/**
 * Contexte d'authentification MEMBRE (Supabase Auth).
 *
 * Règles :
 * - `session = null` => visiteur / candidat (espace public) ;
 * - `session.doit_changer_mot_de_passe = true` => route bloquante `(auth-required)` ;
 * - `session.doit_changer_mot_de_passe = false` => espace connecté `(membre)`.
 */

export type AuthContextType = {
  session: SessionMembre | null;
  estCharge: boolean;
  estConnecte: boolean;
  doitChangerMotDePasse: boolean;
  connecter: (entree: ConnexionEntree) => Promise<Result<SessionMembre>>;
  deconnecter: () => Promise<Result<void>>;
  changerMotDePasse: (entree: ChangerMotDePasseEntree) => Promise<Result<SessionMembre>>;
  demanderReinitialisation: (email: string) => Promise<Result<void>>;
  rafraichirSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionMembre | null>(null);
  const [estCharge, setEstCharge] = useState(false);

  const rafraichirSession = useCallback(async () => {
    const resultat = await authService.obtenirSession();
    if (resultat.ok) {
      setSession(resultat.valeur);
    }
    setEstCharge(true);
  }, []);

  useEffect(() => {
    void rafraichirSession();
    const desabonner = authService.ecouterSession((nouvelleSession) => {
      setSession(nouvelleSession);
      setEstCharge(true);
    });
    return desabonner;
  }, [rafraichirSession]);

  const connecter = useCallback(async (entree: ConnexionEntree) => {
    const resultat = await authService.connecter(entree);
    if (resultat.ok) {
      setSession(resultat.valeur);
    }
    return resultat;
  }, []);

  const deconnecter = useCallback(async () => {
    const resultat = await authService.deconnecter();
    if (resultat.ok) {
      setSession(null);
    }
    return resultat;
  }, []);

  const changerMotDePasse = useCallback(async (entree: ChangerMotDePasseEntree) => {
    const resultat = await authService.changerMotDePasse(entree);
    if (resultat.ok) {
      setSession(resultat.valeur);
    }
    return resultat;
  }, []);

  const demanderReinitialisation = useCallback(async (email: string) => {
    return authService.demanderReinitialisationMotDePasse({ email });
  }, []);

  const valeur = useMemo<AuthContextType>(
    () => ({
      session,
      estCharge,
      estConnecte: session !== null,
      doitChangerMotDePasse: Boolean(session?.doit_changer_mot_de_passe),
      connecter,
      deconnecter,
      changerMotDePasse,
      demanderReinitialisation,
      rafraichirSession,
    }),
    [
      session,
      estCharge,
      connecter,
      deconnecter,
      changerMotDePasse,
      demanderReinitialisation,
      rafraichirSession,
    ],
  );

  return <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const contexte = useContext(AuthContext);
  if (!contexte) {
    throw new Error('useAuth doit être utilisé à l’intérieur d’un AuthProvider');
  }
  return contexte;
}
