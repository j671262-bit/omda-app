import { Text, View } from 'react-native';

import { Icone, type NomIcone } from './Icone';

export type StatutEtape = 'fait' | 'enCours' | 'aVenir' | 'rejete';

export type EtapeTimeline = {
  titre: string;
  description?: string;
  statut: StatutEtape;
};

type DescriptionEtape = {
  icone: NomIcone;
  couleur: string;
  trait: string;
  libelle: string;
};

const ETAPES: Record<StatutEtape, DescriptionEtape> = {
  fait: {
    icone: 'circle-check',
    couleur: 'text-status-success',
    trait: 'bg-status-success',
    libelle: 'Étape terminée',
  },
  enCours: {
    icone: 'clock',
    couleur: 'text-status-pending',
    trait: 'bg-omda-borderGray',
    libelle: 'Étape en cours',
  },
  aVenir: {
    icone: 'circle',
    couleur: 'text-omda-borderGray',
    trait: 'bg-omda-borderGray',
    libelle: 'Étape à venir',
  },
  rejete: {
    icone: 'circle-xmark',
    couleur: 'text-status-error',
    trait: 'bg-status-error',
    libelle: 'Étape rejetée',
  },
};

type PropsStepTimeline = {
  etapes: EtapeTimeline[];
};

/**
 * Frise des étapes d'un dossier / d'une œuvre.
 * Les statuts affichés proviennent du serveur : le vert (`status-success`)
 * signifie donc « étape validée côté serveur », et non une simple décoration.
 * Chaque étape comporte un libellé texte : l'icône n'est jamais seule.
 */
export function StepTimeline({ etapes }: PropsStepTimeline) {
  return (
    <View className="w-full">
      {etapes.map((etape, index) => {
        const style = ETAPES[etape.statut];
        const derniere = index === etapes.length - 1;

        return (
          <View key={etape.titre} className="flex-row">
            <View className="items-center">
              <Icone nom={style.icone} taille={18} classeCouleur={style.couleur} />
              {!derniere ? <View className={`w-0.5 flex-1 ${style.trait}`} /> : null}
            </View>

            <View className={`ml-3 flex-1 ${derniere ? '' : 'pb-6'}`}>
              <Text className="text-base font-semibold text-omda-black">{etape.titre}</Text>
              {etape.description ? (
                <Text className="mt-1 text-sm text-omda-textGray">{etape.description}</Text>
              ) : null}
              <Text className={`mt-1 text-xs font-semibold ${style.couleur}`}>{style.libelle}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
