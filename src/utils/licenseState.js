import { getLicenseStatus, setLicensePaidUntil } from '../services/licenseService.js';

let licenseState = {
  paidUntil: null,
  paidUntilISO: null,
  paidUntilDisplay: null,
  isExpired: false
};

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function computeState(status) {
  const paidUntilDate = status.paidUntil ? new Date(status.paidUntil) : null;
  const today = startOfDay(new Date());
  const paidUntilComparable = paidUntilDate ? startOfDay(paidUntilDate) : null;
  const isExpired = !paidUntilComparable || paidUntilComparable < today;
  return {
    paidUntil: paidUntilDate,
    paidUntilISO: paidUntilDate ? formatDateISO(paidUntilDate) : null,
    paidUntilDisplay: paidUntilDate ? formatDateDisplay(paidUntilDate) : null,
    isExpired
  };
}

export async function initializeLicenseState() {
  const status = await getLicenseStatus();
  licenseState = computeState(status);
  return licenseState;
}

export function getLicenseState() {
  return licenseState;
}

export async function refreshLicenseState() {
  const status = await getLicenseStatus();
  licenseState = computeState(status);
  return licenseState;
}

export async function updateLicensePaidUntil(paidUntil) {
  await setLicensePaidUntil(paidUntil);
  return refreshLicenseState();
}
