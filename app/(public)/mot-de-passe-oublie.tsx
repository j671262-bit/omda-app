import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  Icone,
  InfoBanner,
  ScreenContainer,
  TextField,
} from '../../src/components/ui';
import { useAuth } from '../../src/context/AuthContext';
import type { ErreurApp } from '../../src/services/contracts';

/**
 * Écran F — Mot de passe oublié (public, sans menu).
 *
 * Règle critique : confirmation sans JAMAIS révéler si le compte existe.
 * La même confirmation bienveillante est affichée dans tous les cas.
 */

function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service de réinitialisation est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

export default function MotDePasseOublieScreen() {
  const { demanderReinitialisation } = useAuth();

  const [email, setEmail] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = useCallback(async () => {
    const emailNettoye = email.trim().toLowerCase();
    if (!emailNettoye) {
      setErreur('Veuillez saisir votre adresse e-mail.');
      return;
    }

    setEnCours(true);
    setErreur(null);

    const resultat = await demanderReinitialisation(emailNettoye);
    setEnCours(false);

    if (!resultat.ok) {
      setErreur(traduireErreur(resultat.erreur));
      return;
    }

    // Succès : confirmation affichée SANS révéler si le compte existe.
    setConfirme(true);
  }, [demanderReinitialisation, email]);

  const reinitialiser = useCallback(() => {
    setConfirme(false);
    setEmail('');
    setErreur(null);
  }, []);

  return (
    <ScreenContainer titre="Mot de passe oublié" sousTitre="Espace membre">
      {confirme ? (
        <View className="gap-5">
          <View className="items-center rounded-2xl border border-omda-borderGray bg-omda-white p-6">
            <Icone
              nom="envelope-circle-check"
              taille={44}
              classeCouleur="text-omda-black"
              libelleAccessibilite="Instructions envoyées"
            />

            <Text className="mt-4 text-center text-xl font-bold text-omda-black">
              Instructions envoyées
            </Text>

            <Text className="mt-3 text-center text-base text-omda-textGray">
              Si un compte membre OMDA est associé à l’adresse{' '}
              <Text className="font-semibold text-omda-black">{email.trim().toLowerCase()}</Text>, un
              e-mail contenant les instructions de réinitialisation vient de vous être envoyé.
            </Text>

            <Text className="mt-2 text-center text-sm text-omda-textGray">
              Pensez à vérifier vos courriers indésirables si vous ne recevez rien d’ici quelques
              minutes.
            </Text>
          </View>

          <View className="gap-3">
            <Button
              libelle="Revenir à la connexion"
              icone="right-to-bracket"
              pleineLargeur
              onPress={() => router.push('/(public)/connexion')}
            />

            <Button
              libelle="Saisir une autre adresse"
              variante="secondary"
              pleineLargeur
              onPress={reinitialiser}
            />

            <Button
              libelle="Retour à l’accueil"
              variante="secondary"
              pleineLargeur
              onPress={() => router.push('/(public)/accueil')}
            />
          </View>
        </View>
      ) : (
        <View className="gap-5">
          <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            <Text className="text-base font-bold text-omda-black">
              Réinitialisation de votre mot de passe
            </Text>
            <Text className="mt-1 text-sm text-omda-textGray">
              Indiquez l’adresse e-mail avec laquelle vous avez adhéré à l’OMDA. Nous vous enverrons un
              lien sécurisé pour définir un nouveau mot de passe.
            </Text>

            <View className="mt-4">
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
            </View>

            {erreur ? (
              <View className="mt-4">
                <InfoBanner variante="error" titre="Envoi impossible" message={erreur} />
              </View>
            ) : null}

            <View className="mt-5 gap-3">
              <Button
                libelle="Envoyer le lien de réinitialisation"
                icone="paper-plane"
                pleineLargeur
                chargement={enCours}
                desactive={email.trim().length === 0}
                onPress={() => void envoyer()}
              />

              <Button
                libelle="Revenir à la connexion"
                variante="secondary"
                icone="arrow-left"
                pleineLargeur
                desactive={enCours}
                onPress={() => router.push('/(public)/connexion')}
              />
            </View>
          </View>

          <InfoBanner
            variante="info"
            titre="Confidentialité"
            message="Pour protéger les comptes de nos membres, aucune indication sur l’existence du compte n’est communiquée sur cet écran."
          />
        </View>
      )}
    </ScreenContainer>
  );
}

