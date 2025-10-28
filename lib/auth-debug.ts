const AUTH_DEBUG_ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);
const MAX_BUFFERED_EVENTS = 50;

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env?.[name];
}

function isDebugEnabled(): boolean {
  const flag = readEnv("AUTH_DEBUG")?.toLowerCase();
  return flag !== undefined && AUTH_DEBUG_ENABLED_VALUES.has(flag);
}

export function isAuthDebugEnabled(): boolean {
  return isDebugEnabled();
}

type AuthDebugEntry = {
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __AUTH_DEBUG_EVENTS__: AuthDebugEntry[] | undefined;
}

function getEventBuffer(): AuthDebugEntry[] {
  if (!globalThis.__AUTH_DEBUG_EVENTS__) {
    globalThis.__AUTH_DEBUG_EVENTS__ = [];
  }

  return globalThis.__AUTH_DEBUG_EVENTS__;
}

function pushEvent(entry: AuthDebugEntry) {
  const buffer = getEventBuffer();
  buffer.push(entry);

  if (buffer.length > MAX_BUFFERED_EVENTS) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
  }
}

function maskSecret(secret: string | undefined): string | undefined {
  if (!secret) {
    return undefined;
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}…${secret.slice(-2)}`;
  }

  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function authDebugLog(message: string, context?: Record<string, unknown>) {
  if (!isDebugEnabled()) {
    return;
  }

  const entry: AuthDebugEntry = {
    timestamp: new Date().toISOString(),
    message,
    ...(context ? { context } : {}),
  };

  pushEvent(entry);

  if (typeof console !== "undefined") {
    console.info("[auth-debug]", entry);
  }
}

export function summarizeAuthConfiguration() {
  const secret = readEnv("AUTH_SECRET") ?? readEnv("NEXTAUTH_SECRET");
  const salt = readEnv("AUTH_SALT") ?? readEnv("NEXTAUTH_SALT");

  return {
    authSecretPresent: Boolean(secret),
    authSaltPresent: Boolean(salt),
    authSecretPreview: maskSecret(secret),
    authSaltPreview: maskSecret(salt),
    authDebugEnabled: isDebugEnabled(),
  };
}

export function summarizeToken(token: unknown) {
  if (!token || typeof token !== "object") {
    return token;
  }

  const { role, email, name, exp, iat, ...rest } = token as Record<string, unknown>;

  return {
    ...(role !== undefined ? { role } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(exp !== undefined ? { exp } : {}),
    ...(iat !== undefined ? { iat } : {}),
    ...(Object.keys(rest).length > 0 ? { rest } : {}),
  };
}

export function getAuthDebugEvents(): AuthDebugEntry[] {
  return [...getEventBuffer()];
}
