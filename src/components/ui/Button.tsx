import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { Icone, type NomIcone } from './Icone';

export type VarianteBouton = 'primary' | 'secondary' | 'destructive';

type StyleVariante = {
  normal: string;
  presse: string;
  desactive: string;
  texte: string;
  texteDesactive: string;
  indicateur: string;
};

const STYLES: Record<VarianteBouton, StyleVariante> = {
  primary: {
    normal: 'border-omda-green bg-omda-green',
    presse: 'border-omda-greenDark bg-omda-greenDark',
    desactive: 'border-omda-borderGray bg-omda-borderGray',
    texte: 'text-omda-white',
    texteDesactive: 'text-omda-textGray',
    indicateur: colors.omda.white,
  },
  secondary: {
    normal: 'border-omda-green bg-omda-white',
    presse: 'border-omda-greenDark bg-omda-warmGray',
    desactive: 'border-omda-borderGray bg-omda-white',
    texte: 'text-omda-green',
    texteDesactive: 'text-omda-textGray',
    indicateur: colors.omda.green,
  },
  destructive: {
    normal: 'border-omda-errorRed bg-omda-errorRed',
    presse: 'border-omda-errorRed bg-omda-errorRed opacity-80',
    desactive: 'border-omda-borderGray bg-omda-borderGray',
    texte: 'text-omda-white',
    texteDesactive: 'text-omda-textGray',
    indicateur: colors.omda.white,
  },
};

type PropsBouton = {
  libelle: string;
  onPress?: () => void;
  variante?: VarianteBouton;
  desactive?: boolean;
  chargement?: boolean;
  pleineLargeur?: boolean;
  icone?: NomIcone;
};

/**
 * Bouton principal du design system.
 * - Zone tactile de 48 px minimum (`min-h-12`).
 * - États `pressed` / `disabled` gérés par `Pressable` (aucun `hover:`).
 * - Aucune couleur hex : uniquement des tokens `omda-*` / `status-*`.
 *
 * ⚠️ La variante `primary` est verte (couleur de marque) : ne pas l'utiliser
 * pour annoncer un paiement réussi. Le succès (`status-success`) est réservé à
 * la confirmation serveur.
 */
export function Button({
  libelle,
  onPress,
  variante = 'primary',
  desactive = false,
  chargement = false,
  pleineLargeur = false,
  icone,
}: PropsBouton) {
  const style = STYLES[variante];
  const inactif = desactive || chargement;
  const classeTexte = inactif ? style.texteDesactive : style.texte;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: inactif, busy: chargement }}
      disabled={inactif}
      onPress={onPress}
      className={pleineLargeur ? 'w-full' : 'self-start'}
    >
      {({ pressed }) => (
        <View
          className={`min-h-12 flex-row items-center justify-center rounded-xl border px-5 py-3 ${
            pleineLargeur ? 'w-full' : ''
          } ${inactif ? style.desactive : pressed ? style.presse : style.normal}`}
        >
          {chargement ? <ActivityIndicator color={style.indicateur} /> : null}
          {!chargement && icone ? <Icone nom={icone} taille={18} classeCouleur={classeTexte} /> : null}
          <Text className={`text-base font-semibold ${classeTexte} ${chargement || icone ? 'ml-2' : ''}`}>
            {libelle}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
