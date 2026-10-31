import fs from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PagedResult, TemplateDetailDto, TemplateSummaryDto } from "../src/services/dto.js";
import { createDocx, p, r } from "./support/ooxml.js";
import { ADMIN_KEY, createTestApp, type TestApp } from "./support/testApp.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const uploadTemplate = async (text: string) => {
  const docx = await createDocx(p(r(text)));
  return request(t.app)
    .post("/api/templates")
    .set("X-Admin-Key", ADMIN_KEY)
    .field("name", "Giấy ủy quyền")
    .field("slug", "giay-uy-quyen")
    .field("description", "Mẫu tạo trong test")
    .field("categorySlug", "phap-ly")
    .field("categoryName", "Pháp lý")
    .field("tags", "test, upload")
    .attach("file", docx, "mau-moi.docx");
};

describe("API quản trị template", () => {
  it("yêu cầu X-Admin-Key", async () => {
    await request(t.app).post("/api/admin/templates/sync").expect(401);
    await request(t.app).post("/api/admin/templates/sync").set("X-Admin-Key", "sai").expect(401);
    const ok = await request(t.app).post("/api/admin/templates/sync").set("X-Admin-Key", ADMIN_KEY).expect(200);
    expect(ok.body).toMatchObject({ added: 0, unchanged: 10, deactivated: 0, errors: [] });
  });

  it("upload template mới -> xuất hiện trong thư viện; upload lại cùng slug -> tăng version", async () => {
    const created = await uploadTemplate("Tôi là {{NguoiUyQuyen}}, ủy quyền cho {{NguoiDuocUyQuyen}}.");
    expect(created.status).toBe(201);
    const detail = created.body as TemplateDetailDto;

    expect(detail).toMatchObject({ slug: "giay-uy-quyen", kind: "document", version: 1, category: { slug: "phap-ly", name: "Pháp lý" } });
    expect(detail.tags).toEqual(["test", "upload"]);
    expect(detail.fields.map((f) => f.key)).toEqual(["NguoiUyQuyen", "NguoiDuocUyQuyen"]);
    expect(fs.existsSync(t.templateFile("documents", "giay-uy-quyen", ".docx"))).toBe(true);

    const found = (await request(t.app).get("/api/templates?q=giay%20uy%20quyen")).body as PagedResult<TemplateSummaryDto>;
    expect(found.items.map((i) => i.id)).toEqual([detail.id]);

    const second = await uploadTemplate("Phiên bản 2: {{NguoiUyQuyen}}");
    expect(second.status).toBe(201);
    const updated = second.body as TemplateDetailDto;
    expect(updated.id).toBe(detail.id);
    expect(updated.version).toBe(2);
    expect(updated.fields.map((f) => f.key)).toEqual(["NguoiUyQuyen"]);
  });

  it("template bị gỡ khỏi kho thì bị ẩn khi đồng bộ", async () => {
    fs.rmSync(`${t.templatesRoot}/documents/thu-moi-su-kien`, { recursive: true });
    const res = await request(t.app).post("/api/admin/templates/sync").set("X-Admin-Key", ADMIN_KEY).expect(200);
    expect(res.body.deactivated).toBe(1);
    const docs = (await request(t.app).get("/api/templates?type=document&pageSize=100")).body as PagedResult<TemplateSummaryDto>;
    expect(docs.items.some((i) => i.slug === "thu-moi-su-kien")).toBe(false);
  });

  it("từ chối phần mở rộng không hỗ trợ và file giả mạo", async () => {
    await request(t.app)
      .post("/api/templates")
      .set("X-Admin-Key", ADMIN_KEY)
      .field("name", "Bad")
      .attach("file", Buffer.from("hello"), "virus.exe")
      .expect(400);
    await request(t.app)
      .post("/api/templates")
      .set("X-Admin-Key", ADMIN_KEY)
      .field("name", "Bad")
      .attach("file", Buffer.from("hello"), "fake.docx")
      .expect(400);
  });
});
