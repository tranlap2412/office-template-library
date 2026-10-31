import "dotenv/config";
import { createApp, createContext } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, waitForDatabase } from "./db.js";
import { createLogger } from "./lib/logger.js";

const config = loadConfig();
const logger = createLogger(config.env);
const db = createDb(config.databaseUrl);

try {
  await waitForDatabase(db, config.dbStartupRetries, logger);
  const ctx = await createContext(config, db, logger);

  // Đồng bộ kho template vào CSDL mỗi lần khởi động (idempotent).
  const sync = await ctx.catalog.sync();
  for (const error of sync.errors) logger.warn({ error }, "Template catalog");

  const server = createApp(ctx).listen(config.port, () =>
    logger.info({ port: config.port, onlyOffice: config.onlyOffice.enabled }, "API listening"),
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close(() => void db.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} catch (err) {
  logger.fatal({ err }, "Failed to start");
  await db.$disconnect();
  process.exit(1);
}
