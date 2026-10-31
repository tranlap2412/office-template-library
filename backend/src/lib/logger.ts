import { pino } from "pino";

export type Logger = pino.Logger;

export function createLogger(env: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? (env === "test" ? "silent" : "info"),
    redact: ["req.headers.authorization", 'req.headers["x-admin-key"]'],
  });
}
