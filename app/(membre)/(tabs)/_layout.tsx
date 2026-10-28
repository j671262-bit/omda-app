import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { Tabs } from 'expo-router';

import { colors } from '../../../src/theme/colors';

/**
 * TabBar de l'espace membre (UNIQUE TabBar de l'application, conforme à la
 * contrainte de navigation : aucun menu côté public/candidat).
 * Icônes FontAwesome fonctionnelles, couleurs issues des tokens `src/theme`.
 */
export default function MembreTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.omda.green,
        tabBarInactiveTintColor: colors.omda.textGray,
        tabBarStyle: {
          backgroundColor: colors.omda.white,
          borderTopColor: colors.omda.borderGray,
        },
      }}
    >
      <Tabs.Screen
        name="accueil"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="house" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="oeuvres"
        options={{
          title: 'Œuvres',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="folder-open" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="id-card" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="bell" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
