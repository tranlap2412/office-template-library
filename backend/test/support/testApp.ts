import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, createContext, type AppContext } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db.js";
import { createLogger } from "../../src/lib/logger.js";
import { TEST_DATABASE_URL } from "./env.js";

export const ADMIN_KEY = "test-admin-key";
export const JWT_SECRET = "test-secret-0123456789-0123456789-abcdef";
export const EDITOR_PUBLIC_URL = "http://docs.local:8081";
export const EDITOR_INTERNAL_URL = "http://onlyoffice";

export const REPO_TEMPLATES = path.resolve(import.meta.dirname, "../../../templates");

/**
 * Dựng toàn bộ API với PostgreSQL test + thư mục tạm. Kho template được COPY từ templates/ của repo
 * nên test kiểm chứng được file template không bị thay đổi.
 */
export async function createTestApp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otl-test-"));
  const templatesRoot = path.join(root, "templates");
  const documentsRoot = path.join(root, "documents");
  await fs.cp(REPO_TEMPLATES, templatesRoot, { recursive: true });

  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    TEMPLATES_ROOT: templatesRoot,
    DOCUMENTS_ROOT: documentsRoot,
    PREVIEWS_ENABLED: "false",
    ADMIN_API_KEY: ADMIN_KEY,
    ONLYOFFICE_ENABLED: "true",
    ONLYOFFICE_PUBLIC_URL: EDITOR_PUBLIC_URL,
    ONLYOFFICE_INTERNAL_URL: EDITOR_INTERNAL_URL,
    ONLYOFFICE_API_BASE_URL: "http://api:8080",
    ONLYOFFICE_JWT_SECRET: JWT_SECRET,
  });

  const db = createDb(config.databaseUrl);
  // Mỗi file test bắt đầu với CSDL rỗng.
  await db.$executeRawUnsafe(
    'TRUNCATE "Document", "TemplateField", "TemplatePreview", "Template", "Category" RESTART IDENTITY CASCADE',
  );

  const editorDownloads = { body: Buffer.alloc(0) as Buffer, requests: [] as string[] };
  const ctx: AppContext = await createContext(config, db, createLogger("test"), {
    writeLimitPerMinute: 10_000,
    editorFetcher: async (url) => {
      editorDownloads.requests.push(url);
      return new Response(new Uint8Array(editorDownloads.body));
    },
  });
  await ctx.catalog.sync();

  return {
    app: createApp(ctx),
    ctx,
    templatesRoot,
    documentsRoot,
    editorDownloads,
    templateFile: (folder: string, slug: string, ext: string) => path.join(templatesRoot, folder, slug, `template${ext}`),
    async close() {
      await db.$disconnect();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
