/**
 * Structured logger — replaces raw console.log/warn/error.
 *
 * Production: JSON lines for aggregation.
 * Development: human-readable console output.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "info" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatEntry(entry: LogEntry): string {
  if (process.env.NODE_ENV === "production") {
    return JSON.stringify({ ...entry, ts: new Date().toISOString() });
  }
  const { level, msg, ...rest } = entry;
  const prefix = `[${level.toUpperCase()}]`;
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `${prefix} ${msg}${extra}`;
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = { level, msg, ...meta };
  const formatted = formatEntry(entry);

  switch (level) {
    case "error":
      console.error(formatted); // eslint-disable-line no-console
      break;
    case "warn":
      console.warn(formatted); // eslint-disable-line no-console
      break;
    default:
      console.log(formatted); // eslint-disable-line no-console
      break;
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) =>
    log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) =>
    log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) =>
    log("error", msg, meta),
};
