const { paletteOmda, couleursStatut } = require('./src/theme/colors.ts');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Palette officielle OMDA — tokens `omda-*` (cahier des charges §5)
        omda: paletteOmda,
        // Tokens sémantiques de statut — `status-*` (cahier des charges §6)
        status: couleursStatut,
      },
    },
  },
  plugins: [],
};
