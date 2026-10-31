import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { sendProblem, kindSchema, pagingSchema, upload, uuidParam } from "../middleware/http.js";
import { LIMITS } from "../services/documentService.js";
import { ValidationError } from "../lib/errors.js";

const listQuery = z.object({ type: kindSchema.optional(), ...pagingSchema });
const renameBody = z.object({ title: z.string().max(1000) }, { message: "Thiếu tiêu đề." });

export function documentsRouter(ctx: AppContext) {
  const r = Router();
  const id = (req: Parameters<typeof uuidParam>[0]) => uuidParam(req, "id", "Document");

  r.get("/", async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await ctx.documents.list(q.type, q.page, q.pageSize));
  });

  r.get("/:id", async (req, res) => {
    res.json(await ctx.documents.get(id(req)));
  });

  r.patch("/:id", async (req, res) => {
    res.json(await ctx.documents.rename(id(req), renameBody.parse(req.body ?? {}).title));
  });

  r.delete("/:id", async (req, res) => {
    await ctx.documents.remove(id(req));
    res.status(204).end();
  });

  /** Tải file DOCX/PPTX (tên file tiếng Việt qua Content-Disposition filename*). */
  r.get("/:id/download", async (req, res) => {
    const file = await ctx.documents.openContent(id(req));
    res.attachment(file.fileName).type(file.contentType).set("Cache-Control", "no-store");
    await pipeline(file.stream, res);
  });

  /** Tải lên phiên bản đã sửa bằng ứng dụng ngoài (Word, PowerPoint, LibreOffice…). */
  r.put("/:id/content", ctx.writeLimiter, upload(LIMITS.documentBytes).single("file"), async (req, res) => {
    if (!req.file?.size) throw ValidationError.field("file", "Vui lòng chọn file.");
    res.json(await ctx.documents.saveContent(id(req), req.file.buffer));
  });

  /** Cấu hình (đã ký JWT) để trình duyệt mở ONLYOFFICE. */
  r.get("/:id/editor-config", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await ctx.editor.getConfig(id(req)));
  });

  /** [Document Server] Tải nội dung tài liệu bằng token ký kèm URL. */
  r.get("/:id/editor-content", async (req, res) => {
    const docId = id(req);
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    if (!ctx.editor.validateFileToken(docId, token)) return sendProblem(res, 401, "Token không hợp lệ hoặc đã hết hạn");
    const file = await ctx.documents.openContent(docId);
    res.type(file.contentType).set("ETag", file.etag);
    await pipeline(file.stream, res);
  });

  /** [Document Server] Callback lưu tài liệu. Luôn trả {"error": 0|1} theo giao thức ONLYOFFICE. */
  r.post("/:id/editor-callback", async (req, res) => {
    let docId: string;
    try {
      docId = id(req);
    } catch {
      return res.json({ error: 1 });
    }
    res.json({ error: await ctx.editor.handleCallback(docId, req.body, req.get("authorization")) });
  });

  return r;
}
