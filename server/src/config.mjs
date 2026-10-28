const bool = (value) => value === 'true';

function urlHttpsReelle(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.hostname.endsWith('.example') && parsed.hostname !== 'example.com';
  } catch {
    return false;
  }
}

/** Entier strictement positif lu dans l'environnement, ou `undefined` si absent. */
function entierPositif(env, nom) {
  if (env[nom] === undefined || env[nom] === '') return undefined;
  const valeur = Number.parseInt(env[nom], 10);
  if (!Number.isInteger(valeur) || valeur < 1) throw new Error(`${nom} doit être un entier strictement positif.`);
  return valeur;
}

export function readConfig(env = process.env) {
  const port = Number.parseInt(env.PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT doit être un entier compris entre 1 et 65535.');
  }

  const allowedOrigins = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const trustProxyHops = Number.parseInt(env.TRUST_PROXY_HOPS ?? '0', 10);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error('TRUST_PROXY_HOPS doit être un entier compris entre 0 et 5.');
  }

  return Object.freeze({
    host: env.HOST ?? '127.0.0.1',
    port,
    nodeEnv: env.NODE_ENV ?? 'development',
    supabaseUrl: env.SUPABASE_URL ?? '',
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    trackingCodePepper: env.TRACKING_CODE_PEPPER ?? '',
    mvolaEnabled: bool(env.MVOLA_ENABLED),
    mvolaBaseUrl: env.MVOLA_BASE_URL ?? '',
    mvolaClientId: env.MVOLA_CLIENT_ID ?? '',
    mvolaClientSecret: env.MVOLA_CLIENT_SECRET ?? '',
    mvolaCallbackSecret: env.MVOLA_CALLBACK_SECRET ?? '',
    allowedOrigins,
    trustProxyHops,
    // Limites de débit réglables (utile en phase de test) ; les valeurs absentes gardent le défaut du serveur.
    limites: Object.freeze(Object.fromEntries(Object.entries({
      creationsParHeure: entierPositif(env, 'LIMITE_CREATIONS_PAR_HEURE'),
      requetesCodeParDix_min: entierPositif(env, 'LIMITE_REQUETES_PAR_10_MIN'),
      echecsCodeParHeure: entierPositif(env, 'LIMITE_ECHECS_CODE_PAR_HEURE'),
      televersementsParHeure: entierPositif(env, 'LIMITE_TELEVERSEMENTS_PAR_HEURE'),
    }).filter(([, v]) => v !== undefined))),
    maxBodyBytes: 1024 * 1024,
  });
}

/** Configuration-only check. This does not mean the MVola adapter is implemented or enabled. */
export function paymentIntegrationReady(config) {
  return Boolean(
    config.supabaseUrl && urlHttpsReelle(config.supabaseUrl) && config.supabaseServiceRoleKey &&
    config.mvolaEnabled && urlHttpsReelle(config.mvolaBaseUrl) &&
    config.mvolaClientId && config.mvolaClientSecret && config.mvolaCallbackSecret,
  );
}
