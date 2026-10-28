import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import type { ComponentProps } from 'react';
import { Text } from 'react-native';

/** Noms d'icônes valides du pack FontAwesome 6 (`@expo/vector-icons`). */
export type NomIcone = ComponentProps<typeof FontAwesome6>['name'];

type PropsIcone = {
  nom: NomIcone;
  /** Taille en points (défaut 20). */
  taille?: number;
  /** Token NativeWind de couleur, ex. `text-status-success` ou `text-omda-textGray`. */
  classeCouleur?: string;
  /** Libellé lu par les lecteurs d'écran ; à ne fournir que si l'icône porte seule l'information. */
  libelleAccessibilite?: string;
};

/**
 * Icône FontAwesome normalisée.
 *
 * Les icônes n'acceptent pas `className` : la couleur est appliquée au `<Text>`
 * parent et héritée par l'icône. Aucune couleur hex n'est utilisée ici.
 */
export function Icone({
  nom,
  taille = 20,
  classeCouleur = 'text-omda-black',
  libelleAccessibilite,
}: PropsIcone) {
  const decorative = libelleAccessibilite === undefined;

  return (
    <Text
      className={classeCouleur}
      accessibilityLabel={libelleAccessibilite}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
    >
      <FontAwesome6 name={nom} size={taille} />
    </Text>
  );
}
