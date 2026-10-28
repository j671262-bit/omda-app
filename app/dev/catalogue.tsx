import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import {
  AmountCard,
  Button,
  EmptyState,
  ErrorState,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  SelectField,
  StatusPill,
  StepTimeline,
  TextField,
  UploadTile,
  type EtapeTimeline,
  type OptionSelect,
} from '../../src/components/ui';

/**
 * Écran de DÉVELOPPEMENT — catalogue du design system (route `/dev/catalogue`).
 *
 * Cet écran ne fait pas partie du parcours utilisateur : il sert uniquement à
 * vérifier visuellement tous les composants et leurs variantes.
 * Navigation linéaire (bouton retour), aucun menu.
 */

const AUCUNE_ACTION = () => {};

const DEMO_MONTANT_ADHESION = 150000;

/** Données de démonstration propres à cet écran de développement. */

const DEMO_CATEGORIES: OptionSelect[] = [
  { valeur: 'artiste-auteur', libelle: 'Artiste-auteur', description: 'Œuvres originales et créations' },
  { valeur: 'ecrivain', libelle: 'Écrivain', description: 'Romans, poésie, essais' },
  { valeur: 'musicien', libelle: 'Musicien', description: 'Compositions et interprétations' },
];

const DEMO_ETAPES: EtapeTimeline[] = [
  { titre: 'Demande envoyée', description: 'Dossier reçu par l’OMDA', statut: 'fait' },
  { titre: 'Vérification du dossier', description: 'Documents et œuvres en cours d’examen', statut: 'enCours' },
  { titre: 'Validation', description: 'Décision communiquée par le serveur', statut: 'aVenir' },
  { titre: 'Paiement des frais', description: 'Possible uniquement après validation', statut: 'aVenir' },
];

const DEMO_ETAPES_REJET: EtapeTimeline[] = [
  { titre: 'Demande envoyée', description: 'Dossier reçu par l’OMDA', statut: 'fait' },
  { titre: 'Vérification du dossier', description: 'Pièce illisible : veuillez renvoyer le document', statut: 'rejete' },
  { titre: 'Validation', statut: 'aVenir' },
];

/** Section du catalogue : titre + exemples empilés. */
function Section({
  titre,
  description,
  children,
}: {
  titre: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View className="mt-8">
      <Text className="text-lg font-bold text-omda-black">{titre}</Text>
      {description ? <Text className="mt-1 text-sm text-omda-textGray">{description}</Text> : null}
      <View className="mt-3 gap-4">{children}</View>
    </View>
  );
}

export default function CatalogueDeveloppement() {
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('34');
  const [adresse, setAdresse] = useState('Lot 12 Bis, Antananarivo 101');
  const [categorie, setCategorie] = useState<string | null>(null);

  const erreurTelephone =
    telephone.length > 0 && telephone.length < 9
      ? 'Le numéro est incomplet : 9 chiffres sont attendus après +261.'
      : undefined;

  return (
    <ScreenContainer
      titre="Catalogue des composants"
      sousTitre="Écran de développement — design system OMDA"
    >
      <Section titre="Boutons" description="primary / secondary / destructive, désactivé et chargement.">
        <Button libelle="Devenir membre" onPress={AUCUNE_ACTION} pleineLargeur />
        <Button
          libelle="Suivre ma demande"
          variante="secondary"
          icone="magnifying-glass"
          onPress={AUCUNE_ACTION}
          pleineLargeur
        />
        <Button libelle="Supprimer le brouillon" variante="destructive" onPress={AUCUNE_ACTION} pleineLargeur />
        <Button libelle="Action indisponible" desactive pleineLargeur />
        <Button libelle="Envoi en cours" chargement pleineLargeur />
      </Section>

      <Section titre="Champs de saisie" description="Libellé, aide, erreur, champ désactivé et liste de choix.">
        <TextField
          libelle="Nom et prénoms"
          valeur={nom}
          onChangeValeur={setNom}
          placeholder="Ex. RAKOTO Jean"
          obligatoire
        />
        <TextField
          libelle="Adresse e-mail"
          valeur={email}
          onChangeValeur={setEmail}
          clavier="email-address"
          placeholder="nom@exemple.mg"
          aide="Aucune publicité ne sera envoyée à cette adresse."
        />
        <TextField
          libelle="Téléphone (+261)"
          valeur={telephone}
          onChangeValeur={setTelephone}
          clavier="phone-pad"
          placeholder="34 12 345 67"
          erreur={erreurTelephone}
          obligatoire
        />
        <TextField
          libelle="Adresse"
          valeur={adresse}
          onChangeValeur={setAdresse}
          multiligne
          desactive
          aide="Exemple de champ en lecture seule."
        />
        <SelectField
          libelle="Catégorie"
          valeur={categorie}
          onChangeValeur={setCategorie}
          options={DEMO_CATEGORIES}
          obligatoire
          aide="Liste fournie par un service : aucune catégorie n’est codée en dur."
        />
        <SelectField
          libelle="Catégorie (liste vide renvoyée par le serveur)"
          valeur={null}
          onChangeValeur={AUCUNE_ACTION}
          options={[]}
        />
      </Section>

      <Section titre="Envoi de documents" description="Progression, statut et reprise sur erreur (20 Mo max).">
        <UploadTile libelle="Photo d’identité" statut="vide" obligatoire onSelectionner={AUCUNE_ACTION} />
        <UploadTile libelle="CIN légalisée" statut="enCours" nomFichier="cin-legalisee.pdf" progression={42} />
        <UploadTile
          libelle="Fichier de l’œuvre"
          statut="verification"
          nomFichier="oeuvre-deposee.pdf"
          message="Envoi en cours de vérification par le serveur OMDA."
        />
        <UploadTile libelle="Attestation de diffusion" statut="reussi" nomFichier="attestation-diffusion.pdf" />
        <UploadTile
          libelle="Acte de naissance"
          statut="erreur"
          nomFichier="acte-naissance.pdf"
          message="Envoi interrompu. Vérifiez votre connexion internet puis réessayez."
          onReessayer={AUCUNE_ACTION}
        />
      </Section>

      <Section titre="Statuts" description="Tokens status-success / status-pending / status-error / status-info.">
        <StatusPill statut="success" libelle="Paiement confirmé" />
        <StatusPill statut="pending" libelle="Vérification en cours" />
        <StatusPill statut="error" libelle="Demande rejetée" />
        <StatusPill statut="info" libelle="Délai indicatif : 72 heures" />
      </Section>

      <Section titre="Frise d’étapes" description="Suivi d’un dossier : étapes validées, en cours, à venir ou rejetées.">
        <StepTimeline etapes={DEMO_ETAPES} />
        <StepTimeline etapes={DEMO_ETAPES_REJET} />
      </Section>

      <Section titre="Montant" description="Montant non modifiable, toujours fourni par un service.">
        <AmountCard
          objet="Frais d’adhésion"
          montant={DEMO_MONTANT_ADHESION}
          mention="Estimation — le montant final est confirmé par le serveur."
        />
      </Section>

      <Section titre="Informations et alertes" description="Bandeaux informatifs, en attente, succès confirmé et erreur.">
        <InfoBanner
          variante="info"
          titre="Délai indicatif"
          message="Votre demande est traitée sous 72 heures. Vous recevrez une notification."
        />
        <InfoBanner
          variante="pending"
          titre="Paiement en attente"
          message="La confirmation de l’opérateur n’est pas encore arrivée. L’application ne confirmera le paiement qu’après la réponse du serveur."
        />
        <InfoBanner
          variante="success"
          titre="Paiement confirmé"
          message="Votre adhésion est finalisée. Vos identifiants ont été envoyés à votre adresse e-mail."
        />
        <InfoBanner
          variante="error"
          titre="Documents incomplets"
          message="Le certificat de résidence est absent. Ajoutez-le pour poursuivre votre demande."
          actionLibelle="Compléter le dossier"
          onAction={AUCUNE_ACTION}
        />
      </Section>

      <Section titre="États d’écran" description="Chargement / vide / erreur + « Réessayer » / contenu.">
        <View className="rounded-xl border border-omda-borderGray bg-omda-white p-4">
          <Text className="text-base text-omda-black">
            Contenu : l’écran affiche ses données une fois reçues du service.
          </Text>
        </View>
        <LoadingState message="Chargement de votre dossier…" />
        <EmptyState
          titre="Aucune œuvre déposée"
          message="Deux œuvres minimum sont demandées pour l’adhésion. Vous n’en avez encore déposé aucune."
          actionLibelle="Déposer une œuvre"
          onAction={AUCUNE_ACTION}
        />
        <ErrorState
          message="Impossible de joindre le serveur. Vérifiez votre connexion internet puis réessayez."
          onReessayer={AUCUNE_ACTION}
        />
      </Section>
    </ScreenContainer>
  );
}
