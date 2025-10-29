import pool from '../config/db.js';

export const SECURITY_OPTIONS = [
  {
    key: 'csp',
    label: 'Content Security Policy (CSP)',
    description: 'Controleaza sursele acceptate pentru scripturi, stiluri si imagini pentru a preveni atacurile XSS.',
    defaultEnabled: true
  },
  {
    key: 'enforce_https',
    label: 'Redirectionare HTTPS',
    description: 'Forteaza redirectionarea traficului HTTP catre HTTPS atunci cand aplicatia ruleaza in spatele unui proxy.',
    defaultEnabled: true
  },
  {
    key: 'debug_mode',
    label: 'Mod debug',
    description: 'Afiseaza mesaje de eroare detaliate si stack trace-uri pentru depanare rapida.',
    defaultEnabled: false
  }
];

export async function listSecuritySettings() {
  try {
    const [rows] = await pool.query('SELECT `key`, is_enabled FROM security_settings');
    const settingsMap = new Map(rows.map((row) => [row.key, row.is_enabled === 1]));

    return SECURITY_OPTIONS.map((option) => ({
      ...option,
      isEnabled: settingsMap.has(option.key) ? settingsMap.get(option.key) : option.defaultEnabled
    }));
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return SECURITY_OPTIONS.map((option) => ({ ...option, isEnabled: option.defaultEnabled }));
    }
    throw error;
  }
}

export async function updateSecuritySetting(key, isEnabled) {
  const option = SECURITY_OPTIONS.find((item) => item.key === key);
  if (!option) {
    const error = new Error('UNKNOWN_SECURITY_SETTING');
    error.status = 400;
    throw error;
  }
  await pool.query(
    `INSERT INTO security_settings (\`key\`, is_enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
    [key, isEnabled ? 1 : 0]
  );
}
