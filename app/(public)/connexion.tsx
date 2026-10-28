import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  TextField,
} from '../../src/components/ui';
import { useAuth } from '../../src/context/AuthContext';
import { CODES_ERREUR_AUTH, type ErreurApp } from '../../src/services/contracts';

/**
 * Écran E — Connexion membre (public, sans menu).
 */

type TypeErreurConnexion =
  | 'identifiants'
  | 'desactive'
  | 'trop_de_tentatives'
  | 'serveur'
  | 'reseau';

type ErreurAffichee = {
  type: TypeErreurConnexion;
  titre: string;
  message: string;
};

function qualifierErreur(erreur: ErreurApp): ErreurAffichee {
  if (erreur.type === 'reseau') {
    return {
      type: 'reseau',
      titre: 'Connexion réseau impossible',
      message:
        'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.',
    };
  }

  if (erreur.type === 'serveur') {
    return {
      type: 'serveur',
      titre: 'Service indisponible',
      message:
        'Le service d’authentification est momentanément indisponible. Veuillez réessayer dans quelques instants.',
    };
  }

  if (erreur.code === CODES_ERREUR_AUTH.IDENTIFIANTS_INVALIDES) {
    return {
      type: 'identifiants',
      titre: 'Identifiants incorrects',
      message:
        'L’adresse e-mail ou le mot de passe est incorrect. Vérifiez vos identifiants ou utilisez le lien « Mot de passe oublié » ci-dessous.',
    };
  }

  if (erreur.code === CODES_ERREUR_AUTH.COMPTE_DESACTIVE) {
    return {
      type: 'desactive',
      titre: 'Compte désactivé',
      message:
        'Votre compte membre a été désactivé par l’administration de l’OMDA. Veuillez contacter nos services pour en demander la réactivation.',
    };
  }

  if (erreur.code === CODES_ERREUR_AUTH.TROP_DE_TENTATIVES) {
    return {
      type: 'trop_de_tentatives',
      titre: 'Trop de tentatives',
      message:
        'Trop de tentatives de connexion consécutives ont échoué. Par mesure de sécurité, veuillez patienter quelques minutes ou réinitialiser votre mot de passe.',
    };
  }

  return {
    type: 'identifiants',
    titre: 'Connexion refusée',
    message: erreur.message,
  };
}

export default function ConnexionScreen() {
  const { connecter, estCharge } = useAuth();

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<ErreurAffichee | null>(null);

  const soumettre = useCallback(async () => {
    const emailNettoye = email.trim().toLowerCase();
    if (!emailNettoye || !motDePasse) {
      setErreur({
        type: 'identifiants',
        titre: 'Champs incomplets',
        message: 'Veuillez saisir votre adresse e-mail et votre mot de passe.',
      });
      return;
    }

    setEnCours(true);
    setErreur(null);

    const resultat = await connecter({
      email: emailNettoye,
      mot_de_passe: motDePasse,
    });

    setEnCours(false);

    if (!resultat.ok) {
      setErreur(qualifierErreur(resultat.erreur));
      return;
    }

    const session = resultat.valeur;
    if (session.doit_changer_mot_de_passe) {
      router.replace('/(auth-required)/changer-mot-de-passe');
    } else {
      router.replace('/(membre)/(tabs)/accueil');
    }
  }, [connecter, email, motDePasse]);

  if (!estCharge) {
    return (
      <ScreenContainer titre="Connexion" sousTitre="Espace membre">
        <LoadingState message="Chargement de votre espace…" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer titre="Connexion" sousTitre="Espace membre">
      <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-base font-bold text-omda-black">Identifiants membre</Text>
        <Text className="mt-1 text-sm text-omda-textGray">
          Accédez à votre espace adhérent pour gérer vos œuvres et consulter
          vos notifications.
        </Text>

        <View className="mt-4 gap-3">
          <TextField
            libelle="Adresse e-mail"
            valeur={email}
            onChangeValeur={(valeur) => {
              setEmail(valeur);
              if (erreur) setErreur(null);
            }}
            placeholder="Ex. membre@omda.mg"
            clavier="email-address"
            desactive={enCours}
            obligatoire
          />

          <TextField
            libelle="Mot de passe"
            valeur={motDePasse}
            onChangeValeur={(valeur) => {
              setMotDePasse(valeur);
              if (erreur) setErreur(null);
            }}
            placeholder="Votre mot de passe"
            securise
            desactive={enCours}
            obligatoire
          />
        </View>

        {erreur ? (
          <View className="mt-4">
            <InfoBanner
              variante="error"
              titre={erreur.titre}
              message={erreur.message}
              actionLibelle={
                erreur.type === 'trop_de_tentatives' ? 'Mot de passe oublié' : undefined
              }
              onAction={
                erreur.type === 'trop_de_tentatives'
                  ? () => router.push('/(public)/mot-de-passe-oublie')
                  : undefined
              }
            />
          </View>
        ) : null}

        <View className="mt-5 gap-3">
          <Button
            libelle="Se connecter"
            icone="right-to-bracket"
            pleineLargeur
            chargement={enCours}
            desactive={email.trim().length === 0 || motDePasse.length === 0}
            onPress={() => void soumettre()}
          />

          <Button
            libelle="Mot de passe oublié"
            variante="secondary"
            icone="key"
            pleineLargeur
            desactive={enCours}
            onPress={() => router.push('/(public)/mot-de-passe-oublie')}
          />
        </View>
      </View>

      <View className="mt-6 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-base font-bold text-omda-black">Pas encore membre ?</Text>
        <Text className="mt-1 text-sm text-omda-textGray">
          Vous avez envoyé une demande d’adhésion ou vous souhaitez devenir membre de l’OMDA ?
        </Text>

        <View className="mt-4 gap-3">
          <Button
            libelle="Suivre ma demande"
            variante="secondary"
            icone="magnifying-glass"
            pleineLargeur
            onPress={() => router.push('/(candidat)/suivi')}
          />

          <Button
            libelle="Retour à l’accueil"
            variante="secondary"
            pleineLargeur
            onPress={() => router.push('/(public)/accueil')}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}


