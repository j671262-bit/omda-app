import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { formaterDuree } from '../../utils';
import { Button } from './Button';
import { Icone } from './Icone';

/** Fréquence de rafraîchissement de la progression d'écoute (millisecondes). */
const INTERVALLE_MAJ_MS = 250;

/** Délai maximal de préparation d'une piste (millisecondes) : le chargement ne reste JAMAIS infini. */
const DELAI_PREPARATION_MS = 9000;

/** URI absente ou non résolue par le service. */
const MESSAGE_URI_ABSENTE = 'Aperçu indisponible pour le moment.';

/** Le lecteur n'a pas terminé la préparation dans le délai imparti. */
const MESSAGE_DELAI =
  'Délai dépassé : la piste audio met trop de temps à se préparer. Vérifiez votre connexion Internet puis réessayez.';

/** Échec de la (re)création de la piste côté lecteur. */
const MESSAGE_PREPARATION = 'La piste audio n’a pas pu être préparée. Réessayez dans un instant.';

/** Échec de lecture remonté par `expo-audio` (`statut.error`). */
const MESSAGE_LECTURE =
  'La piste audio n’a pas pu être lue. Vérifiez votre connexion Internet puis réessayez.';

type PropsAudioPreview = {
  /** Nom lisible du document (lu par les lecteurs d'écran). */
  libelle: string;
  /** Lien temporaire de lecture fourni par le service (`obtenirUrlFichier`). */
  url: string;
  /** Recharge le lien temporaire auprès du service (URI vide ou expirée). */
  onReessayer?: () => void;
};

/**
 * Lecteur audio intégré d'une œuvre (`expo-audio`).
 *
 * - la source est TOUJOURS l'URL fournie par le service : l'écran ne construit
 *   jamais de lien à partir d'un chemin de stockage (bucket privé) ;
 * - le chargement ne reste JAMAIS bloqué : un délai de sécurité de 9 s éteint
 *   l'indicateur puis affiche un message clair avec un bouton « Réessayer » ;
 *   une URI absente affiche « Aperçu indisponible pour le moment. » ;
 * - chaque (re)préparation de la piste passe par un `try / catch / finally` qui
 *   garantit l'extinction de l'indicateur, quoi qu'il arrive ;
 * - trois états utiles : piste en préparation, lecture en cours, erreur de
 *   lecture avec « Réessayer » (le lecteur recharge la source) ;
 * - `useAudioPlayer` libère le lecteur au démontage de l'écran : l'effet
 *   ci-dessous coupe la lecture puis libère la piste (équivalent d'un
 *   `unloadAsync`) — aucun son ne continue en arrière-plan ;
 * - aucune couleur hex : uniquement des tokens (`omda-*`). La barre de
 *   progression est verte car c'est la couleur de MARQUE (`omda-green`), elle
 *   n'annonce aucune confirmation de succès ;
 * - pas de déplacement dans la piste (pas de « seek ») : le lecteur reste
 *   volontairement simple, l'ouverture externe couvre les besoins avancés.
 */
export function AudioPreview({ libelle, url, onReessayer }: PropsAudioPreview) {
  const uri = url.trim();
  const source = uri.length > 0 ? uri : null;
  const player = useAudioPlayer(source, { updateInterval: INTERVALLE_MAJ_MS });
  const statut = useAudioPlayerStatus(player);

  /** Minuteur de sécurité : garantit la fin de la préparation. */
  const minuteurPreparation = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [chargement, setChargement] = useState(source !== null);
  const [erreurPreparation, setErreurPreparation] = useState<string | null>(
    source === null ? MESSAGE_URI_ABSENTE : null,
  );

  /** Annule le délai de préparation en cours (s'il existe). */
  const annulerMinuteur = useCallback(() => {
    if (minuteurPreparation.current !== null) {
      clearTimeout(minuteurPreparation.current);
      minuteurPreparation.current = null;
    }
  }, []);

  /**
   * Démarre une préparation SANS jamais laisser l'indicateur bloqué : soit le
   * lecteur signale la fin (`statut.isLoaded`), soit le délai de sécurité
   * éteint `chargement` et affiche le message dédié.
   */
  const demarrerPreparation = useCallback(() => {
    annulerMinuteur();
    if (source === null) {
      setChargement(false);
      setErreurPreparation(MESSAGE_URI_ABSENTE);
      return;
    }
    setErreurPreparation(null);
    setChargement(true);
    minuteurPreparation.current = setTimeout(() => {
      minuteurPreparation.current = null;
      setChargement(false);
      setErreurPreparation(MESSAGE_DELAI);
    }, DELAI_PREPARATION_MS);
  }, [annulerMinuteur, source]);

  /** Nouvelle source : la préparation (et son garde-fou) démarrent. */
  useEffect(() => {
    demarrerPreparation();
    return annulerMinuteur;
  }, [annulerMinuteur, demarrerPreparation]);

  /** Fin de préparation observée sur le lecteur : on éteint l'attente (succès ou erreur). */
  useEffect(() => {
    if (statut.isLoaded) {
      annulerMinuteur();
      setChargement(false);
      setErreurPreparation(null);
    } else if (statut.error) {
      annulerMinuteur();
      setChargement(false);
    }
  }, [annulerMinuteur, statut.error, statut.isLoaded]);

  /** Démontage : coupe la lecture puis libère la piste (l'équivalent d'un `unloadAsync`). */
  useEffect(() => {
    return () => {
      annulerMinuteur();
      try {
        player.pause();
        player.remove();
      } catch {
        // Le lecteur a pu être libéré en premier par `useAudioPlayer`.
      }
    };
  }, [annulerMinuteur, player]);

  const enPreparation = chargement && !statut.isLoaded;
  const duree = statut.duration;
  const progression = duree > 0 ? Math.min(100, Math.round((statut.currentTime / duree) * 100)) : 0;

  const basculerLecture = useCallback(() => {
    if (statut.playing) {
      player.pause();
      return;
    }
    /** Une piste terminée repart du début : `play()` seul resterait à la fin. */
    if (statut.didJustFinish) {
      void player.seekTo(0);
    }
    player.play();
  }, [player, statut.didJustFinish, statut.playing]);

  /**
   * Relance la préparation de la piste : `try / catch / finally` garantit que
   * l'indicateur s'éteint dans TOUS les cas (le `finally` couvre les chemins où
   * aucun garde-fou n'a pu être armé — URI vide ou échec immédiat).
   */
  const rechargerPiste = useCallback(() => {
    try {
      if (source === null) {
        /** URI absente : on redemande le lien au service, faute de quoi le message reste. */
        demarrerPreparation();
        onReessayer?.();
        return;
      }
      demarrerPreparation();
      player.replace(source);
    } catch {
      annulerMinuteur();
      setChargement(false);
      setErreurPreparation(MESSAGE_PREPARATION);
    } finally {
      /** Invariant « jamais de chargement infini » : sans garde-fou armé, on éteint ici. */
      if (minuteurPreparation.current === null) {
        setChargement(false);
      }
    }
  }, [annulerMinuteur, demarrerPreparation, onReessayer, player, source]);

  if (statut.error) {
    return (
      <View className="mt-3 w-full rounded-xl border border-status-error bg-omda-white p-4">
        <View className="flex-row items-start">
          <Icone nom="circle-xmark" taille={18} classeCouleur="text-status-error" />
          <View className="ml-3 flex-1">
            <Text className="text-base font-semibold text-status-error">Écoute impossible</Text>
            <Text className="mt-1 text-base text-omda-black">{MESSAGE_LECTURE}</Text>
          </View>
        </View>
        <View className="mt-3">
          <Button
            libelle="Réessayer l’écoute"
            variante="secondary"
            icone="rotate-right"
            onPress={rechargerPiste}
          />
        </View>
      </View>
    );
  }

  /** Préparation échouée (URI absente, délai dépassé ou échec du lecteur). */
  if (erreurPreparation) {
    return (
      <View className="mt-3 w-full rounded-xl border border-status-error bg-omda-white p-4">
        <View className="flex-row items-start">
          <Icone nom="circle-xmark" taille={18} classeCouleur="text-status-error" />
          <View className="ml-3 flex-1">
            <Text className="text-base font-semibold text-status-error">
              {source === null ? 'Écoute indisponible' : 'Préparation impossible'}
            </Text>
            <Text className="mt-1 text-base text-omda-black">{erreurPreparation}</Text>
          </View>
        </View>
        <View className="mt-3">
          <Button
            libelle="Réessayer"
            variante="secondary"
            icone="rotate-right"
            onPress={rechargerPiste}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="mt-3 w-full rounded-xl border border-omda-borderGray bg-omda-warmGray p-4">
      <View className="flex-row items-center">
        <Icone nom="volume-high" taille={16} classeCouleur="text-omda-textGray" />
        <Text className="ml-2 flex-1 text-sm text-omda-textGray">
          {enPreparation ? 'Préparation de la piste audio…' : `Écoute dans l’application — ${libelle}`}
        </Text>
      </View>

      <View
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-omda-borderGray"
        accessibilityRole="progressbar"
        accessibilityLabel={`Progression de l’écoute de ${libelle}`}
        accessibilityValue={{ min: 0, max: 100, now: progression }}
      >
        <View className="h-2 rounded-full bg-omda-green" style={{ width: `${progression}%` }} />
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-sm text-omda-textGray">{formaterDuree(statut.currentTime)}</Text>
        <Text className="text-sm text-omda-textGray">
          {enPreparation ? 'Durée inconnue' : formaterDuree(duree)}
        </Text>
      </View>

      <View className="mt-3 gap-3">
        <Button
          libelle={statut.playing ? 'Mettre en pause' : 'Écouter'}
          variante={statut.playing ? 'secondary' : 'primary'}
          icone={statut.playing ? 'pause' : 'play'}
          pleineLargeur
          desactive={enPreparation}
          chargement={enPreparation}
          onPress={basculerLecture}
        />
        {statut.currentTime > 0 && !enPreparation ? (
          <Button
            libelle="Revenir au début"
            variante="secondary"
            icone="clock-rotate-left"
            pleineLargeur
            onPress={() => void player.seekTo(0)}
          />
        ) : null}
      </View>
    </View>
  );
}
