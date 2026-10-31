/**
 * Chuẩn hóa chuỗi để tìm kiếm không phân biệt hoa thường và dấu tiếng Việt:
 * "Hợp Đồng" -> "hop dong".
 */
export function normalizeSearch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Slug an toàn cho URL/tên thư mục: "Báo cáo Q3/2026" -> "bao-cao-q3-2026". */
export function slugify(value: string): string {
  const slug = normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || `template-${Math.random().toString(36).slice(2, 10)}`;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Tên file an toàn cho header Content-Disposition. */
export function safeFileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_").trim();
  return (cleaned || "document").slice(0, 120);
}
