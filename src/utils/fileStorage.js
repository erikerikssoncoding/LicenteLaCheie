import path from 'path';
import { promises as fs } from 'fs';
import { customAlphabet } from 'nanoid';

const FILE_TOKEN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const generateFileToken = customAlphabet(FILE_TOKEN_ALPHABET, 12);

export const PROJECT_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'projects');

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

export async function removeStoredFile(relativePath) {
  if (!relativePath) {
    return;
  }
  const absolutePath = path.resolve(PROJECT_UPLOAD_ROOT, relativePath);
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
  const absolutePath = path.resolve(PROJECT_UPLOAD_ROOT, relativePath);
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
  return path.resolve(PROJECT_UPLOAD_ROOT, relativePath);
}
