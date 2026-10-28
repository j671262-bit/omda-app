import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  AmountCard,
  AudioPreview,
  Button,
  EmptyState,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  type NomIcone,
  ScreenContainer,
  StatusPill,
  type StatutPill,
} from '../../src/components/ui';
import {
  STATUTS_OEUVRE_MODIFIABLES,
  type AttestationDiffusion,
  type Categorie,
  type Oeuvre,
  type StatutOeuvre,
} from '../../src/models';
import { CODES_ERREUR_MEMBRE } from '../../src/services/contracts';
import type { ErreurApp, EstimationMontant } from '../../src/services/contracts';
import { memberRepository, publicContentService } from '../../src/services/factory';
import { estFichierAudio } from '../../src/utils';

/**
 * Écran S — Fiche d'une œuvre (hors onglets).
 *
 * Règles appliquées :
 * - l'œuvre vient de `memberRepository.obtenirOeuvre(oeuvre_id)` : l'UI ne
 *   déduit jamais un statut, elle affiche celui du serveur ;
 * - les actions dépendent STRICTEMENT du statut ;
 * - une œuvre encore `BROUILLON`, `ENVOYEE` ou `EN_COURS_DE_VALIDATION`
 *   (`STATUTS_OEUVRE_MODIFIABLES`) reste CORRIGEABLE : « Modifier l'œuvre »
 *   ouvre `modifier-oeuvre` (titre, catégorie, description, année, remplacement
 *   du fichier et de l'attestation de diffusion) tant que l'OMDA n'a pas statué ;
 *   ces écrans ne changent JAMAIS le statut, qui reste la décision du serveur ;
 * - « Payer les frais de dépôt » n'est proposé QUE pour une œuvre `VALIDEE`
 *   (règle métier 4) : l'envoi (`ENVOYEE`) ne déclenche aucun paiement ;
 * - `REJETEE` affiche obligatoirement le motif transmis par l'OMDA ;
 * - une pastille verte n'apparaît QUE sur `DEPOT_FINALISE`, effet serveur d'un
 *   paiement confirmé `REUSSI` ;
 * - le montant des frais de dépôt vient du service (`estimerMontant`), jamais de
 *   l'écran ; 4 états obligatoires : chargement / erreur / vide / contenu ;
 * - la fiche ouvre sur une section « Informations sur l'œuvre » TOUJOURS affichée
 *   dès que l'œuvre est chargée (titre, statut, catégorie, année, description,
 *   date de création, envoi à l'OMDA, décision, fichier déposé) : une valeur
 *   absente s'affiche « — », aucune section n'est masquée pour autant ;
 * - l'« Attestation de diffusion » (règle métier 8) est chargée EN PARALLÈLE de
 *   l'œuvre (`listerAttestationsOeuvre`) et présentée en LECTURE SEULE : pastille
 *   « Ajoutée » / « Manquante » + nom du fichier, sans aucun bouton d'ouverture ;
 * - ces deux sections ne dépendent PAS du type de fichier (un PDF, une image et un
 *   MP3 affichent les mêmes informations) ;
 * - seule l'écoute intégrée reste proposée (`AudioPreview`) : « Écouter l'œuvre »
 *   demande un lien temporaire au service puis joue la piste dans l'application ;
 *   la fiche n'ouvre AUCUN document avec une autre application — un fichier qui
 *   n'est pas audio affiche « Aperçu audio indisponible pour ce format. » et un
 *   échec d'écoute affiche sa cause exacte avec un bouton « Réessayer » ;
 * - le lien d'écoute est TEMPORAIRE et vient TOUJOURS du service
 *   (`obtenirUrlFichier`) : l'écran ne construit jamais de lien depuis un chemin
 *   de stockage (bucket privé), et ne le prépare qu'à la demande de l'utilisateur.
 */

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Libellés et pastilles des statuts d'œuvre (cahier des charges §6). */
const STATUTS_AFFICHES: Record<StatutOeuvre, { variante: StatutPill; libelle: string }> = {
  BROUILLON: { variante: 'pending', libelle: 'Brouillon' },
  ENVOYEE: { variante: 'pending', libelle: 'Envoyée à l’OMDA' },
  EN_COURS_DE_VALIDATION: { variante: 'pending', libelle: 'En cours de validation' },
  VALIDEE: { variante: 'info', libelle: 'Validée — frais de dépôt à régler' },
  REJETEE: { variante: 'error', libelle: 'Rejetée' },
  DEPOT_FINALISE: { variante: 'success', libelle: 'Dépôt finalisé' },
};

/** Aucun aperçu audio possible : le fichier n'est pas audio ou son lien est inaccessible. */
const MESSAGE_APERCU_INDISPONIBLE = 'Aperçu audio indisponible pour ce format.';

/** Statuts pour lesquels l'œuvre est encore en cours d'examen par l'OMDA. */
const STATUTS_EN_EXAMEN: StatutOeuvre[] = ['ENVOYEE', 'EN_COURS_DE_VALIDATION'];

/** Paramètre d'URL unique (chaîne) ou absent. */
function parametreTexte(valeur: string | string[] | undefined): string {
  if (typeof valeur === 'string') return valeur.trim();
  if (Array.isArray(valeur) && valeur.length > 0 && typeof valeur[0] === 'string') {
    return valeur[0].trim();
  }
  return '';
}

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Cette fiche est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Date ISO affichée en `JJ/MM/AAAA` (formatage manuel, sans `Intl`). */
function formaterDateCourte(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  return `${jour}/${mois}/${date.getFullYear()}`;
}

/** Nom de fichier lisible à partir du chemin de stockage. */
function nomFichier(chemin: string | null): string {
  if (!chemin) return '';
  const parties = chemin.split('/');
  return parties[parties.length - 1] ?? '';
}

export default function FicheOeuvreScreen() {
  const parametres = useLocalSearchParams<{ oeuvre_id?: string }>();
  const oeuvreId = parametreTexte(parametres.oeuvre_id);

  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const [messageVide, setMessageVide] = useState('');
  const [oeuvre, setOeuvre] = useState<Oeuvre | null>(null);
  const [categorie, setCategorie] = useState<Categorie | null>(null);
  const [fraisDepot, setFraisDepot] = useState<EstimationMontant | null>(null);
  const [erreurFrais, setErreurFrais] = useState<string | null>(null);
  /** Attestations de diffusion de l'œuvre (règle métier 8), lues par le service. */
  const [attestations, setAttestations] = useState<AttestationDiffusion[]>([]);
  const [erreurAttestations, setErreurAttestations] = useState<string | null>(null);
  /** Lien temporaire de l'œuvre audio : demandé au service au premier « Écouter ». */
  const [urlAudio, setUrlAudio] = useState<string | null>(null);
  const [chargementAudio, setChargementAudio] = useState(false);
  const [erreurAudio, setErreurAudio] = useState<string | null>(null);

  /**
   * Charge la fiche : l'œuvre (statut faisant foi), le référentiel des catégories,
   * ses attestations de diffusion (règle métier 8) et — uniquement pour une œuvre
   * `VALIDEE` — le montant des frais de dépôt.
   */
  const chargerFiche = useCallback(async () => {
    if (!oeuvreId) {
      setOeuvre(null);
      setMessageVide(
        'Aucune œuvre n’a été transmise à cet écran. Revenez à la liste de vos œuvres pour ouvrir une fiche.',
      );
      setEtat('vide');
      return;
    }

    setEtat('chargement');
    setMessageErreur('');
    setErreurFrais(null);
    setFraisDepot(null);
    setErreurAttestations(null);
    setAttestations([]);
    /**
     * Le lien d'écoute est TEMPORAIRE : il ne survit pas à un rechargement de la
     * fiche (l'œuvre a pu être remplacée).
     */
    setUrlAudio(null);
    setErreurAudio(null);

    try {
      const reponse = await memberRepository.obtenirOeuvre(oeuvreId);

      if (!reponse.ok) {
        if (
          reponse.erreur.type === 'metier' &&
          reponse.erreur.code === CODES_ERREUR_MEMBRE.OEUVRE_INTROUVABLE
        ) {
          setOeuvre(null);
          setMessageVide(reponse.erreur.message);
          setEtat('vide');
          return;
        }
        setOeuvre(null);
        setMessageErreur(traduireErreur(reponse.erreur));
        setEtat('erreur');
        return;
      }

      const oeuvreChargee = reponse.valeur;

      const [reponseCategories, reponseFrais, reponseAttestations] = await Promise.all([
        publicContentService.listerCategories(),
        oeuvreChargee.statut === 'VALIDEE'
          ? publicContentService.estimerMontant({
              type_operation: 'DEPOT_OEUVRE',
              categorie_id: oeuvreChargee.categorie_id,
            })
          : Promise.resolve(null),
        memberRepository.listerAttestationsOeuvre(oeuvreChargee.id),
      ]);

      setOeuvre(oeuvreChargee);
      setCategorie(
        reponseCategories.ok
          ? (reponseCategories.valeur.find(
              (element) => element.id === oeuvreChargee.categorie_id,
            ) ?? null)
          : null,
      );

      if (reponseFrais) {
        if (reponseFrais.ok) {
          setFraisDepot(reponseFrais.valeur);
        } else {
          setErreurFrais(traduireErreur(reponseFrais.erreur));
        }
      }

      /** Attestations de diffusion : au moins une par œuvre (règle métier 8). */
      if (reponseAttestations.ok) {
        setAttestations(reponseAttestations.valeur);
      } else {
        setAttestations([]);
        setErreurAttestations(traduireErreur(reponseAttestations.erreur));
      }

      setEtat('contenu');
    } catch {
      setOeuvre(null);
      setMessageErreur(
        'Une erreur inattendue est survenue pendant le chargement de cette fiche. Veuillez réessayer.',
      );
      setEtat('erreur');
    }
  }, [oeuvreId]);

  /** Chargement initial : sans cet appel, l'écran resterait en chargement. */
  useEffect(() => {
    void chargerFiche();
  }, [chargerFiche]);

  /* --------------------------------------------------------------- Actions */

  /** Brouillon : reprise du dépôt (titre, catégorie, fichier, attestation). */
  const reprendreDepot = useCallback(() => {
    if (!oeuvre) return;
    router.push({ pathname: '/(membre)/depot-oeuvre', params: { oeuvre_id: oeuvre.id } });
  }, [oeuvre]);

  /**
   * Correction des informations et remplacement des documents, tant que l'OMDA
   * n'a pas statué (`STATUTS_OEUVRE_MODIFIABLES`).
   */
  const modifierOeuvre = useCallback(() => {
    if (!oeuvre) return;
    router.push({ pathname: '/(membre)/modifier-oeuvre', params: { oeuvre_id: oeuvre.id } });
  }, [oeuvre]);

  /** Œuvre rejetée : nouveau dépôt, l'œuvre rejetée reste consultable ici. */
  const nouvelDepot = useCallback(() => {
    router.push('/(membre)/depot-oeuvre');
  }, []);

  /** Œuvre `VALIDEE` uniquement : paiement des frais de dépôt. */
  const payerFraisDepot = useCallback(() => {
    if (!oeuvre) return;
    router.push({
      pathname: '/(membre)/paiement-membre',
      params: { type: 'DEPOT_OEUVRE', oeuvre_id: oeuvre.id },
    });
  }, [oeuvre]);

  const retourOeuvres = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(membre)/(tabs)/oeuvres');
  }, []);

  /**
   * Lien temporaire de l'œuvre audio, demandé au service AU MOMENT de l'écoute :
   * aucun lien n'est préparé tant que l'utilisateur ne l'a pas demandé.
   */
  const ecouterOeuvre = useCallback(async () => {
    const cheminStockage = oeuvre?.chemin_fichier;
    if (!cheminStockage) return;

    setChargementAudio(true);
    setErreurAudio(null);
    try {
      const reponse = await memberRepository.obtenirUrlFichier(cheminStockage);
      if (!reponse.ok) {
        setUrlAudio(null);
        /**
         * Aucune URI accessible : repli « Aperçu audio indisponible pour ce
         * format. » ; une panne réseau ou inattendue garde, elle, son message
         * explicite.
         */
        setErreurAudio(
          reponse.erreur.type === 'metier' &&
            reponse.erreur.code === CODES_ERREUR_MEMBRE.FICHIER_INTROUVABLE
            ? MESSAGE_APERCU_INDISPONIBLE
            : traduireErreur(reponse.erreur),
        );
        return;
      }

      const urlResolue = reponse.valeur.url.trim();
      if (urlResolue.length === 0) {
        setUrlAudio(null);
        setErreurAudio(MESSAGE_APERCU_INDISPONIBLE);
        return;
      }
      setUrlAudio(urlResolue);
    } catch {
      setUrlAudio(null);
      setErreurAudio(
        'La piste audio est momentanément indisponible. Vérifiez votre connexion Internet puis réessayez.',
      );
    } finally {
      setChargementAudio(false);
    }
  }, [oeuvre]);

  /* ----------------------- Valeurs dérivées — hooks TOUJOURS inconditionnels */

  /**
   * ⚠️ Tous les hooks de l'écran sont appelés ICI, AVANT les retours anticipés
   * des états `chargement` / `erreur` / `vide` : React exige le même nombre de
   * hooks, dans le même ordre, à chaque rendu — sinon il lève « Rendered more
   * hooks than during the previous render » dès le passage chargement → contenu.
   * Le calcul ci-dessous tolère donc `oeuvre === null` au lieu d'être placé
   * après les retours.
   */
  const estAudio = Boolean(oeuvre?.chemin_fichier) && estFichierAudio(oeuvre?.mime_type);

  /* ------------------------------------------------------ États de l'écran */

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Fiche de l’œuvre" sousTitre="Espace membre">
        <LoadingState message="Chargement de la fiche…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Fiche de l’œuvre" sousTitre="Espace membre">
        <ErrorState
          titre="Fiche indisponible"
          message={messageErreur}
          libelleAction="Réessayer"
          onReessayer={() => void chargerFiche()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide' || !oeuvre) {
    return (
      <ScreenContainer titre="Fiche de l’œuvre" sousTitre="Espace membre">
        <EmptyState
          titre="Œuvre introuvable"
          message={messageVide}
          icone="folder-open"
          actionLibelle="Voir mes œuvres"
          onAction={retourOeuvres}
        />
      </ScreenContainer>
    );
  }

  const statut = STATUTS_AFFICHES[oeuvre.statut];
  const dateSoumission = formaterDateCourte(oeuvre.date_soumission);
  const dateDecision = formaterDateCourte(oeuvre.date_decision);
  const fichier = nomFichier(oeuvre.chemin_fichier);
  const dateCreation = formaterDateCourte(oeuvre.created_at);
  /** Attestations exploitables : un chemin de stockage est nécessaire (règle métier 8). */
  const attestationsUtiles = attestations.filter(
    (attestation) => attestation.chemin_stockage.trim().length > 0,
  );
  const enExamen = STATUTS_EN_EXAMEN.includes(oeuvre.statut);
  /** L'œuvre peut encore être corrigée : brouillon, envoyée ou en cours d'examen. */
  const modifiable = STATUTS_OEUVRE_MODIFIABLES.includes(oeuvre.statut);

  return (
    <ScreenContainer titre="Fiche de l’œuvre" sousTitre="Espace membre">
      <View className="w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-lg font-bold text-omda-black">Informations sur l’œuvre</Text>

        <Text className="mt-2 text-2xl font-bold text-omda-black">{oeuvre.titre}</Text>

        <View className="mt-3">
          <StatusPill statut={statut.variante} libelle={statut.libelle} />
        </View>

        <View className="mt-4 gap-2">
          <LigneInfo icone="tag" libelle="Catégorie" valeur={categorie ? categorie.libelle : '—'} />
          <LigneInfo
            icone="calendar-days"
            libelle="Année"
            valeur={oeuvre.annee ? String(oeuvre.annee) : '—'}
          />
          <LigneInfo icone="calendar-plus" libelle="Date de création" valeur={dateCreation || '—'} />
          <LigneInfo icone="paper-plane" libelle="Envoi à l’OMDA" valeur={dateSoumission || '—'} />
          <LigneInfo
            icone="clipboard-check"
            libelle="Décision de l’OMDA"
            valeur={dateDecision || '—'}
          />
          <LigneInfo icone="file-lines" libelle="Fichier déposé" valeur={fichier || '—'} />
        </View>

        <View className="mt-4">
          <Text className="text-sm text-omda-textGray">Description</Text>
          <Text className="mt-1 text-base text-omda-black">
            {oeuvre.description?.trim() ? oeuvre.description : '—'}
          </Text>
        </View>
      </View>

      <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <Text className="text-lg font-bold text-omda-black">Attestation de diffusion</Text>
        <Text className="mt-1 text-sm text-omda-textGray">
          Document exigé pour chaque œuvre (au moins une attestation) : informations en lecture
          seule depuis cette fiche.
        </Text>

        {erreurAttestations ? (
          <View className="mt-3">
            <InfoBanner
              variante="error"
              titre="Attestation indisponible"
              message={erreurAttestations}
              actionLibelle="Réessayer"
              onAction={() => void chargerFiche()}
            />
          </View>
        ) : (
          <>
            <View className="mt-3">
              <StatusPill
                statut={attestationsUtiles.length > 0 ? 'info' : 'error'}
                libelle={attestationsUtiles.length > 0 ? 'Ajoutée' : 'Manquante'}
              />
            </View>

            {attestationsUtiles.length > 0 ? (
              <View className="mt-3 gap-2">
                {attestationsUtiles.map((attestation) => (
                  <View
                    key={attestation.id}
                    className="rounded-xl border border-omda-borderGray bg-omda-warmGray p-3"
                  >
                    <View className="flex-row items-center">
                      <Icone nom="file-lines" taille={14} classeCouleur="text-omda-textGray" />
                      <Text className="ml-2 flex-1 text-base text-omda-black">
                        {nomFichier(attestation.chemin_stockage)}
                      </Text>
                    </View>
                    <Text className="mt-1 text-sm text-omda-textGray">
                      {`Ajoutée le ${formaterDateCourte(attestation.created_at) || '—'}`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="mt-2 text-base text-omda-textGray">
                Aucune attestation de diffusion n’est enregistrée pour cette œuvre. Ajoutez-la
                depuis « Reprendre le dépôt » ou « Modifier les informations ».
              </Text>
            )}
          </>
        )}
      </View>

      {estAudio ? (
        <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <Text className="text-lg font-bold text-omda-black">Écouter l’œuvre</Text>
          <Text className="mt-1 text-sm text-omda-textGray">
            Écoutez votre œuvre audio directement dans l’application.
          </Text>

          {urlAudio ? (
            <AudioPreview
              libelle={oeuvre.titre}
              url={urlAudio}
              onReessayer={() => void ecouterOeuvre()}
            />
          ) : (
            <View className="mt-3">
              <Button
                libelle="Écouter l’œuvre"
                variante="secondary"
                icone="headphones"
                pleineLargeur
                chargement={chargementAudio}
                onPress={() => void ecouterOeuvre()}
              />
            </View>
          )}

          {erreurAudio ? (
            <View className="mt-3">
              <InfoBanner
                variante="error"
                titre="Écoute indisponible"
                message={erreurAudio}
                actionLibelle="Réessayer"
                onAction={() => void ecouterOeuvre()}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <View className="mt-5 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
          <Text className="text-lg font-bold text-omda-black">Écoute de l’œuvre</Text>
          <Text className="mt-2 text-sm text-omda-textGray">{MESSAGE_APERCU_INDISPONIBLE}</Text>
        </View>
      )}

      {oeuvre.statut === 'BROUILLON' ? (
        <View className="mt-5 gap-3">
          <InfoBanner
            variante="info"
            titre="Brouillon"
            message="Cette œuvre n’a pas encore été envoyée à l’OMDA. Complétez son fichier et son attestation de diffusion, puis envoyez-la : aucun paiement n’est demandé à l’envoi."
          />
          <Button
            libelle="Reprendre le dépôt"
            icone="pen-to-square"
            pleineLargeur
            onPress={reprendreDepot}
          />
          {modifiable ? (
            <Button
              libelle="Modifier les informations"
              variante="secondary"
              icone="floppy-disk"
              pleineLargeur
              onPress={modifierOeuvre}
            />
          ) : null}
        </View>
      ) : null}

      {enExamen ? (
        <View className="mt-5 gap-3">
          <InfoBanner
            variante="pending"
            titre="Œuvre en cours d’examen"
            message="L’OMDA vérifie votre œuvre. Aucun paiement n’est demandé à cette étape : les frais de dépôt ne seront proposés qu’après la validation. Corriger une information ou remplacer un document reste possible tant que la décision n’est pas rendue."
          />
          {modifiable ? (
            <Button
              libelle="Modifier mon œuvre"
              icone="pen-to-square"
              pleineLargeur
              onPress={modifierOeuvre}
            />
          ) : null}
          <Button
            libelle="Actualiser"
            variante="secondary"
            icone="rotate-right"
            pleineLargeur
            onPress={() => void chargerFiche()}
          />
        </View>
      ) : null}

      {oeuvre.statut === 'VALIDEE' ? (
        <View className="mt-5 gap-3">
          <InfoBanner
            variante="pending"
            titre="Œuvre validée"
            message="Votre œuvre a été validée par l’OMDA. Réglez les frais de dépôt pour finaliser le dépôt."
          />

          {fraisDepot ? (
            <>
              <AmountCard
                objet={`Frais de dépôt — ${oeuvre.titre}`}
                montant={fraisDepot.montant}
                mention={fraisDepot.mention}
              />
              <Button
                libelle="Payer les frais de dépôt"
                variante="secondary"
                icone="money-bill-wave"
                pleineLargeur
                onPress={payerFraisDepot}
              />
            </>
          ) : null}

          {erreurFrais ? (
            <InfoBanner
              variante="error"
              titre="Montant indisponible"
              message={erreurFrais}
              actionLibelle="Réessayer"
              onAction={() => void chargerFiche()}
            />
          ) : null}
        </View>
      ) : null}

      {oeuvre.statut === 'REJETEE' ? (
        <View className="mt-5 gap-3">
          <InfoBanner
            variante="error"
            titre="Œuvre rejetée"
            message={
              oeuvre.motif_rejet ??
              'Aucun motif n’a été transmis. Contactez l’OMDA pour plus d’informations.'
            }
          />
          <Button
            libelle="Déposer une nouvelle œuvre"
            variante="secondary"
            icone="plus"
            pleineLargeur
            onPress={nouvelDepot}
          />
        </View>
      ) : null}

      {oeuvre.statut === 'DEPOT_FINALISE' ? (
        <View className="mt-5">
          <InfoBanner
            variante="success"
            titre="Dépôt finalisé"
            message="Le serveur OMDA a confirmé le paiement des frais de dépôt : votre œuvre est enregistrée."
          />
        </View>
      ) : null}

      <View className="mt-6 gap-3">
        <Button
          libelle="Mes œuvres"
          variante="secondary"
          icone="folder-open"
          pleineLargeur
          onPress={retourOeuvres}
        />
        <Button
          libelle="Retour à l’accueil"
          variante="secondary"
          icone="house"
          pleineLargeur
          onPress={() => router.push('/(membre)/(tabs)/accueil')}
        />
      </View>
    </ScreenContainer>
  );
}

/* ------------------------------------------------- Sous-composant local */

type PropsLigneInfo = {
  icone: NomIcone;
  libelle: string;
  valeur: string;
};

/** Ligne « libellé : valeur » de la fiche (information non modifiable). */
function LigneInfo({ icone, libelle, valeur }: PropsLigneInfo) {
  return (
    <View className="w-full flex-row items-center">
      <Icone nom={icone} taille={14} classeCouleur="text-omda-textGray" />
      <Text className="ml-2 flex-1 text-sm text-omda-textGray">
        {`${libelle} : ${valeur}`}
      </Text>
    </View>
  );
}
