import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  InfoBanner,
  ScreenContainer,
  StepProgress,
  TextField,
} from '../../src/components/ui';
import { useAdhesionDraft } from '../../src/context/AdhesionDraftContext';

/**
 * Étape 1 — Identité (écran H du cahier des charges).
 *
 * Sans menu (navigation linéaire).
 * Champs :
 * - Nom, Prénom
 * - Pseudonyme / nom d'artiste (distinct du nom et du prénom, obligatoire — Règle métier 1)
 * - Date de naissance (format AAAA-MM-JJ) : calcul de l'âge
 *   - Si < 15 ans : redirection bloquante vers l'écran `refus-age`
 *   - Si 15–17 ans : InfoBanner indiquant l'autorisation parentale obligatoire
 * - Numéro CIN (12 chiffres)
 * - Téléphone (+261…)
 * - E-mail
 * - Adresse postale
 *
 * Sauvegarde continue dans le store persistant `AdhesionDraft`.
 */
export default function IdentiteScreen() {
  const {
    brouillon,
    mettreAJourIdentite,
    age,
    estMoinsDe15Ans,
    estMineur15A17,
  } = useAdhesionDraft();

  const identite = brouillon.identite;
  const [tentativeSoumission, setTentativeSoumission] = useState(false);

  const validerNom = (val: string) => (!val.trim() ? 'Le nom est obligatoire.' : undefined);
  const validerPrenom = (val: string) => (!val.trim() ? 'Le prénom est obligatoire.' : undefined);
  const validerPseudonyme = (val: string) =>
    !val.trim() ? "Le pseudonyme (ou nom d'artiste) est obligatoire." : undefined;
  const validerDate = (val: string) => {
    if (!val.trim()) return 'La date de naissance est obligatoire.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
      return 'Format attendu : AAAA-MM-JJ (ex. 1996-04-12).';
    }
    const d = new Date(`${val.trim()}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      return 'La date de naissance est invalide.';
    }
    return undefined;
  };

  const validerCin = (val: string) => {
    const propre = val.replace(/\s+/g, '');
    if (!propre) return 'Le numéro de CIN est obligatoire.';
    if (!/^\d{12}$/.test(propre)) {
      return 'Le numéro de CIN doit comporter exactement 12 chiffres.';
    }
    return undefined;
  };

  const validerTelephone = (val: string) => {
    const propre = val.replace(/\s+/g, '');
    if (!propre || propre === '+261') return 'Le numéro de téléphone est obligatoire.';
    if (!propre.startsWith('+261')) {
      return 'Le numéro doit commencer par l’indicatif +261.';
    }
    if (propre.length < 13) {
      return 'Numéro incomplet : 9 chiffres requis après +261.';
    }
    return undefined;
  };

  const validerEmail = (val: string) => {
    const propre = val.trim();
    if (!propre) return 'L’adresse e-mail est obligatoire.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propre)) {
      return 'Indiquez une adresse e-mail valide.';
    }
    return undefined;
  };

  const validerAdresse = (val: string) => (!val.trim() ? 'L’adresse est obligatoire.' : undefined);

  const erreurNom = tentativeSoumission ? validerNom(identite.nom) : undefined;
  const erreurPrenom = tentativeSoumission ? validerPrenom(identite.prenom) : undefined;
  const erreurPseudonyme = tentativeSoumission ? validerPseudonyme(identite.pseudonyme) : undefined;
  const erreurDate = tentativeSoumission ? validerDate(identite.date_naissance) : undefined;
  const erreurCin = tentativeSoumission ? validerCin(identite.cin) : undefined;
  const erreurTelephone = tentativeSoumission ? validerTelephone(identite.telephone) : undefined;
  const erreurEmail = tentativeSoumission ? validerEmail(identite.email) : undefined;
  const erreurAdresse = tentativeSoumission ? validerAdresse(identite.adresse) : undefined;

  const verifierEtContinuer = useCallback(() => {
    setTentativeSoumission(true);

    const errN = validerNom(identite.nom);
    const errP = validerPrenom(identite.prenom);
    const errD = validerDate(identite.date_naissance);
    const errC = validerCin(identite.cin);
    const errT = validerTelephone(identite.telephone);
    const errE = validerEmail(identite.email);
    const errA = validerAdresse(identite.adresse);

    if (errN || errP || errD || errC || errT || errE || errA) {
      return;
    }

    if (estMoinsDe15Ans) {
      router.push('/(adhesion)/refus-age');
      return;
    }

    router.push('/(adhesion)/categorie');
  }, [estMoinsDe15Ans, identite]);

  return (
    <ScreenContainer titre="Identité" sousTitre="Demande d’adhésion">
      <StepProgress etapeCourante={1} />

      <Text className="text-base text-omda-textGray">
        Renseignez vos coordonnées exactes telles qu’elles figurent sur votre pièce d’identité.
      </Text>

      {estMineur15A17 ? (
        <View className="mt-4">
          <InfoBanner
            variante="info"
            titre="Candidat mineur (15 à 17 ans)"
            message="Une autorisation parentale signée sera obligatoirement demandée à l’étape 3 (Documents & œuvres)."
          />
        </View>
      ) : null}

      {estMoinsDe15Ans ? (
        <View className="mt-4">
          <InfoBanner
            variante="error"
            titre="Âge minimal non atteint"
            message="L’adhésion à l’OMDA est ouverte à partir de 15 ans. Vous ne pouvez pas poursuivre cette demande."
            actionLibelle="Consulter les règles d’âge"
            onAction={() => router.push('/(adhesion)/refus-age')}
          />
        </View>
      ) : null}

      <View className="mt-5 gap-4">
        <TextField
          libelle="Nom de famille"
          valeur={identite.nom}
          placeholder="RAKOTO"
          obligatoire
          erreur={erreurNom}
          onChangeValeur={(val) => void mettreAJourIdentite({ nom: val })}
        />

        <TextField
          libelle="Prénom(s)"
          valeur={identite.prenom}
          placeholder="Jean"
          obligatoire
          erreur={erreurPrenom}
          onChangeValeur={(val) => void mettreAJourIdentite({ prenom: val })}
        />

        <TextField
          libelle="Pseudonyme / nom d'artiste"
          valeur={identite.pseudonyme}
          placeholder="Rakoto Chanteur"
          aide="Distinct de votre nom et prénom officiels"
          obligatoire
          erreur={erreurPseudonyme}
          onChangeValeur={(val) => void mettreAJourIdentite({ pseudonyme: val.trim() })}
        />

        <TextField
          libelle="Date de naissance"
          valeur={identite.date_naissance}
          placeholder="1996-04-12"
          aide="Format : AAAA-MM-JJ"
          clavier="numeric"
          maxCaracteres={10}
          obligatoire
          erreur={erreurDate}
          onChangeValeur={(val) => {
            void mettreAJourIdentite({ date_naissance: val });
          }}
        />

        {age !== null && !estMoinsDe15Ans ? (
          <Text className="text-sm font-semibold text-omda-textGray">
            {`Âge calculé : ${age} an${age > 1 ? 's' : ''}`}
          </Text>
        ) : null}

        <TextField
          libelle="Numéro de CIN"
          valeur={identite.cin}
          placeholder="101234567890"
          aide="12 chiffres consécutifs"
          clavier="numeric"
          maxCaracteres={12}
          obligatoire
          erreur={erreurCin}
          onChangeValeur={(val) => void mettreAJourIdentite({ cin: val.replace(/\s+/g, '') })}
        />

        <TextField
          libelle="Téléphone (+261)"
          valeur={identite.telephone}
          placeholder="+261 34 12 345 67"
          aide="Format international (+261…)"
          clavier="phone-pad"
          obligatoire
          erreur={erreurTelephone}
          onChangeValeur={(val) => void mettreAJourIdentite({ telephone: val })}
        />

        <TextField
          libelle="Adresse e-mail"
          valeur={identite.email}
          placeholder="auteur@example.mg"
          aide="Vos avis de traitement et identifiants y seront transmis"
          clavier="email-address"
          obligatoire
          erreur={erreurEmail}
          onChangeValeur={(val) => void mettreAJourIdentite({ email: val.trim() })}
        />

        <TextField
          libelle="Adresse de résidence"
          valeur={identite.adresse}
          placeholder="Lot 12 Bis, Antananarivo 101"
          multiligne
          obligatoire
          erreur={erreurAdresse}
          onChangeValeur={(val) => void mettreAJourIdentite({ adresse: val })}
        />
      </View>

      <View className="mt-8 gap-3">
        <Button
          libelle="Continuer vers la catégorie"
          pleineLargeur
          onPress={verifierEtContinuer}
        />
      </View>
    </ScreenContainer>
  );
}


