import { listSecuritySettings, SECURITY_OPTIONS } from '../services/securityService.js';

let securityState = SECURITY_OPTIONS.reduce((acc, option) => {
  acc[option.key] = option.defaultEnabled;
  return acc;
}, {});

function normalize(settings) {
  const map = {};
  settings.forEach((setting) => {
    map[setting.key] = setting.isEnabled;
  });
  return SECURITY_OPTIONS.reduce((acc, option) => {
    acc[option.key] = map[option.key] ?? option.defaultEnabled;
    return acc;
  }, {});
}

export async function initializeSecurityState() {
  const settings = await listSecuritySettings();
  securityState = normalize(settings);
  return securityState;
}

export function getSecurityState() {
  return securityState;
}

export async function refreshSecurityState() {
  const settings = await listSecuritySettings();
  securityState = normalize(settings);
  return securityState;
}
