import { Text, View } from 'react-native';

import { Button, type VarianteBouton } from './Button';
import { Icone, type NomIcone } from './Icone';

export type VarianteBanner = 'info' | 'pending' | 'success' | 'error';

type StyleBanner = {
  bordure: string;
  couleur: string;
  icone: NomIcone;
};

const STYLES: Record<VarianteBanner, StyleBanner> = {
  info: { bordure: 'border-status-info', couleur: 'text-status-info', icone: 'circle-info' },
  pending: { bordure: 'border-status-pending', couleur: 'text-status-pending', icone: 'clock' },
  success: { bordure: 'border-status-success', couleur: 'text-status-success', icone: 'circle-check' },
  error: { bordure: 'border-status-error', couleur: 'text-status-error', icone: 'circle-xmark' },
};

type PropsInfoBanner = {
  variante: VarianteBanner;
  message: string;
  titre?: string;
  icone?: NomIcone;
  actionLibelle?: string;
  onAction?: () => void;
  varianteAction?: VarianteBouton;
};

/**
 * Bandeau d'information / d'alerte.
 *
 * ⚠️ La variante `success` (vert) est réservée à une information confirmée par
 * le serveur (ex. « Paiement confirmé »).
 */
export function InfoBanner({
  variante,
  message,
  titre,
  icone,
  actionLibelle,
  onAction,
  varianteAction = 'secondary',
}: PropsInfoBanner) {
  const style = STYLES[variante];

  return (
    <View className={`w-full rounded-xl border bg-omda-white p-4 ${style.bordure}`}>
      <View className="flex-row items-start">
        <Icone nom={icone ?? style.icone} taille={18} classeCouleur={style.couleur} />
        <View className="ml-3 flex-1">
          {titre ? <Text className={`text-base font-semibold ${style.couleur}`}>{titre}</Text> : null}
          <Text className={`text-base text-omda-black ${titre ? 'mt-1' : ''}`}>{message}</Text>
        </View>
      </View>

      {actionLibelle && onAction ? (
        <View className="mt-3">
          <Button libelle={actionLibelle} variante={varianteAction} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
