import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Icone,
  InfoBanner,
  LoadingState,
  ScreenContainer,
  StatusPill,
  TextField,
  type NomIcone,
  type StatutPill,
} from '../../../src/components/ui';
import type {
  RoleUtilisateur,
  StatutAdhesionCategorie,
  StatutUtilisateur,
} from '../../../src/models';
import type { ErreurApp, ProfilMembre } from '../../../src/services/contracts';
import { memberRepository } from '../../../src/services/factory';

/**
 * États de l'écran. `vide` = profil chargé mais aucune catégorie d'adhésion :
 * la section « Mes catégories » affiche alors un `EmptyState` (le profil lui-même
 * n'est jamais vide).
 */
type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/** Statuts de compte affichables (cahier des charges §6). */
const STATUTS_COMPTE: Record<StatutUtilisateur, { variante: StatutPill; libelle: string }> = {
  ACTIF: { variante: 'success', libelle: 'Compte actif' },
  DESACTIVE: { variante: 'error', libelle: 'Compte désactivé' },
  EN_ATTENTE_CHANGEMENT_MDP: { variante: 'pending', libelle: 'Mot de passe à renouveler' },
};

/** Statut de l'appartenance du membre à une catégorie (`membre_categorie.statut`). */
const STATUTS_CATEGORIE: Record<StatutAdhesionCategorie, { variante: StatutPill; libelle: string }> = {
  ACTIVE: { variante: 'success', libelle: 'Catégorie active' },
  EN_ATTENTE: { variante: 'pending', libelle: 'Demande en attente' },
  INACTIVE: { variante: 'info', libelle: 'Catégorie inactive' },
  REJETEE: { variante: 'error', libelle: 'Demande refusée' },
  ANNULEE: { variante: 'info', libelle: 'Demande annulée' },
};

/** Libellés lisibles des rôles (`ROLES_UTILISATEUR`). */
const LIBELLES_ROLE: Record<RoleUtilisateur, string> = {
  MEMBRE: 'Membre',
  AGENT: 'Agent OMDA',
  ADMINISTRATEUR: 'Administrateur',
};

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Votre profil est momentanément indisponible. Veuillez réessayer dans quelques instants.';
}

/** Horodatage affiché en `JJ/MM/AAAA à HH:MM` (formatage manuel, sans `Intl`). */
function formaterDateHeure(dateIso: string | null): string {
  if (!dateIso) return '';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '';
  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const heures = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${jour}/${mois}/${date.getFullYear()} à ${heures}:${minutes}`;
}

/** Date affichée en `JJ/MM/AAAA`. */
function formaterDateCourte(dateIso: string | null): string {
  const complet = formaterDateHeure(dateIso);
  return complet ? complet.split(' à ')[0] : '';
}

/**
 * Phrase de statut horodatée sous chaque catégorie : activation datée, demande
 * récente (règle métier 9), demande annulée ou refusée par l'OMDA, ou simple
 * enregistrement. `date_activation` porte l'horodatage du dernier changement de
 * statut côté « serveur ».
 */
function phraseCategorie(statut: StatutAdhesionCategorie | undefined, date: string): string {
  if (statut === 'ACTIVE') return `Membre de cette catégorie depuis le ${date}.`;
  if (statut === 'EN_ATTENTE') {
    return `Demande envoyée le ${date} : en attente de la décision d’un agent OMDA.`;
  }
  if (statut === 'ANNULEE') {
    return `Demande annulée le ${date} : vous pouvez la demander à nouveau.`;
  }
  if (statut === 'REJETEE') {
    return `Demande refusée par l’OMDA le ${date} : vous pouvez la redemander.`;
  }
  return `Catégorie enregistrée le ${date}.`;
}

/** Numéro de téléphone au format international (+261 + 9 chiffres), comme à l'adhésion. */
function validerTelephone(valeur: string): string | undefined {
  const propre = valeur.replace(/\s+/g, '');
  if (!propre || propre === '+261') return 'Le numéro de téléphone est obligatoire.';
  if (!propre.startsWith('+261')) return 'Le numéro doit commencer par l’indicatif +261.';
  if (propre.length < 13) return 'Numéro incomplet : 9 chiffres requis après +261.';
  return undefined;
}

type PropsLigneInfo = {
  libelle: string;
  valeur: string;
  icone?: NomIcone;
};

/** Ligne d'information NON modifiable (libellé + valeur). */
function LigneInfo({ libelle, valeur, icone = 'lock' }: PropsLigneInfo) {
  return (
    <View className="w-full flex-row items-start rounded-xl border border-omda-borderGray bg-omda-warmGray p-4">
      <Icone nom={icone} taille={14} classeCouleur="text-omda-textGray" />
      <View className="ml-3 flex-1">
        <Text className="text-sm text-omda-textGray">{libelle}</Text>
        <Text className="mt-1 text-base font-semibold text-omda-black">{valeur}</Text>
      </View>
    </View>
  );
}

type PropsTitreSection = {
  icone: NomIcone;
  titre: string;
  mention: string;
};

/** Titre de section : rappelle systématiquement si la section est modifiable ou non. */
function TitreSection({ icone, titre, mention }: PropsTitreSection) {
  return (
    <View className="flex-row items-start">
      <Icone nom={icone} taille={18} classeCouleur="text-omda-black" />
      <View className="ml-3 flex-1">
        <Text className="text-lg font-bold text-omda-black">{titre}</Text>
        <Text className="mt-1 text-sm text-omda-textGray">{mention}</Text>
      </View>
    </View>
  );
}

/**
 * Profil du membre (écran U du cahier des charges).
 *
 * Données : `memberRepository.obtenirProfil()` ; le SEUL champ modifiable est
 * le numéro de téléphone (`mettreAJourProfil`) — le nom, le prénom, le CIN et la
 * date de naissance viennent du dossier candidat et restent en lecture seule.
 *
 * Section « Mes catégories » (règle métier 9) : toutes les catégories du membre
 * avec leur statut (`ACTIVE`, `EN_ATTENTE`, `INACTIVE`, `REJETEE`, `ANNULEE`),
 * accès à l'écran `/(membre)/demander-categorie` (choix → œuvres → envoi) et
 * annulation — avec confirmation dans l'écran — d'une demande `EN_ATTENTE`
 * (`annulerDemandeCategorie`, statut `ANNULEE`, catégorie redevient demandable).
 *
 * États obligatoires : `LoadingState`, `ErrorState` + « Réessayer », `EmptyState`
 * (aucune catégorie) et contenu normal.
 */
export default function ProfilScreen() {
  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [profil, setProfil] = useState<ProfilMembre | null>(null);
  const [messageErreur, setMessageErreur] = useState('');
  const [telephoneSaisi, setTelephoneSaisi] = useState('');
  const [erreurTelephone, setErreurTelephone] = useState<string | undefined>(undefined);
  const [enregistrement, setEnregistrement] = useState(false);
  const [messageSucces, setMessageSucces] = useState<string | null>(null);
  const [erreurEnregistrement, setErreurEnregistrement] = useState<string | null>(null);
  /** Annulation d'une demande `EN_ATTENTE` : id annulé, confirmation, messages. */
  const [annulationEnCours, setAnnulationEnCours] = useState<string | null>(null);
  const [confirmationAnnulation, setConfirmationAnnulation] = useState<string | null>(null);
  const [messageAnnulation, setMessageAnnulation] = useState<string | null>(null);
  const [erreurAnnulation, setErreurAnnulation] = useState<string | null>(null);

  const chargerProfil = useCallback(async (options?: { silencieux?: boolean }) => {
    const silencieux = options?.silencieux === true;
    if (!silencieux) {
      setEtat('chargement');
      setMessageErreur('');
      setMessageSucces(null);
      setErreurEnregistrement(null);
      setErreurTelephone(undefined);
    }

    const resultat = await memberRepository.obtenirProfil();

    if (!resultat.ok) {
      if (silencieux) {
        // Rechargement silencieux (retour d'un autre écran) : l'affichage
        // actuel est conservé ; « Actualiser le profil » permet de réessayer.
        return;
      }
      setMessageErreur(traduireErreur(resultat.erreur));
      setEtat('erreur');
      return;
    }

    setProfil(resultat.valeur);
    if (!silencieux) {
      setTelephoneSaisi(resultat.valeur.utilisateur.telephone ?? '');
    }
    setMessageErreur('');
    setEtat(resultat.valeur.categories.length === 0 ? 'vide' : 'contenu');
  }, []);

  /**
   * Premier focus ⇒ chargement complet ; focus suivants (retour d'un autre
   * écran, changement d'onglet) ⇒ rechargement silencieux, pour afficher une
   * éventuelle « Demande en attente » créée depuis `/(membre)/demander-categorie`.
   */
  const premierFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (premierFocus.current) {
        premierFocus.current = false;
        void chargerProfil();
        return;
      }
      void chargerProfil({ silencieux: true });
    }, [chargerProfil]),
  );

  const enregistrerTelephone = useCallback(async () => {
    const erreur = validerTelephone(telephoneSaisi);
    setErreurTelephone(erreur);
    if (erreur) {
      setMessageSucces(null);
      return;
    }

    setEnregistrement(true);
    setMessageSucces(null);
    setErreurEnregistrement(null);

    const resultat = await memberRepository.mettreAJourProfil({
      telephone: telephoneSaisi.trim().replace(/\s+/g, ''),
    });

    setEnregistrement(false);

    if (!resultat.ok) {
      setErreurEnregistrement(traduireErreur(resultat.erreur));
      return;
    }

    setProfil(resultat.valeur);
    setTelephoneSaisi(resultat.valeur.utilisateur.telephone ?? '');
    setMessageSucces('Votre numéro de téléphone a été enregistré par le serveur.');
  }, [telephoneSaisi]);

  /**
   * Annulation d'une demande `EN_ATTENTE` (règle métier 9) : confirmation
   * affichée DANS l'écran (aucun `Alert`), puis `annulerDemandeCategorie` fait
   * passer l'appartenance au statut `ANNULEE` (l'enregistrement est conservé et
   * la catégorie redevient demandable). Enfin le profil est rechargé
   * silencieusement pour réafficher les pastilles ; en cas d'échec, l'affichage
   * actuel est conservé et le message d'erreur est affiché sous la section.
   */
  const annulerDemande = useCallback(
    async (membreCategorieId: string) => {
      setAnnulationEnCours(membreCategorieId);
      setErreurAnnulation(null);
      setMessageAnnulation(null);

      const resultat = await memberRepository.annulerDemandeCategorie(membreCategorieId);

      setAnnulationEnCours(null);
      setConfirmationAnnulation(null);

      if (!resultat.ok) {
        setErreurAnnulation(traduireErreur(resultat.erreur));
        return;
      }

      setMessageAnnulation(
        'Votre demande a été annulée : vous pouvez la redemander à tout moment depuis cet écran.',
      );
      await chargerProfil({ silencieux: true });
    },
    [chargerProfil],
  );

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Profil" afficherRetour={false}>
        <LoadingState message="Chargement de votre profil…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Profil" afficherRetour={false}>
        <ErrorState
          titre="Profil indisponible"
          message={messageErreur}
          onReessayer={() => void chargerProfil()}
        />
      </ScreenContainer>
    );
  }

  if (!profil) {
    return (
      <ScreenContainer titre="Profil" afficherRetour={false}>
        <EmptyState
          titre="Aucune donnée à afficher"
          message="Votre profil n’a pas pu être récupéré. Veuillez réessayer."
          icone="circle-info"
          actionLibelle="Réessayer"
          onAction={() => void chargerProfil()}
        />
      </ScreenContainer>
    );
  }

  const statutCompte = STATUTS_COMPTE[profil.utilisateur.statut];
  const telephoneActuel = profil.utilisateur.telephone ?? '';
  const telephoneModifie = telephoneSaisi.trim() !== telephoneActuel;
  const derniereConnexion = formaterDateHeure(profil.utilisateur.derniere_connexion_at);

  return (
    <ScreenContainer titre="Profil" afficherRetour={false}>
      <Text className="text-base text-omda-textGray">
        Retrouvez ci-dessous les informations de votre compte. Les rubriques
        « lecture seule » ne peuvent pas être modifiées depuis l’application.
      </Text>

      {/* ------------------------ Informations modifiables ------------------------ */}
      <View className="mt-5 w-full rounded-2xl border border-omda-green bg-omda-white p-5">
        <TitreSection
          icone="phone"
          titre="Informations modifiables"
          mention="Vous pouvez mettre à jour ces informations vous-même."
        />

        <View className="mt-4">
          <TextField
            libelle="Téléphone (+261)"
            valeur={telephoneSaisi}
            placeholder="+261 34 12 345 67"
            aide="Format international (+261…)"
            clavier="phone-pad"
            erreur={erreurTelephone}
            onChangeValeur={(valeur) => {
              setTelephoneSaisi(valeur);
              setMessageSucces(null);
              if (erreurTelephone) {
                setErreurTelephone(undefined);
              }
            }}
          />
        </View>

        <View className="mt-4">
          <Button
            libelle="Enregistrer"
            pleineLargeur
            chargement={enregistrement}
            desactive={!telephoneModifie}
            onPress={() => void enregistrerTelephone()}
          />
        </View>

        {messageSucces ? (
          <View className="mt-3">
            <InfoBanner variante="success" message={messageSucces} />
          </View>
        ) : null}

        {erreurEnregistrement ? (
          <View className="mt-3">
            <InfoBanner
              variante="error"
              titre="Enregistrement impossible"
              message={erreurEnregistrement}
              actionLibelle="Réessayer"
              onAction={() => void enregistrerTelephone()}
            />
          </View>
        ) : null}
      </View>

      {/* ------------------------- Informations consultables --------------------- */}
      <View className="mt-4 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <TitreSection
          icone="lock"
          titre="Informations en lecture seule"
          mention="Elles proviennent de votre dossier d’adhésion : contactez l’OMDA pour toute correction."
        />

        <View className="mt-4">
          <StatusPill statut="info" icone="lock" libelle="Non modifiable" />
        </View>

        <View className="mt-4 gap-3">
          <LigneInfo
            libelle="Adresse e-mail"
            valeur={profil.utilisateur.email}
            icone="envelope"
          />
          <LigneInfo
            libelle="Numéro d’adhérent"
            valeur={profil.membre.numero_adherent}
            icone="id-card"
          />
          <LigneInfo
            libelle="Rôle"
            valeur={LIBELLES_ROLE[profil.utilisateur.role]}
            icone="user"
          />
          <LigneInfo
            libelle="Adhérent depuis le"
            valeur={formaterDateCourte(profil.membre.created_at) || '—'}
            icone="clock"
          />
          <LigneInfo
            libelle="Dernière connexion"
            valeur={derniereConnexion || 'Aucune connexion enregistrée.'}
            icone="clock"
          />

          <View className="w-full rounded-xl border border-omda-borderGray bg-omda-warmGray p-4">
            <Text className="text-sm text-omda-textGray">Statut du compte</Text>
            <View className="mt-2">
              <StatusPill statut={statutCompte.variante} libelle={statutCompte.libelle} />
            </View>
          </View>
        </View>
      </View>

      {/* ------------------------------ Mes catégories ------------------------------ */}
      <View className="mt-4 w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
        <TitreSection
          icone="layer-group"
          titre="Mes catégories"
          mention="Toutes vos catégories d’adhésion et l’état de chaque demande."
        />

        <View className="mt-4">
          {etat === 'vide' ? (
            <EmptyState
              titre="Aucune catégorie"
              message="Aucune catégorie d’adhésion n’est associée à votre profil pour le moment."
              icone="folder-open"
            />
          ) : (
            <View className="gap-3">
              {profil.categories.map((categorie) => {
                const appartenance = profil.membre_categories.find(
                  (element) => element.categorie_id === categorie.id,
                );
                const statutCategorie = appartenance
                  ? STATUTS_CATEGORIE[appartenance.statut]
                  : null;
                const dateActivation = appartenance
                  ? formaterDateCourte(appartenance.date_activation)
                  : '';

                return (
                  <View
                    key={categorie.id}
                    className="w-full rounded-xl border border-omda-borderGray bg-omda-warmGray p-4"
                  >
                    <Text className="text-base font-semibold text-omda-black">
                      {categorie.libelle}
                    </Text>

                    {categorie.description ? (
                      <Text className="mt-1 text-sm text-omda-textGray">
                        {categorie.description}
                      </Text>
                    ) : null}

                    {statutCategorie ? (
                      <View className="mt-3">
                        <StatusPill
                          statut={statutCategorie.variante}
                          libelle={statutCategorie.libelle}
                        />
                      </View>
                    ) : null}

                    {dateActivation ? (
                      <Text className="mt-2 text-sm text-omda-textGray">
                        {phraseCategorie(appartenance?.statut, dateActivation)}
                      </Text>
                    ) : null}

                    {appartenance?.statut === 'EN_ATTENTE' ? (
                      confirmationAnnulation === appartenance.id ? (
                        <View className="mt-3 rounded-xl border border-omda-borderGray bg-omda-white p-4">
                          <Text className="text-sm text-omda-black">
                            Annuler cette demande ? Vous pourrez la redemander à tout moment
                            pour cette catégorie.
                          </Text>
                          <View className="mt-3 gap-3">
                            <Button
                              libelle="Oui, annuler la demande"
                              icone="trash"
                              variante="destructive"
                              pleineLargeur
                              chargement={annulationEnCours === appartenance.id}
                              desactive={annulationEnCours !== null}
                              onPress={() => void annulerDemande(appartenance.id)}
                            />
                            <Button
                              libelle="Conserver la demande"
                              variante="secondary"
                              pleineLargeur
                              desactive={annulationEnCours !== null}
                              onPress={() => setConfirmationAnnulation(null)}
                            />
                          </View>
                        </View>
                      ) : (
                        <View className="mt-3">
                          <Button
                            libelle="Annuler la demande"
                            icone="trash"
                            variante="destructive"
                            pleineLargeur
                            desactive={annulationEnCours !== null}
                            onPress={() => setConfirmationAnnulation(appartenance.id)}
                          />
                        </View>
                      )
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {messageAnnulation ? (
          <View className="mt-4">
            <InfoBanner variante="success" titre="Demande annulée" message={messageAnnulation} />
          </View>
        ) : null}

        {erreurAnnulation ? (
          <View className="mt-4">
            <InfoBanner
              variante="error"
              titre="Annulation impossible"
              message={erreurAnnulation}
            />
          </View>
        ) : null}

        <View className="mt-4 border-t border-omda-borderGray pt-4">
          <Text className="text-sm text-omda-textGray">
            Une catégorie supplémentaire se demande depuis cet écran : votre
            demande reste « en attente » jusqu’à la décision d’un agent OMDA.
          </Text>

          <View className="mt-3">
            <Button
              libelle="Demander une catégorie supplémentaire"
              icone="circle-plus"
              pleineLargeur
              onPress={() => router.push('/(membre)/demander-categorie')}
            />
          </View>
        </View>
      </View>

      {/* --------------------------------- Actions -------------------------------- */}
      <View className="mt-5 gap-3">
        <Button
          libelle="Actualiser le profil"
          variante="secondary"
          icone="rotate-right"
          pleineLargeur
          onPress={() => void chargerProfil()}
        />
        <Button
          libelle="Se déconnecter"
          variante="secondary"
          icone="right-from-bracket"
          pleineLargeur
          onPress={() => router.push('/(membre)/deconnexion')}
        />
      </View>
    </ScreenContainer>
  );
}
