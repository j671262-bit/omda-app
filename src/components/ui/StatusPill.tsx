import { Text, View } from 'react-native';

import { Icone, type NomIcone } from './Icone';

/** Statuts visuels autorisés (cahier des charges §6). */
export type StatutPill = 'success' | 'pending' | 'error' | 'info';

type StyleStatut = {
  bordure: string;
  texte: string;
  icone: NomIcone;
};

const STYLES: Record<StatutPill, StyleStatut> = {
  success: { bordure: 'border-status-success', texte: 'text-status-success', icone: 'circle-check' },
  pending: { bordure: 'border-status-pending', texte: 'text-status-pending', icone: 'clock' },
  error: { bordure: 'border-status-error', texte: 'text-status-error', icone: 'circle-xmark' },
  info: { bordure: 'border-status-info', texte: 'text-status-info', icone: 'circle-info' },
};

type PropsStatusPill = {
  statut: StatutPill;
  libelle: string;
  /** Icône imposée ; sinon l'icône standard du statut est utilisée. */
  icone?: NomIcone;
};

/**
 * Pastille de statut : icône + libellé texte (jamais une icône seule).
 *
 * ⚠️ `success` (vert) ne doit être affiché QUE pour un succès confirmé par le
 * serveur (ex. `paiement.statut = REUSSI`).
 */
export function StatusPill({ statut, libelle, icone }: PropsStatusPill) {
  const style = STYLES[statut];

  return (
    <View
      className={`flex-row items-center self-start rounded-full border bg-omda-white px-3 py-1 ${style.bordure}`}
      accessibilityLabel={libelle}
    >
      <Icone nom={icone ?? style.icone} taille={14} classeCouleur={style.texte} />
      <Text className={`ml-2 text-sm font-semibold ${style.texte}`}>{libelle}</Text>
    </View>
  );
}
