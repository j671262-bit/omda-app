import type { HorodatageISO, UUID } from './common';
import type { TypeNotification } from './enums';

/**
 * Notification destinée à un utilisateur, à un candidat, ou globale
 * — table `notification`.
 * Contrainte : `globale = TRUE` OU un destinataire renseigné.
 */
export type Notification = {
  id: UUID;
  utilisateur_id: UUID | null;
  candidat_id: UUID | null;
  type: TypeNotification;
  titre: string;
  message: string;
  lue: boolean;
  globale: boolean;
  metadata: Record<string, unknown> | null;
  date_envoi: HorodatageISO;
};

/**
 * Jeton de réinitialisation de mot de passe — table `jeton_reinitialisation`.
 * ⚠️ Seul le hachage est stocké : le jeton en clair circule uniquement par e-mail.
 */
export type JetonReinitialisation = {
  id: UUID;
  utilisateur_id: UUID;
  jeton_hash: string;
  expire_at: HorodatageISO;
  utilise_at: HorodatageISO | null;
  created_at: HorodatageISO;
};
