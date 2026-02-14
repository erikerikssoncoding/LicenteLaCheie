import path from 'path';
import { promises as fs } from 'fs';
import { customAlphabet } from 'nanoid';

const FILE_TOKEN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const generateFileToken = customAlphabet(FILE_TOKEN_ALPHABET, 12);

export const PROJECT_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'projects');
export const OFFER_ATTACHMENT_ROOT = path.resolve(process.cwd(), 'uploads', 'offer-attachments');
export const CONTACT_ATTACHMENT_ROOT = path.resolve(process.cwd(), 'uploads', 'contact-attachments');

const SAFE_DOWNLOAD_NAME_MAX_LENGTH = 150;

export function sanitizeFileNamePart(value) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function getProjectStoragePath(projectId) {
  return path.join(PROJECT_UPLOAD_ROOT, String(projectId));
}

export async function ensureProjectStoragePath(projectId) {
  const projectPath = getProjectStoragePath(projectId);
  await fs.mkdir(projectPath, { recursive: true });
  return projectPath;
}

export function buildStoredFileName(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, ext);
  const sanitizedBase = sanitizeFileNamePart(base) || 'fisier';
  const token = generateFileToken();
  return `${sanitizedBase}-${token}${ext}`;
}

function resolveSafePath(basePath, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return null;
  }
  const candidate = path.normalize(relativePath);
  if (candidate.includes('..') || path.isAbsolute(candidate)) {
    return null;
  }

  const base = path.resolve(basePath);
  const resolved = path.resolve(basePath, candidate);
  if (!resolved.startsWith(`${base}${path.sep}`)) {
    return null;
  }

  return resolved;
}

export function sanitizeDownloadFilename(fileName) {
  const raw = typeof fileName === 'string' ? fileName : '';
  const normalized = path
    .basename(raw)
    .replace(/[\r\n\0-\x1f\x7f]/g, '_')
    .replace(/[<>:"/\\|?*]/g, '_');
  return normalized || `fisier-${Date.now()}`;
}

export function getSafeDownloadName(fileName, fallback = 'fisier') {
  const safeName = sanitizeDownloadFilename(fileName);
  return safeName.slice(0, SAFE_DOWNLOAD_NAME_MAX_LENGTH) || fallback;
}

export async function removeStoredFile(relativePath) {
  if (!relativePath) {
    return;
  }
  const absolutePath = resolveSafePath(PROJECT_UPLOAD_ROOT, relativePath);
  if (!absolutePath) {
    return;
  }
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export function getPublicFilePath(projectId, storedName) {
  return path.join(String(projectId), storedName);
}

export async function fileExists(relativePath) {
  const absolutePath = resolveSafePath(PROJECT_UPLOAD_ROOT, relativePath);
  if (!absolutePath) {
    return false;
  }
  try {
    await fs.access(absolutePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function resolveStoredFilePath(relativePath) {
  return resolveSafePath(PROJECT_UPLOAD_ROOT, relativePath);
}

export function resolveTicketAttachmentPath(fileName) {
  return resolveSafePath(OFFER_ATTACHMENT_ROOT, fileName);
}
