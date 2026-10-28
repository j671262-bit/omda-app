import { useCallback, useEffect, useState } from 'react';
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
  type NomIcone,
} from '../../../src/components/ui';
import type { Notification, TypeNotification } from '../../../src/models';
import type { ErreurApp } from '../../../src/services/contracts';
import { memberRepository } from '../../../src/services/factory';

type EtatEcran = 'chargement' | 'erreur' | 'vide' | 'contenu';

/**
 * Icône + libellé de chaque type de notification (`TYPES_NOTIFICATION`).
 * Aucun libellé métier n'est inventé dans l'UI : il découle de l'énumération.
 */
const TYPES_AFFICHES: Record<TypeNotification, { icone: NomIcone; libelle: string }> = {
  DEMANDE_ENVOYEE: { icone: 'paper-plane', libelle: 'Demande envoyée' },
  DEMANDE_VALIDEE: { icone: 'circle-check', libelle: 'Demande validée' },
  DEMANDE_REJETEE: { icone: 'circle-xmark', libelle: 'Demande rejetée' },
  PAIEMENT_DISPONIBLE: { icone: 'money-bill-wave', libelle: 'Paiement disponible' },
  PAIEMENT_REUSSI: { icone: 'circle-check', libelle: 'Paiement confirmé' },
  PAIEMENT_ECHEC: { icone: 'circle-xmark', libelle: 'Paiement échoué' },
  OEUVRE_VALIDEE: { icone: 'circle-check', libelle: 'Œuvre validée' },
  OEUVRE_REJETEE: { icone: 'circle-xmark', libelle: 'Œuvre rejetée' },
  IDENTIFIANTS_ENVOYES: { icone: 'id-card', libelle: 'Identifiants envoyés' },
  GLOBALE: { icone: 'bullhorn', libelle: 'Annonce OMDA' },
};

/** Message compréhensible selon la famille d'erreur (`Result`). */
function traduireErreur(erreur: ErreurApp): string {
  if (erreur.type === 'metier') return erreur.message;
  if (erreur.type === 'reseau') {
    return 'Impossible de joindre le serveur OMDA. Vérifiez votre connexion Internet puis réessayez.';
  }
  return 'Vos notifications sont momentanément indisponibles. Veuillez réessayer dans quelques instants.';
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

/**
 * Une annonce globale (`utilisateur_id = NULL`) est partagée par tous les
 * utilisateurs : le service ne peut pas la marquer « lue » pour un seul membre.
 * Aucun bouton n'est donc proposé pour ce cas (message explicatif à la place).
 */
function estMarquable(notification: Notification): boolean {
  return notification.utilisateur_id !== null;
}

type PropsCarteNotification = {
  notification: Notification;
  enCours: boolean;
  /** Fourni uniquement pour une notification non lue que le membre peut marquer. */
  onMarquerLue?: () => void;
};

/** Carte d'une notification : type, message, date et action de lecture. */
function CarteNotification({ notification, enCours, onMarquerLue }: PropsCarteNotification) {
  const type = TYPES_AFFICHES[notification.type];
  const dateEnvoi = formaterDateHeure(notification.date_envoi);
  const marquable = estMarquable(notification);

  return (
    <View
      className={`w-full rounded-2xl border bg-omda-white p-4 ${
        notification.lue ? 'border-omda-borderGray' : 'border-omda-green'
      }`}
    >
      <View className="flex-row items-start">
        <Icone
          nom={type.icone}
          taille={16}
          classeCouleur={notification.lue ? 'text-omda-textGray' : 'text-omda-black'}
        />
        <View className="ml-3 flex-1">
          <Text className="text-base font-semibold text-omda-black">{notification.titre}</Text>
          <Text className="mt-1 text-base text-omda-black">{notification.message}</Text>
          <Text className="mt-2 text-sm text-omda-textGray">
            {dateEnvoi ? `${type.libelle} · ${dateEnvoi}` : type.libelle}
          </Text>
        </View>
      </View>

      <View className="mt-3">
        {notification.lue ? (
          <StatusPill statut="info" icone="envelope" libelle="Lue" />
        ) : (
          <StatusPill statut="pending" icone="bell" libelle="Non lue" />
        )}
      </View>

      {!notification.lue && marquable ? (
        <View className="mt-3">
          <Button
            libelle="Marquer comme lue"
            variante="secondary"
            chargement={enCours}
            onPress={onMarquerLue}
          />
        </View>
      ) : null}

      {!notification.lue && !marquable ? (
        <Text className="mt-2 text-sm text-omda-textGray">
          Annonce générale : elle ne peut pas être marquée comme lue individuellement.
        </Text>
      ) : null}
    </View>
  );
}

/** Compte rendu de « Tout marquer comme lu » (nombre renvoyé par le service). */
function messageMarquage(nombre: number): string {
  if (nombre === 0) return 'Aucune notification non lue à mettre à jour.';
  if (nombre === 1) return 'Une notification a été marquée comme lue.';
  return `${nombre} notifications ont été marquées comme lues.`;
}

/**
 * Notifications du membre (écran V du cahier des charges).
 *
 * Données : `memberRepository.listerNotifications()` ; la lecture utilise
 * `marquerNotificationLue()` et `marquerToutesNotificationsLues()`. La liste est
 * séparée en « Non lues » et « Lues » (statut toujours écrit, jamais une icône seule).
 *
 * États obligatoires : `LoadingState`, `ErrorState` + « Réessayer », `EmptyState`
 * (aucune notification) et contenu normal.
 */
export default function NotificationsScreen() {
  const [etat, setEtat] = useState<EtatEcran>('chargement');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [messageErreur, setMessageErreur] = useState('');
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [notificationEnCours, setNotificationEnCours] = useState<string | null>(null);
  const [marquageGlobal, setMarquageGlobal] = useState(false);
  const [messageSucces, setMessageSucces] = useState<string | null>(null);

  const chargerNotifications = useCallback(async () => {
    setEtat('chargement');
    setMessageErreur('');
    setErreurAction(null);
    setMessageSucces(null);

    const resultat = await memberRepository.listerNotifications();

    if (!resultat.ok) {
      setMessageErreur(traduireErreur(resultat.erreur));
      setEtat('erreur');
      return;
    }

    setNotifications(resultat.valeur);
    setEtat(resultat.valeur.length === 0 ? 'vide' : 'contenu');
  }, []);

  useEffect(() => {
    void chargerNotifications();
  }, [chargerNotifications]);

  const marquerLue = useCallback(async (notificationId: string) => {
    setNotificationEnCours(notificationId);
    setErreurAction(null);
    setMessageSucces(null);

    const resultat = await memberRepository.marquerNotificationLue(notificationId);

    setNotificationEnCours(null);

    if (!resultat.ok) {
      setErreurAction(traduireErreur(resultat.erreur));
      return;
    }

    const notificationMiseAJour = resultat.valeur;
    setNotifications((precedentes) =>
      precedentes.map((element) =>
        element.id === notificationId ? notificationMiseAJour : element,
      ),
    );
  }, []);

  const marquerToutesLues = useCallback(async () => {
    setMarquageGlobal(true);
    setErreurAction(null);
    setMessageSucces(null);

    const resultat = await memberRepository.marquerToutesNotificationsLues();

    setMarquageGlobal(false);

    if (!resultat.ok) {
      setErreurAction(traduireErreur(resultat.erreur));
      return;
    }

    // Les annonces globales (`utilisateur_id = NULL`) ne sont pas concernées.
    setNotifications((precedentes) =>
      precedentes.map((element) =>
        element.utilisateur_id === null ? element : { ...element, lue: true },
      ),
    );

    setMessageSucces(messageMarquage(resultat.valeur));
  }, []);

  if (etat === 'chargement') {
    return (
      <ScreenContainer titre="Notifications" afficherRetour={false}>
        <LoadingState message="Chargement de vos notifications…" />
      </ScreenContainer>
    );
  }

  if (etat === 'erreur') {
    return (
      <ScreenContainer titre="Notifications" afficherRetour={false}>
        <ErrorState
          titre="Notifications indisponibles"
          message={messageErreur}
          onReessayer={() => void chargerNotifications()}
        />
      </ScreenContainer>
    );
  }

  if (etat === 'vide') {
    return (
      <ScreenContainer titre="Notifications" afficherRetour={false}>
        <EmptyState
          titre="Aucune notification"
          message="Vous serez averti ici dès qu’une décision, un paiement ou une information de l’OMDA vous concernera."
          icone="bell-slash"
          actionLibelle="Actualiser"
          onAction={() => void chargerNotifications()}
        />
      </ScreenContainer>
    );
  }

  const nonLues = notifications.filter((element) => !element.lue);
  const lues = notifications.filter((element) => element.lue);

  return (
    <ScreenContainer titre="Notifications" afficherRetour={false}>
      <Text className="text-base text-omda-textGray">
        {nonLues.length === 0
          ? 'Toutes vos notifications ont été consultées.'
          : nonLues.length === 1
            ? 'Une notification non lue est à consulter.'
            : `${nonLues.length} notifications non lues sont à consulter.`}
      </Text>

      <View className="mt-4 gap-3">
        <Button
          libelle="Tout marquer comme lu"
          variante="secondary"
          icone="list-check"
          pleineLargeur
          chargement={marquageGlobal}
          desactive={nonLues.length === 0}
          onPress={() => void marquerToutesLues()}
        />
        <Button
          libelle="Actualiser"
          variante="secondary"
          icone="rotate-right"
          pleineLargeur
          onPress={() => void chargerNotifications()}
        />
      </View>

      {messageSucces ? (
        <View className="mt-3">
          <InfoBanner variante="success" message={messageSucces} />
        </View>
      ) : null}

      {erreurAction ? (
        <View className="mt-3">
          <InfoBanner
            variante="error"
            titre="Action impossible"
            message={erreurAction}
            actionLibelle="Actualiser la liste"
            onAction={() => void chargerNotifications()}
          />
        </View>
      ) : null}

      <View className="mt-6">
        <Text className="text-lg font-bold text-omda-black">{`Non lues (${nonLues.length})`}</Text>

        {nonLues.length === 0 ? (
          <View className="mt-3">
            <InfoBanner
              variante="info"
              message="Vous n’avez aucune notification non lue."
              icone="bell"
            />
          </View>
        ) : (
          <View className="mt-3 gap-3">
            {nonLues.map((notification) => (
              <CarteNotification
                key={notification.id}
                notification={notification}
                enCours={notificationEnCours === notification.id}
                onMarquerLue={() => void marquerLue(notification.id)}
              />
            ))}
          </View>
        )}
      </View>

      <View className="mt-6">
        <Text className="text-lg font-bold text-omda-black">{`Lues (${lues.length})`}</Text>

        {lues.length === 0 ? (
          <View className="mt-3">
            <InfoBanner
              variante="info"
              message="Aucune notification lue pour le moment."
              icone="envelope"
            />
          </View>
        ) : (
          <View className="mt-3 gap-3">
            {lues.map((notification) => (
              <CarteNotification
                key={notification.id}
                notification={notification}
                enCours={false}
              />
            ))}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}
