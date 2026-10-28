import { Stack } from 'expo-router';

import { AdhesionDraftProvider } from '../../src/context/AdhesionDraftContext';

/**
 * Layout du groupe de parcours d'adhésion `(adhesion)`.
 *
 * Sans menu (navigation linéaire via Stack).
 * Fournit le store persistant `AdhesionDraftProvider` à toutes les étapes
 * du parcours (identité, catégorie, documents/œuvres, récapitulatif, confirmation).
 */
export default function AdhesionLayout() {
  return (
    <AdhesionDraftProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AdhesionDraftProvider>
  );
}

