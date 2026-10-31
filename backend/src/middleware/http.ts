import { createHash, timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

/** Ghi lỗi theo chuẩn RFC 7807 (application/problem+json). */
export function sendProblem(
  res: Response,
  status: number,
  title: string,
  extra: { detail?: string; errors?: Record<string, string[]> } = {},
) {
  res
    .status(status)
    .type("application/problem+json")
    .send(
      JSON.stringify({
        type: `https://httpstatuses.io/${status}`,
        title,
        status,
        ...extra,
        traceId: (res.req as Request & { id?: unknown }).id,
      }),
    );
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next: NextFunction) => {
    if (res.headersSent) {
      req.socket.destroy();
      return;
    }
    if (err instanceof ValidationError) return sendProblem(res, 400, err.title, { errors: err.errors, detail: firstError(err.errors) });
    if (err instanceof AppError) return sendProblem(res, err.status, err.title, { detail: err.message });
    if (err instanceof z.ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of err.issues) (errors[issue.path.join(".") || "request"] ??= []).push(issue.message);
      return sendProblem(res, 400, "Dữ liệu không hợp lệ.", { errors, detail: firstError(errors) });
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return sendProblem(res, status, "Tải file thất bại", {
        detail: err.code === "LIMIT_FILE_SIZE" ? "File vượt quá dung lượng cho phép." : err.message,
      });
    }
    // Lỗi parse JSON / body quá lớn từ express.json()
    if (typeof err?.status === "number" && err.status >= 400 && err.status < 500 && err.expose) {
      return sendProblem(res, err.status, "Yêu cầu không hợp lệ", { detail: err.message });
    }

    logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled error");
    sendProblem(res, 500, "Lỗi hệ thống", { detail: "Đã có lỗi xảy ra, vui lòng thử lại sau." });
  };
}

const firstError = (errors: Record<string, string[]>) => Object.values(errors)[0]?.[0];

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new NotFoundError("Endpoint", req.path));

/** Bảo vệ API quản trị bằng header X-Admin-Key. */
export function requireAdminKey(configured: string): RequestHandler {
  const expected = createHash("sha256").update(configured).digest();
  return (req, _res, next) => {
    if (!configured) return next(new ForbiddenError("API quản trị đang tắt (chưa cấu hình ADMIN_API_KEY)."));
    const provided = createHash("sha256").update(req.get("x-admin-key") ?? "").digest();
    if (!timingSafeEqual(provided, expected)) return next(new UnauthorizedError("Thiếu hoặc sai header X-Admin-Key."));
    next();
  };
}

/** Upload giữ trong bộ nhớ (file Office nhỏ, cần kiểm tra nội dung trước khi ghi xuống đĩa). */
export const upload = (maxBytes: number) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 20 } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID không đúng định dạng UUID -> 404 (không lộ chi tiết, không gửi chuỗi lạ xuống CSDL). */
export function uuidParam(req: Request, name: string, resource: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !UUID.test(value)) throw new NotFoundError(resource, value);
  return value.toLowerCase();
}

export const kindSchema = z.enum(["document", "presentation"], { message: "Giá trị type phải là document hoặc presentation." });

export const pagingSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
};
