/**
 * Tokens couleurs OMDA — usage JavaScript.
 *
 * Source unique de vérité : ce fichier est consommé par `tailwind.config.js`
 * (donc par les classes NativeWind `omda-*` / `status-*`) et peut être importé
 * depuis le code quand une couleur est exigée en JavaScript (props `color` de
 * FontAwesome, `StatusBar`, options de navigation, etc.).
 *
 * Règles projet :
 * - Dans les composants, utiliser EN PRIORITÉ les classes NativeWind
 *   (`bg-omda-warmGray`, `text-status-success`, …) et non ces valeurs brutes.
 * - Le vert `status-success` = succès confirmé par le serveur uniquement.
 */

/** Palette officielle OMDA (cahier des charges §5). */
export const paletteOmda = {
  green: '#2E7A46',
  greenDark: '#205C35',
  ochre: '#C79A3B',
  ochreDark: '#A87E2C',
  black: '#1A1A1A',
  white: '#FFFFFF',
  warmGray: '#F5F4EF',
  borderGray: '#DDD9CE',
  textGray: '#6B675E',
  errorRed: '#B3261E',
  infoBlueGray: '#2E4A66',
} as const;

/** Tokens sémantiques de statut (cahier des charges §6). */
export const couleursStatut = {
  success: paletteOmda.green,
  pending: paletteOmda.ochre,
  error: paletteOmda.errorRed,
  info: paletteOmda.infoBlueGray,
} as const;

/** Tous les tokens couleurs regroupés (miroir exact des tokens NativeWind). */
export const colors = {
  omda: paletteOmda,
  status: couleursStatut,
} as const;

export type PaletteOmda = typeof paletteOmda;
export type ClefPaletteOmda = keyof PaletteOmda;

export type CouleursStatut = typeof couleursStatut;
export type ClefCouleurStatut = keyof CouleursStatut;

export default colors;
