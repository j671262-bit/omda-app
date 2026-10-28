import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { Icone } from './Icone';

export type OptionSelect = {
  valeur: string;
  libelle: string;
  description?: string;
};

type PropsSelectField = {
  libelle: string;
  options: OptionSelect[];
  valeur: string | null;
  onChangeValeur: (valeur: string) => void;
  placeholder?: string;
  aide?: string;
  erreur?: string;
  obligatoire?: boolean;
  desactive?: boolean;
  /** Message affiché lorsque la liste reçue du serveur est vide. */
  libelleAucuneOption?: string;
};

/**
 * Champ de sélection (liste de choix reçue d'un service).
 *
 * Implémenté avec `Modal` + `Pressable` pour éviter toute dépendance
 * supplémentaire et garantir des lignes de 48 px minimum (usage mobile modeste).
 * La liste vide est un état explicite : aucun choix n'est jamais codé en dur.
 */
export function SelectField({
  libelle,
  options,
  valeur,
  onChangeValeur,
  placeholder = 'Sélectionnez une option',
  aide,
  erreur,
  obligatoire = false,
  desactive = false,
  libelleAucuneOption = 'Aucune option disponible pour le moment.',
}: PropsSelectField) {
  const [ouvert, setOuvert] = useState(false);
  const enErreur = Boolean(erreur);
  const vide = options.length === 0;
  const inactif = desactive || vide;
  const selection = options.find((option) => option.valeur === valeur) ?? null;

  const classeBordure = enErreur ? 'border-status-error' : ouvert ? 'border-omda-green' : 'border-omda-borderGray';

  return (
    <View className="w-full">
      <Text className="mb-1 text-base font-semibold text-omda-black">
        {libelle}
        {obligatoire ? ' *' : ''}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${libelle}${selection ? ` : ${selection.libelle}` : ''}`}
        accessibilityHint={aide}
        accessibilityState={{ disabled: inactif, expanded: ouvert }}
        disabled={inactif}
        onPress={() => setOuvert(true)}
        className="w-full"
      >
        {({ pressed }) => (
          <View
            className={`min-h-12 w-full flex-row items-center rounded-xl border px-4 py-3 ${classeBordure} ${
              inactif ? 'bg-omda-warmGray' : pressed ? 'bg-omda-warmGray' : 'bg-omda-white'
            }`}
          >
            <Text className={`flex-1 text-base ${selection ? 'text-omda-black' : 'text-omda-textGray'}`}>
              {vide ? libelleAucuneOption : (selection?.libelle ?? placeholder)}
            </Text>
            <Icone nom="chevron-down" taille={16} classeCouleur="text-omda-textGray" />
          </View>
        )}
      </Pressable>

      {aide && !enErreur ? <Text className="mt-1 text-sm text-omda-textGray">{aide}</Text> : null}

      {enErreur ? (
        <View className="mt-1 flex-row items-start">
          <Icone nom="circle-xmark" taille={14} classeCouleur="text-status-error" />
          <Text className="ml-2 flex-1 text-sm text-status-error">{erreur}</Text>
        </View>
      ) : null}

      <Modal visible={ouvert} transparent animationType="slide" onRequestClose={() => setOuvert(false)}>
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer la liste"
            onPress={() => setOuvert(false)}
            className="absolute inset-0 bg-omda-black opacity-60"
          />

          <View className="max-h-[80%] rounded-t-2xl bg-omda-white px-5 pb-6 pt-4">
            <Text className="text-lg font-bold text-omda-black">{libelle}</Text>

            <ScrollView className="mt-2">
              {vide ? (
                <Text className="py-4 text-base text-omda-textGray">{libelleAucuneOption}</Text>
              ) : (
                options.map((option) => {
                  const selectionnee = option.valeur === valeur;
                  return (
                    <Pressable
                      key={option.valeur}
                      accessibilityRole="button"
                      accessibilityLabel={option.libelle}
                      accessibilityState={{ selected: selectionnee }}
                      onPress={() => {
                        onChangeValeur(option.valeur);
                        setOuvert(false);
                      }}
                      className="w-full"
                    >
                      {({ pressed }) => (
                        <View
                          className={`min-h-12 flex-row items-center border-b border-omda-borderGray py-3 ${
                            selectionnee || pressed ? 'bg-omda-warmGray' : ''
                          }`}
                        >
                          <View className="flex-1">
                            <Text className={`text-base text-omda-black ${selectionnee ? 'font-semibold' : ''}`}>
                              {option.libelle}
                            </Text>
                            {option.description ? (
                              <Text className="text-sm text-omda-textGray">{option.description}</Text>
                            ) : null}
                          </View>
                          {selectionnee ? <Icone nom="check" taille={16} classeCouleur="text-omda-black" /> : null}
                        </View>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <View className="mt-4">
              <Button libelle="Fermer" variante="secondary" pleineLargeur onPress={() => setOuvert(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
