import { Text, View } from 'react-native';

import { Icone, type NomIcone } from './Icone';

/**
 * Formate un montant en Ariary : `1500000` → `1 500 000 Ar`.
 * Formatage manuel (sans `Intl`) pour rester fiable sur les téléphones modestes.
 */
export function formaterMontantAriary(montant: number, devise = 'Ar'): string {
  const arrondi = Math.round(Math.abs(montant));
  const groupes = arrondi.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${groupes} ${devise}`;
}

type PropsAmountCard = {
  /** Objet du paiement, ex. « Frais d'adhésion » (fourni par le service). */
  objet: string;
  /** Montant en Ariary — TOUJOURS fourni par un service, jamais codé dans l'UI. */
  montant: number;
  /** Mention d'accompagnement (ex. « Estimation — le montant final est confirmé par le serveur. »). */
  mention?: string;
  icone?: NomIcone;
};

/**
 * Carte de montant (non modifiable par l'utilisateur).
 *
 * ⚠️ Le montant est affiché en noir : ne jamais le passer en `status-success`
 * tant que le serveur n'a pas confirmé le paiement.
 */
export function AmountCard({ objet, montant, mention, icone = 'money-bill-wave' }: PropsAmountCard) {
  const montantFormate = formaterMontantAriary(montant);

  return (
    <View className="w-full rounded-2xl border border-omda-borderGray bg-omda-white p-5">
      <View className="flex-row items-center">
        <Icone nom={icone} taille={18} classeCouleur="text-omda-textGray" />
        <Text className="ml-2 flex-1 text-base text-omda-textGray">{objet}</Text>
      </View>

      <Text
        className="mt-2 text-3xl font-bold text-omda-black"
        accessibilityLabel={`${objet} : ${montantFormate}`}
      >
        {montantFormate}
      </Text>

      {mention ? <Text className="mt-2 text-sm text-omda-textGray">{mention}</Text> : null}
    </View>
  );
}
