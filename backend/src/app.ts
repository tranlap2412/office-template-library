import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { TemplateCatalogService } from "./catalog/templateCatalogService.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import { OnlyOfficeService, type Fetcher } from "./editor/onlyOfficeService.js";
import { kindSchema, notFoundHandler, errorHandler, requireAdminKey } from "./middleware/http.js";
import type { Logger } from "./lib/logger.js";
import { PlaceholderEngine } from "./ooxml/placeholderEngine.js";
import { LibreOfficePreviewGenerator, type PreviewGenerator } from "./previews/previewGenerator.js";
import { documentsRouter } from "./routes/documents.js";
import { templatesRouter } from "./routes/templates.js";
import { DocumentService } from "./services/documentService.js";
import { TemplateQueryService } from "./services/templateQueryService.js";
import { LocalFileStorage, type FileStorage } from "./storage/fileStorage.js";

/** Composition root: mọi phụ thuộc được tạo ở đây và truyền vào router – dễ thay thế khi test. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  logger: Logger;
  storage: FileStorage;
  templates: TemplateQueryService;
  documents: DocumentService;
  catalog: TemplateCatalogService;
  editor: OnlyOfficeService;
  writeLimiter: RequestHandler;
}

export interface ContextOverrides {
  storage?: FileStorage;
  previews?: PreviewGenerator;
  editorFetcher?: Fetcher;
  writeLimitPerMinute?: number;
}

export async function createContext(config: AppConfig, db: Db, logger: Logger, overrides: ContextOverrides = {}): Promise<AppContext> {
  let storage = overrides.storage;
  if (!storage) {
    const local = new LocalFileStorage(config.storage);
    await local.init();
    storage = local;
  }
  const placeholders = new PlaceholderEngine();
  const previews = overrides.previews ?? new LibreOfficePreviewGenerator(config.previews, logger);
  const documents = new DocumentService(db, storage, placeholders, logger);

  return {
    config,
    db,
    logger,
    storage,
    templates: new TemplateQueryService(db, storage),
    documents,
    catalog: new TemplateCatalogService(db, storage, placeholders, previews, logger),
    editor: new OnlyOfficeService(config.onlyOffice, db, documents, logger, overrides.editorFetcher),
    // Giới hạn tần suất các thao tác ghi (tạo/upload) theo IP.
    writeLimiter: rateLimit({
      windowMs: 60_000,
      limit: overrides.writeLimitPerMinute ?? 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).type("application/problem+json").json({
          title: "Quá nhiều yêu cầu",
          status: 429,
          detail: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.",
        }),
    }),
  };
}

const openApiPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.yaml");

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // đứng sau nginx

  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req, res) => {
        const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.includes("/previews/") ?? false },
    }),
  );
  // Swagger UI cần inline script/style -> CSP chỉ nới cho /swagger.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } }));

  if (ctx.config.corsOrigins.length > 0) {
    app.use("/api", (req, res, next) => {
      const origin = req.get("origin");
      if (origin && ctx.config.corsOrigins.includes(origin)) {
        res.set({
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE",
          "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
        });
        if (req.method === "OPTIONS") return res.status(204).end();
      }
      next();
    });
  }

  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    try {
      await ctx.db.$queryRaw`SELECT 1`;
      res.json({ status: "healthy" });
    } catch {
      res.status(503).json({ status: "unhealthy" });
    }
  });

  app.get("/api/categories", async (req, res) => {
    const type = req.query.type === undefined ? undefined : kindSchema.parse(req.query.type);
    res.json(await ctx.templates.categories(type));
  });
  app.use("/api/templates", templatesRouter(ctx));
  app.use("/api/documents", documentsRouter(ctx));
  app.post("/api/admin/templates/sync", requireAdminKey(ctx.config.adminApiKey), async (_req, res) => {
    res.json(await ctx.catalog.sync());
  });

  if (fs.existsSync(openApiPath)) {
    const spec = YAML.parse(fs.readFileSync(openApiPath, "utf8"));
    app.get("/openapi.json", (_req, res) => res.json(spec));
    app.use("/swagger", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "Office Template Library API" }));
  }

  app.use("/api", notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
