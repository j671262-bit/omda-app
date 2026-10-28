import { Text, View } from 'react-native';

import { Button } from './Button';
import { Icone, type NomIcone } from './Icone';

type PropsEmptyState = {
  titre: string;
  message?: string;
  icone?: NomIcone;
  actionLibelle?: string;
  onAction?: () => void;
};

/**
 * État vide (« aucune donnée ») : toujours un titre + un message explicite,
 * et une action facultative pour sortir de l'état vide.
 * Aucune couleur hex : icône en `omda-textGray`.
 */
export function EmptyState({
  titre,
  message,
  icone = 'folder-open',
  actionLibelle,
  onAction,
}: PropsEmptyState) {
  return (
    <View className="w-full items-center justify-center bg-omda-warmGray px-6 py-10">
      <Icone nom={icone} taille={36} classeCouleur="text-omda-textGray" />

      <Text className="mt-4 text-center text-lg font-semibold text-omda-black">{titre}</Text>

      {message ? <Text className="mt-2 text-center text-base text-omda-textGray">{message}</Text> : null}

      {actionLibelle && onAction ? (
        <View className="mt-5">
          <Button libelle={actionLibelle} variante="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
