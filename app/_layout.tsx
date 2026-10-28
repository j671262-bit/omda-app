import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import '../global.css';
import { AuthProvider } from '../src/context/AuthContext';

// Empêche la disparition automatique du splash : il reste visible jusqu'au
// premier layout de l'application (voir useEffect ci-dessous), ce qui évite
// tout écran blanc entre le splash natif et le premier rendu React.
// `.catch` : si le splash est déjà masqué (reload à chaud), on ignore sans planter.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  useEffect(() => {
    // Masque le splash APRÈS le montage du premier écran : jamais d'écran vide.
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}

