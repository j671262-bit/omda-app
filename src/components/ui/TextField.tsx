import { useState } from 'react';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Icone } from './Icone';

type PropsTextField = {
  libelle: string;
  valeur: string;
  onChangeValeur: (valeur: string) => void;
  placeholder?: string;
  /** Texte d'aide affiché sous le champ (masqué si une erreur est présente). */
  aide?: string;
  /** Message d'erreur : passe la bordure et le texte en `status-error`. */
  erreur?: string;
  obligatoire?: boolean;
  desactive?: boolean;
  multiligne?: boolean;
  securise?: boolean;
  clavier?: KeyboardTypeOptions;
  maxCaracteres?: number;
  onBlurChamp?: () => void;
};

/**
 * Champ de saisie avec libellé, aide et erreur.
 * Zone tactile de 48 px minimum (`min-h-12`), focus visible (bordure verte).
 */
export function TextField({
  libelle,
  valeur,
  onChangeValeur,
  placeholder,
  aide,
  erreur,
  obligatoire = false,
  desactive = false,
  multiligne = false,
  securise = false,
  clavier,
  maxCaracteres,
  onBlurChamp,
}: PropsTextField) {
  const [focus, setFocus] = useState(false);
  const enErreur = Boolean(erreur);

  const classeBordure = enErreur
    ? 'border-status-error'
    : focus
      ? 'border-omda-green'
      : 'border-omda-borderGray';

  return (
    <View className="w-full">
      <Text className="mb-1 text-base font-semibold text-omda-black">
        {libelle}
        {obligatoire ? ' *' : ''}
      </Text>

      <TextInput
        value={valeur}
        onChangeText={onChangeValeur}
        editable={!desactive}
        multiline={multiligne}
        secureTextEntry={securise}
        keyboardType={clavier}
        maxLength={maxCaracteres}
        placeholder={placeholder}
        placeholderClassName="text-omda-textGray"
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          onBlurChamp?.();
        }}
        accessibilityLabel={libelle}
        accessibilityHint={enErreur ? erreur : aide}
        accessibilityState={{ disabled: desactive }}
        className={`min-h-12 w-full rounded-xl border bg-omda-white px-4 py-3 text-base text-omda-black ${classeBordure} ${
          multiligne ? 'min-h-28' : ''
        } ${desactive ? 'bg-omda-warmGray text-omda-textGray' : ''}`}
      />

      {aide && !enErreur ? <Text className="mt-1 text-sm text-omda-textGray">{aide}</Text> : null}

      {enErreur ? (
        <View className="mt-1 flex-row items-start">
          <Icone nom="circle-xmark" taille={14} classeCouleur="text-status-error" />
          <Text className="ml-2 flex-1 text-sm text-status-error">{erreur}</Text>
        </View>
      ) : null}
    </View>
  );
}
