import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StatusPill,
  StepProgress,
  type StatutPill,
  type VarianteBanner,
} from '../../src/components/ui';
import { STATUTS_DEMANDE, type StatutDemande } from '../../src/models';
import {
  enregistrerDossierSoumis,
  obtenirHistoriqueDossiers,
} from '../../src/services/local/historiqueDossiers';

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Informations à conserver, telles que confirmées par le service. */
type InformationsDossier = {
  numero_dossier: string;
  code_suivi: string;
  statut: StatutDemande;
  date_soumission: string | null;
  delai_indicatif_heures: number | null;
};

/** Actions proposées par l'écran : copier le dossier, le conserver sur le téléphone. */
type NomAction = 'copie' | 'sauvegarde';

/** Retour d'action affiché sous les boutons (copie, sauvegarde). */
type RetourAction = {
  variante: VarianteBanner;
  message: string;
  /** Action à relancer via « Réessayer » après un échec. */
  action?: NomAction;
};

/** Statut par défaut : cet écran s'affiche juste après un envoi confirmé. */
const STATUT_APRES_ENVOI: StatutDemande = 'ENVOYEE';

/**
 * Statut affichable (libellés alignés sur la frise de suivi renvoyée par le
 * serveur). Le vert `success` n'apparaît que pour un statut confirmé.
 */
const STATUTS_AFFICHES: Record<StatutDemande, { variante: StatutPill; libelle: string }> = {
  BROUILLON: { variante: 'info', libelle: 'Brouillon' },
  ENVOYEE: { variante: 'success', libelle: 'Demande reçue' },
  EN_COURS_DE_VERIFICATION: { variante: 'pending', libelle: 'Vérification du dossier' },
  VALIDEE: { variante: 'success', libelle: 'Dossier validé' },
  REJETEE: { variante: 'error', libelle: 'Dossier rejeté' },
  ADHESION_TERMINEE: { variante: 'success', libelle: 'Adhésion finalisée' },
};

/* ------------------------------------------------------------- Utilitaires */

/** Paramètre de navigation textuel normalisé (`string | string[] | undefined`). */
function parametreTexte(valeur: string | string[] | undefined): string | null {
  if (typeof valeur === 'string') {
    return valeur.trim() ? valeur.trim() : null;
  }
  if (Array.isArray(valeur) && valeur.length > 0 && valeur[0].trim()) {
    return valeur[0].trim();
  }
  return null;
}

/** Paramètre de navigation numérique valide (> 0), sinon `null`. */
function parametreNombre(valeur: string | string[] | undefined): number | null {
  const texte = parametreTexte(valeur);
  if (!texte) {
    return null;
  }
  const nombre = Number(texte);
  return Number.isFinite(nombre) && nombre > 0 ? nombre : null;
}

/** Garde : le paramètre de navigation est-il un statut de demande valide ? */
function estStatutDemande(valeur: string | null): valeur is StatutDemande {
  return valeur !== null && (STATUTS_DEMANDE as readonly string[]).includes(valeur);
}

/** Horodatage ISO affiché en `JJ/MM/AAAA` (chaîne vide si invalide). */
function formaterHorodatage(horodatage: string | null): string {
  if (!horodatage) {
    return '';
  }
  const date = new Date(horodatage);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  return `${jour}/${mois}/${date.getFullYear()}`;
}

/** Texte copié : numéro de dossier + code de suivi, prêts à conserver. */
function texteDossier(informations: InformationsDossier): string {
  return [
    'OMDA — Demande d’adhésion',
    `Numéro de dossier : ${informations.numero_dossier}`,
    `Code de suivi : ${informations.code_suivi}`,
  ].join('\n');
}

/* ------------------------------------------------------------------- Écran */

/**
 * Étape 5 — Confirmation d'envoi (écran L du cahier des charges, écran critique).
 *
 * Alimenté par les paramètres de navigation transmis par l'écran K après
 * confirmation du service ; à défaut, par le dernier dossier enregistré sur ce
 * téléphone (`src/services/local/historiqueDossiers`), ce qui permet de
 * retrouver ses informations après un redémarrage.
 *
 * Contenu imposé :
 * - numéro de dossier et code de suivi EN CLAIR ;
 * - actions « copier » (`expo-clipboard`) et « sauvegarder » (stockage local du
 *   téléphone) : le texte est copié ou conservé sur l'appareil, jamais remis à
 *   une autre application ;
 * - les 3 messages obligatoires : conserver les informations, délai indicatif
 *   (valeur renvoyée par le service), aucun paiement demandé pour le moment.
 *
 * 4 états obligatoires : chargement, erreur (+ « Réessayer »), vide, contenu.
 * Navigation linéaire : aucun retour vers l'étape précédente (dossier envoyé).
 */
export default function ConfirmationScreen() {
  const parametres = useLocalSearchParams<{
    numero_dossier?: string;
    code_suivi?: string;
    statut?: string;
    delai_indicatif_heures?: string;
    date_soumission?: string;
  }>();

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [informations, setInformations] = useState<InformationsDossier | null>(null);
  const [retourAction, setRetourAction] = useState<RetourAction | null>(null);
  const [sauvegardeEnCours, setSauvegardeEnCours] = useState(false);

  /* --------------------------------------------- Chargement des données */

  /** Paramètres d'envoi, sinon dernier dossier conservé sur l'appareil. */
  const initialiserEcran = useCallback(async () => {
    const numero = parametreTexte(parametres.numero_dossier);
    const code = parametreTexte(parametres.code_suivi);

    if (numero && code) {
      const statutParametre = parametreTexte(parametres.statut);
      setInformations({
        numero_dossier: numero,
        code_suivi: code,
        statut: estStatutDemande(statutParametre) ? statutParametre : STATUT_APRES_ENVOI,
        date_soumission: parametreTexte(parametres.date_soumission),
        delai_indicatif_heures: parametreNombre(parametres.delai_indicatif_heures),
      });
      setEtat('contenu');
      return;
    }

    setEtat('chargement');
    setMessageErreur('');

    const historique = await obtenirHistoriqueDossiers();
    if (!historique.ok) {
      setMessageErreur(historique.erreur.message);
      setEtat('erreur');
      return;
    }

    const dernier = historique.valeur[0];
    if (!dernier) {
      setInformations(null);
      setEtat('vide');
      return;
    }

    setInformations({
      numero_dossier: dernier.numero_dossier,
      code_suivi: dernier.code_suivi,
      statut: dernier.statut,
      date_soumission: dernier.date_soumission,
      delai_indicatif_heures: dernier.delai_indicatif_heures,
    });
    setEtat('contenu');
  }, [
    parametres.code_suivi,
    parametres.date_soumission,
    parametres.delai_indicatif_heures,
    parametres.numero_dossier,
    parametres.statut,
  ]);

  useEffect(() => {
    void initialiserEcran();
  }, [initialiserEcran]);

  /** Date d'envoi lisible (vide si le service n'a pas fourni d'horodatage). */
  const dateEnvoi = useMemo(
    () => formaterHorodatage(informations?.date_soumission ?? null),
    [informations],
  );

  /* ----------------------------------------------------------- Actions */

  /** Action « Copier » : les deux informations dans le presse-papiers. */
  const copier = useCallback(async () => {
    if (!informations) {
      return;
    }
    try {
      await Clipboard.setStringAsync(texteDossier(informations));
      setRetourAction({
        variante: 'info',
        message: 'Numéro de dossier et code de suivi copiés dans le presse-papiers.',
      });
    } catch (erreur) {
      console.warn('[Confirmation] Copie impossible :', erreur);
      setRetourAction({
        variante: 'error',
        message: 'La copie a échoué. Sélectionnez le texte à la main pour le conserver.',
        action: 'copie',
      });
    }
  }, [informations]);

  /**
   * Action « Sauvegarder » : conservation sur le téléphone (AsyncStorage).
   * Le dossier est déjà enregistré après l'envoi : cette action permet de le
   * confirmer explicitement et de le rafraîchir.
   */
  const sauvegarder = useCallback(async () => {
    if (!informations || sauvegardeEnCours) {
      return;
    }
    setSauvegardeEnCours(true);
    setRetourAction(null);

    const resultat = await enregistrerDossierSoumis({
      numero_dossier: informations.numero_dossier,
      code_suivi: informations.code_suivi,
      statut: informations.statut,
      date_soumission: informations.date_soumission ?? new Date().toISOString(),
      delai_indicatif_heures: informations.delai_indicatif_heures,
    });

    setRetourAction(
      resultat.ok
        ? {
            variante: 'info',
            message:
              'Informations enregistrées sur votre téléphone : vous pourrez les retrouver depuis cet écran.',
          }
        : { variante: 'error', message: resultat.erreur.message, action: 'sauvegarde' },
    );
    setSauvegardeEnCours(false);
  }, [informations, sauvegardeEnCours]);

  /** Relance l'action en échec depuis le bouton « Réessayer » du retour d'action. */
  const lancerAction = useCallback(
    (nom: NomAction) => {
      if (nom === 'copie') {
        void copier();
        return;
      }
      void sauvegarder();
    },
    [copier, sauvegarder],
  );

  /* --------------------------------------------------------------- Rendu */

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Demande envoyée" afficherRetour={false}>
        <StepProgress etapeCourante={5} />
        <LoadingState message="Chargement des informations de votre demande…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Demande envoyée" afficherRetour={false}>
        <StepProgress etapeCourante={5} />
        <ErrorState
          titre="Informations indisponibles"
          message={messageErreur}
          onReessayer={() => void initialiserEcran()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide' || !informations) {
    return (
      <ScreenContainer titre="Demande envoyée" afficherRetour={false}>
        <StepProgress etapeCourante={5} />
        <EmptyState
          titre="Aucune demande à afficher"
          message="Cet écran présente les informations d’une demande d’adhésion envoyée depuis ce téléphone. Envoyez votre demande pour obtenir un numéro de dossier et un code de suivi."
          icone="paper-plane"
          actionLibelle="Envoyer une demande d’adhésion"
          onAction={() => router.replace('/(adhesion)/identite')}
        />
        <Button
          libelle="Suivre une demande existante"
          variante="secondary"
          pleineLargeur
          onPress={() => router.replace('/(candidat)/suivi')}
        />
      </ScreenContainer>
    );
  }

  const statut = STATUTS_AFFICHES[informations.statut];

  /** Action à relancer après un échec (bouton « Réessayer » du retour d'action). */
  const actionErreur = retourAction?.variante === 'error' ? (retourAction.action ?? null) : null;

  return (
    <ScreenContainer titre="Demande envoyée" afficherRetour={false}>
      <StepProgress etapeCourante={5} />

      {/* Succès confirmé par le service (statut renvoyé par l'envoi). */}
      <InfoBanner
        variante="success"
        titre="Demande envoyée"
        message={
          dateEnvoi
            ? `Votre demande a bien été reçue par l’OMDA le ${dateEnvoi}.`
            : 'Votre demande a bien été reçue par l’OMDA.'
        }
      />

      <View className="mt-4">
        <StatusPill statut={statut.variante} libelle={statut.libelle} />
      </View>

      {/* Numéro de dossier et code de suivi EN CLAIR (écran critique). */}
      <View className="mt-5 rounded-2xl border border-omda-borderGray bg-omda-white p-4">
        <Text className="text-xs font-semibold uppercase tracking-wider text-omda-textGray">
          Numéro de dossier
        </Text>
        <Text selectable className="mt-1 text-3xl font-bold text-omda-black">
          {informations.numero_dossier}
        </Text>

        <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-omda-textGray">
          Code de suivi
        </Text>
        <Text selectable className="mt-1 text-3xl font-bold text-omda-black">
          {informations.code_suivi}
        </Text>

        <Text className="mt-4 text-sm text-omda-textGray">
          Ces deux informations sont exigées à chaque consultation de votre dossier.
        </Text>
      </View>

      {/* Messages obligatoires de l'écran L */}
      <View className="mt-4 gap-3">
        <InfoBanner
          variante="info"
          titre="Conservez ces informations"
          message="Elles sont indispensables pour consulter l’état de votre demande. Le code de suivi n’est affiché en clair qu’une seule fois : copiez-le ou notez-le maintenant."
        />
        <InfoBanner
          variante="pending"
          titre="Délai indicatif"
          message={
            informations.delai_indicatif_heures
              ? `Délai indicatif : ${informations.delai_indicatif_heures} heures. Il s’agit d’une estimation communiquée par l’OMDA, non d’une date garantie.`
              : 'Le délai indicatif de traitement vous est communiqué par l’OMDA au moment de l’envoi.'
          }
        />
        <InfoBanner
          variante="info"
          titre="Aucun paiement pour le moment"
          message="Aucun paiement n’est demandé pour le moment. Le paiement des frais d’adhésion ne sera possible qu’après validation de votre dossier par l’OMDA."
        />
      </View>

      {/* Retour des actions copier / sauvegarder */}
      {retourAction ? (
        <View className="mt-4">
          <InfoBanner
            variante={retourAction.variante}
            message={retourAction.message}
            actionLibelle={actionErreur ? 'Réessayer' : undefined}
            onAction={actionErreur ? () => lancerAction(actionErreur) : undefined}
          />
        </View>
      ) : null}

      {/* Actions : copier / sauvegarder */}
      <View className="mt-8 gap-3">
        <Button
          libelle="Copier les informations"
          icone="copy"
          pleineLargeur
          onPress={() => void copier()}
        />
        <Button
          libelle="Sauvegarder sur mon téléphone"
          icone="floppy-disk"
          variante="secondary"
          pleineLargeur
          chargement={sauvegardeEnCours}
          onPress={() => void sauvegarder()}
        />
        <Button
          libelle="Suivre ma demande"
          icone="magnifying-glass"
          variante="secondary"
          pleineLargeur
          onPress={() => router.replace('/(candidat)/suivi')}
        />
        <Button
          libelle="Retour à l’accueil"
          variante="secondary"
          pleineLargeur
          onPress={() => router.replace('/(public)/accueil')}
        />
      </View>
    </ScreenContainer>
  );
}
