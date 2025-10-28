import { appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { inspect } from "util";

const LOG_DIRECTORY = path.join(process.cwd(), "logs");
const ERROR_LOG_FILE = path.join(LOG_DIRECTORY, "error.log");

async function ensureLogDirectory() {
  if (!existsSync(LOG_DIRECTORY)) {
    await mkdir(LOG_DIRECTORY, { recursive: true });
  }
}

function serializeDetails(details: unknown): string {
  if (details instanceof Error) {
    return details.stack ?? details.message;
  }

  return inspect(details, { depth: null });
}

export async function logError(message: string, details?: unknown) {
  try {
    await ensureLogDirectory();

    const entry = {
      timestamp: new Date().toISOString(),
      message,
      ...(details !== undefined ? { details: serializeDetails(details) } : {})
    };

    await appendFile(ERROR_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (loggingError) {
    console.error("Nu s-a putut scrie în fișierul de log al erorilor.", loggingError);
  }
}

export const errorLogPath = ERROR_LOG_FILE;
