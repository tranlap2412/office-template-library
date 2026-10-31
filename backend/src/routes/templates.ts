import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { MAX_TEMPLATE_BYTES } from "../catalog/templateCatalogService.js";
import { ValidationError } from "../lib/errors.js";
import { kindSchema, pagingSchema, requireAdminKey, upload, uuidParam } from "../middleware/http.js";

const searchQuery = z.object({
  type: kindSchema.optional(),
  q: z.string().max(200).optional(),
  category: z.string().max(80).optional(),
  sort: z.enum(["name", "newest", "popular"], { message: "sort phải là name, newest hoặc popular." }).default("name"),
  ...pagingSchema,
});

const createBody = z.object({
  title: z.string().max(1000).nullish(),
  fields: z.record(z.string(), z.string().nullable()).nullish(),
});

const uploadBody = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().max(1000).optional(),
  categorySlug: z.string().max(80).optional(),
  categoryName: z.string().max(120).optional(),
  tags: z.string().max(500).optional(),
});

export function templatesRouter(ctx: AppContext) {
  const r = Router();

  /** Tìm kiếm, lọc, phân trang template. */
  r.get("/", async (req, res) => {
    res.json(await ctx.templates.search(searchQuery.parse(req.query)));
  });

  /** Chi tiết template: danh sách trang/slide xem trước và các trường có thể điền. */
  r.get("/:id", async (req, res) => {
    res.json(await ctx.templates.get(uuidParam(req, "id", "Template")));
  });

  /** Ảnh xem trước trang/slide thứ N (bắt đầu từ 1). URL kèm ?v=<version> nên cache lâu được. */
  r.get("/:id/previews/:page", async (req, res) => {
    const id = uuidParam(req, "id", "Template");
    const page = z.coerce.number().int().min(1).max(500).parse(req.params.page);
    const image = await ctx.templates.previewImage(id, page);

    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      ETag: image.etag,
      "Last-Modified": image.lastModified.toUTCString(),
    });
    if (req.fresh) {
      image.stream.destroy();
      res.status(304).end();
      return;
    }
    await pipeline(image.stream, res);
  });

  /** Tạo tài liệu mới (bản sao độc lập) từ template. */
  r.post("/:id/documents", ctx.writeLimiter, async (req, res) => {
    const body = createBody.parse(req.body ?? {});
    const doc = await ctx.documents.createFromTemplate(uuidParam(req, "id", "Template"), body);
    res.status(201).location(`/api/documents/${doc.id}`).json(doc);
  });

  /** [Quản trị] Upload template mới hoặc cập nhật template cùng slug (version tăng). */
  r.post("/", requireAdminKey(ctx.config.adminApiKey), ctx.writeLimiter, upload(MAX_TEMPLATE_BYTES).single("file"), async (req, res) => {
    if (!req.file?.size) throw ValidationError.field("file", "Vui lòng chọn file .docx hoặc .pptx.");
    const body = uploadBody.parse(req.body ?? {});
    const id = await ctx.catalog.importTemplate(body, req.file.buffer, Buffer.from(req.file.originalname, "latin1").toString("utf8"));
    res.status(201).location(`/api/templates/${id}`).json(await ctx.templates.get(id));
  });

  return r;
}
