const APP_LOCALE = 'ro-RO';
const APP_TIMEZONE = 'Europe/Bucharest';

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

function normalizeDate(value) {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

export function formatDate(value, { fallback = '—' } = {}) {
  const dateValue = normalizeDate(value);
  if (!dateValue) return fallback;
  return dateFormatter.format(dateValue);
}

export function formatDateTime(value, { fallback = '—' } = {}) {
  const dateValue = normalizeDate(value);
  if (!dateValue) return fallback;
  return dateTimeFormatter.format(dateValue);
}

export const DATE_TIME_TIMEZONE = APP_TIMEZONE;
