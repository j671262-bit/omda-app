import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import {
  AmountCard,
  Button,
  EmptyState,
  ErrorState,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StatusPill,
  StepTimeline,
  TextField,
  type EtapeTimeline,
  type StatutEtape,
  type StatutPill,
} from '../../src/components/ui';
import type { StatutDemande } from '../../src/models';
import type { ErreurApp, SuiviDemande } from '../../src/services/contracts';
import { obtenirHistoriqueDossiers } from '../../src/services/local/historiqueDossiers';
import { candidateApi } from '../../src/services/factory';

type EtatEcran = 'vide' | 'chargement' | 'erreur' | 'contenu';

const STATUTS_AFFICHES: Record<StatutDemande, { variante: StatutPill; libelle: string }> = {
  BROUILLON: { variante: 'info', libelle: 'Brouillon en cours' },
  ENVOYEE: { variante: 'success', libelle: 'Demande reçue' },
  EN_COURS_DE_VERIFICATION: { variante: 'pending', libelle: 'Vérification du dossier' },
  VALIDEE: { variante: 'success', libelle: 'Dossier validé' },
  REJETEE: { variante: 'error', libelle: 'Dossier rejeté' },
  ADHESION_TERMINEE: { variante: 'success', libelle: 'Adhésion finalisée' },
};

function parametreTexte(valeur: string | string[] | undefined): string {
  if (typeof valeur === 'string') return valeur.trim();
  if (Array.isArray(valeur) && valeur.length > 0 && typeof valeur[0] === 'string') return valeur[0].trim();
  return '';
}

function formaterDateHeure(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const annee = date.getFullYear();
  const heures = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${jour}/${mois}/${annee} à ${heures}:${minutes}`;
}

function formaterDateCourte(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const annee = date.getFullYear();
  return `${jour}/${mois}/${annee}`;
}

function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Le service de suivi est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

function adapterEtapesTimeline(suivi: SuiviDemande): EtapeTimeline[] {
  const statutDossier = suivi.statut;

  return suivi.etapes.map((etape) => {
    let statutTimeline: StatutEtape = 'aVenir';
    if (etape.statut === 'REJETEE') {
      statutTimeline = 'rejete';
    } else if (etape.realisee) {
      statutTimeline = 'fait';
    } else if (
      (statutDossier === 'ENVOYEE' && etape.statut === 'EN_COURS_DE_VERIFICATION') ||
      (statutDossier === 'VALIDEE' && etape.statut === 'ADHESION_TERMINEE')
    ) {
      statutTimeline = 'enCours';
    } else {
      statutTimeline = 'aVenir';
    }

    const descriptionDate = etape.date ? `Le ${formaterDateCourte(etape.date)}` : undefined;
    return {
      titre: etape.libelle,
      description: descriptionDate,
      statut: statutTimeline,
    };
  });
}
export default function SuiviScreen() {
  const parametres = useLocalSearchParams<{
    numero_dossier?: string;
    code_suivi?: string;
  }>();

  const [numeroSaisi, setNumeroSaisi] = useState('');
  const [codeSaisi, setCodeSaisi] = useState('');
  const [etat, setEtat] = useState<EtatEcran>('vide');
  const [erreurRecherche, setErreurRecherche] = useState<string | null>(null);
  const [resultatSuivi, setResultatSuivi] = useState<SuiviDemande | null>(null);

  const lancerRecherche = useCallback(async (numero: string, code: string) => {
    const numeroNettoye = numero.trim().toUpperCase();
    const codeNettoye = code.trim().toUpperCase();
    if (!numeroNettoye || !codeNettoye) return;

    setEtat('chargement');
    setErreurRecherche(null);

    const reponse = await candidateApi.suivreDemande({
      numero_dossier: numeroNettoye,
      code_suivi: codeNettoye,
    });

    if (!reponse.ok) {
      setErreurRecherche(traduireErreur(reponse.erreur));
      setResultatSuivi(null);
      setEtat('erreur');
      return;
    }

    setResultatSuivi(reponse.valeur);
    setEtat('contenu');
  }, []);

  useEffect(() => {
    const numeroParam = parametreTexte(parametres.numero_dossier);
    const codeParam = parametreTexte(parametres.code_suivi);

    if (numeroParam && codeParam) {
      setNumeroSaisi(numeroParam);
      setCodeSaisi(codeParam);
      void lancerRecherche(numeroParam, codeParam);
      return;
    }

    void (async () => {
      const historique = await obtenirHistoriqueDossiers();
      if (historique.ok && historique.valeur.length > 0) {
        const dernier = historique.valeur[0];
        if (dernier?.numero_dossier && dernier?.code_suivi) {
          setNumeroSaisi(dernier.numero_dossier);
          setCodeSaisi(dernier.code_suivi);
        }
      }
    })();
  }, [lancerRecherche, parametres.code_suivi, parametres.numero_dossier]);

  const formulaireValide = numeroSaisi.trim().length > 0 && codeSaisi.trim().length > 0;

  const reinitialiserRecherche = useCallback(() => {
    setEtat('vide');
    setResultatSuivi(null);
    setErreurRecherche(null);
  }, []);

  const etapesTimeline = useMemo(() => {
    if (!resultatSuivi) return [];
    return adapterEtapesTimeline(resultatSuivi);
  }, [resultatSuivi]);

  const infoStatut = useMemo(() => {
    if (!resultatSuivi) return null;
    return (
      STATUTS_AFFICHES[resultatSuivi.statut] ?? {
        variante: 'info',
        libelle: resultatSuivi.statut,
      }
    );
  }, [resultatSuivi]);

  const dateDerniereMiseAJour = useMemo(() => {
    if (!resultatSuivi?.derniere_mise_a_jour) return '';
    return formaterDateHeure(resultatSuivi.derniere_mise_a_jour);
  }, [resultatSuivi]);

  return (
    <ScreenContainer titre="Suivre ma demande" sousTitre="Candidat (sans compte)">
      <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-base font-bold text-omda-black">Rechercher une demande</Text>
        <Text className="mt-1 text-sm text-omda-textGray">
          Renseignez le numéro de dossier et le code de suivi qui vous ont été communiqués lors de
          l’envoi.
        </Text>

        <View className="mt-4 gap-3">
          <TextField
            libelle="Numéro de dossier"
            valeur={numeroSaisi}
            onChangeValeur={(valeur) => setNumeroSaisi(valeur.toUpperCase())}
            placeholder="Ex. OMDA-2026-000001"
            aide="Format OMDA-AAAA-NNNNNN"
            desactive={etat === 'chargement'}
          />

          <TextField
            libelle="Code de suivi"
            valeur={codeSaisi}
            onChangeValeur={(valeur) => setCodeSaisi(valeur.toUpperCase())}
            placeholder="Ex. K7X4-9B2Q"
            aide="Code à 8 ou 9 caractères avec tiret"
            desactive={etat === 'chargement'}
          />
        </View>

        <View className="mt-5 flex-row gap-3">
          <View className="flex-1">
            <Button
              libelle="Rechercher"
              icone="magnifying-glass"
              pleineLargeur
              desactive={!formulaireValide || etat === 'chargement'}
              chargement={etat === 'chargement'}
              onPress={() => void lancerRecherche(numeroSaisi, codeSaisi)}
            />
          </View>
          {etat !== 'vide' ? (
            <Button
              libelle="Effacer"
              variante="secondary"
              desactive={etat === 'chargement'}
              onPress={reinitialiserRecherche}
            />
          ) : null}
        </View>
      </View>

      {etat === 'chargement' ? (
        <View className="mt-6">
          <LoadingState message="Recherche de votre dossier en cours…" />
        </View>
      ) : null}

      {etat === 'erreur' ? (
        <View className="mt-6">
          <ErrorState
            titre="Dossier introuvable ou erreur"
            message={erreurRecherche ?? 'Impossible de récupérer le suivi de votre dossier.'}
            libelleAction="Réessayer"
            onReessayer={() => void lancerRecherche(numeroSaisi, codeSaisi)}
          />
        </View>
      ) : null}

      {etat === 'vide' ? (
        <View className="mt-6">
          <EmptyState
            icone="folder-open"
            titre="Aucun dossier affiché"
            message="Saisissez vos identifiants ci-dessus puis appuyez sur « Rechercher » pour consulter l’état d’avancement de votre demande."
          />
        </View>
      ) : null}
      {etat === 'contenu' && resultatSuivi && infoStatut ? (
        <View className="mt-6 gap-5">
          {/* Carte principale d'état du dossier */}
          <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-omda-textGray">
              Dossier consulté
            </Text>
            <Text selectable className="mt-1 text-2xl font-bold text-omda-black">
              {resultatSuivi.numero_dossier}
            </Text>

            <View className="mt-3">
              <StatusPill statut={infoStatut.variante} libelle={infoStatut.libelle} />
            </View>

            {dateDerniereMiseAJour ? (
              <Text className="mt-4 text-xs text-omda-textGray">
                {`Dernière mise à jour : ${dateDerniereMiseAJour}`}
              </Text>
            ) : null}
          </View>

          {/* Cas REJETEE : motif obligatoire et action proposée au candidat */}
          {resultatSuivi.statut === 'REJETEE' ? (
            <View className="gap-3">
              <InfoBanner
                variante="error"
                titre="Demande rejetée par l’OMDA"
                message={
                  resultatSuivi.motif_rejet
                    ? `Motif : ${resultatSuivi.motif_rejet}`
                    : 'Votre dossier n’a pas pu être validé.'
                }
              />
              <InfoBanner
                variante="info"
                titre="Action conseillée"
                message="Corrigez votre dossier puis renvoyez les pièces justificatives ou informations demandées auprès de nos services."
              />
            </View>
          ) : null}

          {/* Cas VALIDEE : montant dynamique + bouton pour effectuer le paiement */}
          {resultatSuivi.statut === 'VALIDEE' && resultatSuivi.paiement_du ? (
            <View className="gap-4 rounded-2xl border border-omda-borderGray bg-omda-white p-5">
              <InfoBanner
                variante="info"
                titre="Dossier validé par l’OMDA"
                message="Votre dossier d’adhésion a été vérifié et validé avec succès. Vous pouvez désormais effectuer le règlement de vos frais d’adhésion."
              />

              <AmountCard
                objet="Frais d’adhésion"
                montant={resultatSuivi.paiement_du.montant}
                mention="Montant officiel communiqué par le serveur OMDA."
                icone="credit-card"
              />

              <Button
                libelle="Effectuer le paiement"
                icone="credit-card"
                pleineLargeur
                onPress={() =>
                  router.push({
                    pathname: '/(candidat)/paiement',
                    params: {
                      numero_dossier: resultatSuivi.numero_dossier,
                      code_suivi: codeSaisi.trim().toUpperCase(),
                    },
                  })
                }
              />
            </View>
          ) : null}

          {/* Cas ADHESION_TERMINEE : adhésion finalisée */}
          {resultatSuivi.statut === 'ADHESION_TERMINEE' ? (
            <InfoBanner
              variante="success"
              titre="Adhésion finalisée"
              message="Votre adhésion à l’OMDA est confirmée. Vos identifiants de membre vous ont été communiqués par e-mail."
              actionLibelle="Se connecter"
              onAction={() => router.push('/(public)/connexion')}
            />
          ) : null}

          {/* Frise chronologique d'avancement */}
          <View className="rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            <Text className="mb-4 text-base font-bold text-omda-black">
              Étapes de traitement du dossier
            </Text>
            <StepTimeline etapes={etapesTimeline} />
          </View>
        </View>
      ) : null}

      {/* Navigation retour vers l'accueil public */}
      <View className="mt-8">
        <Button
          libelle="Retour à l’accueil"
          variante="secondary"
          pleineLargeur
          onPress={() => router.push('/(public)/accueil')}
        />
      </View>
    </ScreenContainer>
  );
}


