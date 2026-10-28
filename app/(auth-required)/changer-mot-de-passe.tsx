import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  TextField,
} from '../../src/components/ui';
import { useAuth } from '../../src/context/AuthContext';
import {
  CODES_ERREUR_AUTH,
  REGLES_MOT_DE_PASSE,
  type ErreurApp,
} from '../../src/services/contracts';

/**
 * Écran G — Changement obligatoire de mot de passe (bloquant, sans retour).
 */

function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  if (erreur.type === 'serveur') {
    return 'Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.';
  }
  if (erreur.code === CODES_ERREUR_AUTH.IDENTIFIANTS_INVALIDES) {
    return 'Le mot de passe actuel est incorrect. Veuillez vérifier votre saisie.';
  }
  if (erreur.code === CODES_ERREUR_AUTH.CONFIRMATION_DIFFERENTE) {
    return 'Les deux mots de passe saisis ne sont pas identiques.';
  }
  if (erreur.code === CODES_ERREUR_AUTH.MOT_DE_PASSE_IDENTIQUE) {
    return 'Le nouveau mot de passe doit être différent de l’actuel.';
  }
  if (erreur.code === CODES_ERREUR_AUTH.MOT_DE_PASSE_FAIBLE) {
    return erreur.message;
  }
  if (erreur.code === CODES_ERREUR_AUTH.SESSION_EXPIREE) {
    return 'Votre session a expiré. Veuillez vous reconnecter.';
  }
  return erreur.message;
}

export default function ChangerMotDePasseScreen() {
  const { session, estCharge, changerMotDePasse, deconnecter } = useAuth();

  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const reglesValidees = useMemo(() => {
    return {
      longueur: nouveau.length >= REGLES_MOT_DE_PASSE.longueur_min,
      majuscule: !REGLES_MOT_DE_PASSE.exige_majuscule || /[A-Z]/.test(nouveau),
      minuscule: !REGLES_MOT_DE_PASSE.exige_minuscule || /[a-z]/.test(nouveau),
      chiffre: !REGLES_MOT_DE_PASSE.exige_chiffre || /[0-9]/.test(nouveau),
      correspondance: confirmation.length > 0 && nouveau === confirmation,
    };
  }, [confirmation, nouveau]);

  const formulairePret =
    actuel.length > 0 &&
    nouveau.length >= REGLES_MOT_DE_PASSE.longueur_min &&
    confirmation.length > 0 &&
    nouveau === confirmation &&
    reglesValidees.majuscule &&
    reglesValidees.minuscule &&
    reglesValidees.chiffre;

  const soumettre = useCallback(async () => {
    if (!formulairePret) {
      if (nouveau !== confirmation) {
        setErreur('Les deux mots de passe ne correspondent pas.');
        return;
      }
      setErreur('Veuillez respecter toutes les règles de sécurité indiquées.');
      return;
    }

    setEnCours(true);
    setErreur(null);

    const resultat = await changerMotDePasse({
      mot_de_passe_actuel: actuel,
      nouveau_mot_de_passe: nouveau,
      confirmation_mot_de_passe: confirmation,
    });

    setEnCours(false);

    if (!resultat.ok) {
      setErreur(traduireErreur(resultat.erreur));
      return;
    }

    // Le mot de passe a été changé : l'utilisateur entre dans l'espace membre.
    router.replace('/(membre)/(tabs)/accueil');
  }, [actuel, changerMotDePasse, confirmation, formulairePret, nouveau]);

  const annulerEtDeconnecter = useCallback(async () => {
    setEnCours(true);
    await deconnecter();
    setEnCours(false);
    router.replace('/(public)/connexion');
  }, [deconnecter]);

  if (!estCharge) {
    return (
      <ScreenContainer
        titre="Changement obligatoire"
        sousTitre="Première connexion"
        afficherRetour={false}
      >
        <LoadingState message="Vérification de votre compte…" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      titre="Changement de mot de passe"
      sousTitre="Obligatoire à la première connexion"
      afficherRetour={false}
    >
      <View className="gap-5">
        <InfoBanner
          variante="pending"
          titre="Sécurisation de votre compte"
          message="Il s’agit de votre première connexion à l’espace membre OMDA. Pour protéger vos œuvres et vos données, vous devez définir un mot de passe personnel avant de continuer."
        />

        <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <Text className="text-base font-bold text-omda-black">Nouveau mot de passe</Text>
          {session?.utilisateur?.email ? (
            <Text className="mt-1 text-sm text-omda-textGray">
              Compte : <Text className="font-semibold text-omda-black">{session.utilisateur.email}</Text>
            </Text>
          ) : null}

          <View className="mt-4 gap-3">
            <TextField
              libelle="Mot de passe temporaire ou actuel"
              valeur={actuel}
              onChangeValeur={(valeur) => {
                setActuel(valeur);
                if (erreur) setErreur(null);
              }}
              placeholder="Saisissez le mot de passe reçu"
              securise
              desactive={enCours}
              obligatoire
            />

            <TextField
              libelle="Nouveau mot de passe personnel"
              valeur={nouveau}
              onChangeValeur={(valeur) => {
                setNouveau(valeur);
                if (erreur) setErreur(null);
              }}
              placeholder="Votre nouveau mot de passe"
              securise
              desactive={enCours}
              obligatoire
            />

            <TextField
              libelle="Confirmation du nouveau mot de passe"
              valeur={confirmation}
              onChangeValeur={(valeur) => {
                setConfirmation(valeur);
                if (erreur) setErreur(null);
              }}
              placeholder="Répétez le nouveau mot de passe"
              securise
              desactive={enCours}
              obligatoire
            />
          </View>
          {/* Règles visibles */}
          <View className="mt-5 rounded-xl border border-omda-borderGray bg-omda-warmGray p-4">
            <Text className="text-sm font-bold text-omda-black">
              Règles de sécurité requises :
            </Text>
            <View className="mt-2 gap-1.5">
              <LigneRegle
                validee={reglesValidees.longueur}
                libelle={`Au moins ${REGLES_MOT_DE_PASSE.longueur_min} caractères`}
              />
              <LigneRegle
                validee={reglesValidees.majuscule}
                libelle="Au moins une lettre majuscule (A-Z)"
              />
              <LigneRegle
                validee={reglesValidees.minuscule}
                libelle="Au moins une lettre minuscule (a-z)"
              />
              <LigneRegle validee={reglesValidees.chiffre} libelle="Au moins un chiffre (0-9)" />
              {confirmation.length > 0 ? (
                <LigneRegle
                  validee={reglesValidees.correspondance}
                  libelle="Les deux mots de passe correspondent"
                />
              ) : null}
            </View>
          </View>

          {erreur ? (
            <View className="mt-4">
              <InfoBanner variante="error" titre="Impossible de valider" message={erreur} />
            </View>
          ) : null}

          <View className="mt-5 gap-3">
            <Button
              libelle="Valider mon nouveau mot de passe"
              icone="lock"
              pleineLargeur
              chargement={enCours}
              desactive={!formulairePret}
              onPress={() => void soumettre()}
            />

            <Button
              libelle="Annuler et me déconnecter"
              variante="secondary"
              pleineLargeur
              desactive={enCours}
              onPress={() => void annulerEtDeconnecter()}
            />
          </View>
        </View>

        <InfoBanner
          variante="info"
          titre="Accès bloqué"
          message="L’accès aux rubriques membres (œuvres, profil, notifications) reste inaccessible tant que cette étape n’a pas été validée."
        />
      </View>
    </ScreenContainer>
  );
}

function LigneRegle({ validee, libelle }: { validee: boolean; libelle: string }) {
  return (
    <View className="flex-row items-center">
      <Icone
        nom={validee ? 'circle-check' : 'circle'}
        taille={14}
        classeCouleur={validee ? 'text-status-success' : 'text-omda-textGray'}
      />
      <Text
        className={`ml-2 text-sm ${validee ? 'font-medium text-omda-black' : 'text-omda-textGray'}`}
      >
        {libelle}
      </Text>
    </View>
  );
}



