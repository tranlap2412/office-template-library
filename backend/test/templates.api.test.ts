import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CategoryDto, PagedResult, TemplateDetailDto, TemplateSummaryDto } from "../src/services/dto.js";
import { createTestApp, type TestApp } from "./support/testApp.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const search = async (query: string) =>
  (await request(t.app).get(`/api/templates?${query}`).expect(200)).body as PagedResult<TemplateSummaryDto>;

describe("Templates API", () => {
  it("liệt kê template theo loại, có thumbnail", async () => {
    const docs = await search("type=document&pageSize=100");
    const slides = await search("type=presentation&pageSize=100");

    expect(docs.totalCount).toBe(6);
    expect(slides.totalCount).toBe(4);
    expect(docs.items.every((i) => i.thumbnailUrl)).toBe(true);
  });

  it("tìm kiếm không phân biệt hoa thường và dấu", async () => {
    const result = await search("type=document&q=HOP%20DONG");
    expect(result.items.map((i) => i.slug)).toEqual(["hop-dong-lao-dong"]);
  });

  it("lọc theo danh mục", async () => {
    const result = await search("type=document&category=nhan-su");
    expect(result.totalCount).toBe(2);
    expect(result.items.every((i) => i.category.slug === "nhan-su")).toBe(true);
  });

  it("phân trang", async () => {
    const page2 = await search("type=document&pageSize=4&page=2");
    expect(page2).toMatchObject({ page: 2, pageSize: 4, totalCount: 6, totalPages: 2 });
    expect(page2.items).toHaveLength(2);
  });

  it("trả trang rỗng khi không khớp", async () => {
    const result = await search("q=khong-ton-tai-xyz");
    expect(result).toMatchObject({ items: [], totalCount: 0 });
  });

  it("từ chối tham số không hợp lệ bằng ProblemDetails 400", async () => {
    const res = await request(t.app).get("/api/templates?sort=random&pageSize=1000").expect(400);
    expect(res.type).toBe("application/problem+json");
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(["sort", "pageSize"]));
  });

  it("chi tiết gồm toàn bộ slide preview và các trường", async () => {
    const [summary] = (await search("type=presentation&q=bao%20cao%20kinh%20doanh")).items;
    const detail = (await request(t.app).get(`/api/templates/${summary.id}`).expect(200)).body as TemplateDetailDto;

    expect(detail.previews.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(detail.fields).toContainEqual({ key: "DoanhThu", label: "Doanh thu", defaultValue: "12,5 tỷ" });
    expect(detail.fileExtension).toBe(".pptx");
  });

  it("phục vụ ảnh preview có cache/ETag, 304 khi không đổi, 404 khi không có trang", async () => {
    const [summary] = (await search("type=document&q=bao%20gia")).items;

    const image = await request(t.app).get(summary.thumbnailUrl!).buffer(true).expect(200);
    expect(image.type).toBe("image/png");
    expect(image.body.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(image.headers["cache-control"]).toContain("max-age=86400");

    await request(t.app).get(summary.thumbnailUrl!).set("If-None-Match", image.headers.etag).expect(304);
    await request(t.app).get(`/api/templates/${summary.id}/previews/99`).expect(404);
  });

  it("template không tồn tại hoặc id sai định dạng trả 404 ProblemDetails", async () => {
    const missing = await request(t.app).get("/api/templates/00000000-0000-4000-8000-000000000000").expect(404);
    expect(missing.type).toBe("application/problem+json");
    expect(missing.body.status).toBe(404);
    await request(t.app).get("/api/templates/khong-ton-tai").expect(404);
  });

  it("danh mục theo loại, chỉ đếm template đang hoạt động", async () => {
    const categories = (await request(t.app).get("/api/categories?type=document").expect(200)).body as CategoryDto[];
    expect(categories).toContainEqual({ slug: "nhan-su", name: "Nhân sự", kind: "document", templateCount: 2 });
    expect(categories.some((c) => c.slug === "bao-cao")).toBe(false);
  });
});
