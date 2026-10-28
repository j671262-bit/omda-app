import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from './Button';
import { Icone, type NomIcone } from './Icone';
import { StatusPill, type StatutPill } from './StatusPill';

/** États d'un envoi de fichier. */
export type StatutUpload = 'vide' | 'enCours' | 'verification' | 'reussi' | 'erreur';

/**
 * Délai laissé au menu « Modifier » pour se fermer avant l'ouverture du
 * sélecteur natif (évite deux modales natives superposées sur Android).
 */
const DELAI_FERMETURE_MODAL_MS = 250;

type DescriptionStatut = {
  pastille: StatutPill;
  libelle: string;
};

const STATUTS: Record<Exclude<StatutUpload, 'vide'>, DescriptionStatut> = {
  enCours: { pastille: 'pending', libelle: 'Envoi en cours' },
  verification: { pastille: 'pending', libelle: 'En attente de vérification' },
  reussi: { pastille: 'success', libelle: 'Envoi confirmé' },
  erreur: { pastille: 'error', libelle: 'Échec de l’envoi' },
};

type PropsUploadTile = {
  libelle: string;
  statut: StatutUpload;
  nomFichier?: string;
  /** Progression 0 → 100 (utilisée si `statut = "enCours"`). */
  progression?: number;
  /** Message complémentaire (ex. erreur réseau, instruction). */
  message?: string;
  icone?: NomIcone;
  obligatoire?: boolean;
  onSelectionner?: () => void;
  onReessayer?: () => void;
  /**
   * Remplace un fichier déjà choisi : l'appelant rouvre le sélecteur, revérifie
   * la taille (20 Mo) et relance l'envoi. L'ancien fichier est écrasé.
   */
  onRemplacer?: () => void;
  /** Supprime le fichier choisi : l'appelant demande confirmation puis remet la tuile à vide. */
  onSupprimer?: () => void;
};

/**
 * Tuile d'envoi de document : progression, statut, reprise sur erreur et gestion
 * du fichier choisi (menu « Modifier » → remplacer ou supprimer).
 * - Limite métier de 20 Mo et coupures réseau gérées par l'appelant (service).
 * - ⚠️ `reussi` (vert) uniquement après confirmation du serveur.
 * - Une seule action visible (« Modifier ») dès qu'un fichier existe ; le reste
 *   se fait dans une modale (`Modal` React Native, aucune librairie externe) :
 *   « Remplacer le fichier », « Supprimer le fichier » (avec confirmation) et
 *   « Annuler ».
 * - Pendant un envoi (`enCours`), « Modifier » est désactivé : un fichier ne
 *   peut pas être modifié au milieu d'un téléversement.
 */
export function UploadTile({
  libelle,
  statut,
  nomFichier,
  progression = 0,
  message,
  icone = 'cloud-arrow-up',
  obligatoire = false,
  onSelectionner,
  onReessayer,
  onRemplacer,
  onSupprimer,
}: PropsUploadTile) {
  const enCours = statut === 'enCours';
  const valeurProgression = Math.max(0, Math.min(100, Math.round(progression)));
  const description = statut === 'vide' ? null : STATUTS[statut];
  /** Un fichier existe dès que la tuile n'est plus à l'état « vide ». */
  const fichierPresent = statut !== 'vide';

  const [menuOuvert, setMenuOuvert] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);

  const ouvrirMenu = () => {
    if (enCours) {
      return;
    }
    setConfirmationSuppression(false);
    setMenuOuvert(true);
  };

  const fermerMenu = () => {
    setMenuOuvert(false);
    setConfirmationSuppression(false);
  };

  const lancerRemplacement = () => {
    fermerMenu();
    setTimeout(() => onRemplacer?.(), DELAI_FERMETURE_MODAL_MS);
  };

  /** Suppression confirmée : la remise à l'état « manquant » est faite par l'appelant. */
  const confirmerSuppression = () => {
    fermerMenu();
    onSupprimer?.();
  };

  return (
    <View className="w-full rounded-xl border border-omda-borderGray bg-omda-white p-4">
      <View className="flex-row items-start">
        <Icone nom={icone} taille={18} classeCouleur="text-omda-textGray" />
        <Text className="ml-2 flex-1 text-base font-semibold text-omda-black">
          {libelle}
          {obligatoire ? ' *' : ''}
        </Text>
      </View>

      {nomFichier ? <Text className="mt-1 text-sm text-omda-textGray">{nomFichier}</Text> : null}

      {description ? (
        <View className="mt-3">
          <StatusPill statut={description.pastille} libelle={description.libelle} />
        </View>
      ) : (
        <Text className="mt-2 text-sm text-omda-textGray">Aucun fichier sélectionné.</Text>
      )}

      {enCours ? (
        <View className="mt-3">
          <View
            className="h-2 w-full overflow-hidden rounded-full bg-omda-borderGray"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: valeurProgression }}
          >
            <View className="h-2 rounded-full bg-status-pending" style={{ width: `${valeurProgression}%` }} />
          </View>
          <Text className="mt-1 text-sm text-omda-textGray">{`${valeurProgression} %`}</Text>
        </View>
      ) : null}

      {message ? <Text className="mt-2 text-sm text-omda-black">{message}</Text> : null}

      {statut === 'vide' && onSelectionner ? (
        <View className="mt-3">
          <Button libelle="Choisir un fichier" variante="secondary" icone="cloud-arrow-up" onPress={onSelectionner} />
        </View>
      ) : null}

      {statut === 'erreur' && onReessayer ? (
        <View className="mt-3">
          <Button libelle="Réessayer" variante="secondary" onPress={onReessayer} />
        </View>
      ) : null}

      {fichierPresent && (onRemplacer || onSupprimer) ? (
        <View className="mt-3">
          <Button
            libelle="Modifier"
            variante="secondary"
            icone="pen-to-square"
            desactive={enCours}
            onPress={ouvrirMenu}
          />
        </View>
      ) : null}

      <Modal
        visible={menuOuvert}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={fermerMenu}
      >
        <View className="flex-1 items-center justify-center px-5">
          <Pressable
            className="absolute bottom-0 left-0 right-0 top-0 bg-omda-black opacity-60"
            accessibilityRole="button"
            accessibilityLabel="Fermer la fenêtre"
            onPress={fermerMenu}
          />

          <View className="w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
            {confirmationSuppression ? (
              <View>
                <Text className="text-lg font-bold text-omda-black">Supprimer ce fichier ?</Text>
                <Text className="mt-2 text-base text-omda-black">
                  Vous devrez en ajouter un nouveau avant de continuer.
                </Text>

                <View className="mt-5 gap-3">
                  <Button
                    libelle="Annuler"
                    variante="secondary"
                    onPress={() => setConfirmationSuppression(false)}
                  />
                  <Button
                    libelle="Supprimer le fichier"
                    variante="destructive"
                    icone="trash"
                    onPress={confirmerSuppression}
                  />
                </View>
              </View>
            ) : (
              <View>
                <Text className="text-lg font-bold text-omda-black">
                  {`Gérer « ${libelle} »`}
                </Text>
                <Text className="mt-1 text-sm text-omda-textGray">
                  {nomFichier ?? 'Fichier enregistré dans votre dossier.'}
                </Text>

                <View className="mt-5 gap-3">
                  {onRemplacer ? (
                    <Button
                      libelle="Remplacer le fichier"
                      icone="arrows-rotate"
                      onPress={lancerRemplacement}
                    />
                  ) : null}

                  {onSupprimer ? (
                    <Button
                      libelle="Supprimer le fichier"
                      variante="destructive"
                      icone="trash"
                      onPress={() => setConfirmationSuppression(true)}
                    />
                  ) : null}

                  <Button libelle="Annuler" variante="secondary" onPress={fermerMenu} />
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
