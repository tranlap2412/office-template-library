import fs from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentDto, PagedResult, TemplateSummaryDto } from "../src/services/dto.js";
import { appendParagraph, binaryParser, docxShape, pptxShape, sha256 } from "./support/ooxml.js";
import { createTestApp, type TestApp } from "./support/testApp.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function template(type: string, slug: string) {
  const page = (await request(t.app).get(`/api/templates?type=${type}&pageSize=100`).expect(200)).body as PagedResult<TemplateSummaryDto>;
  return page.items.find((i) => i.slug === slug)!;
}

async function create(templateId: string, body: object) {
  return (await request(t.app).post(`/api/templates/${templateId}/documents`).send(body).expect(201)).body as DocumentDto;
}

const download = async (id: string) =>
  (await request(t.app).get(`/api/documents/${id}/download`).buffer(true).parse(binaryParser as never).expect(200)).body as Buffer;


describe("Documents API", () => {
  it("tạo bản sao đã điền trường mà không thay đổi file template", async () => {
    const tpl = await template("document", "hop-dong-lao-dong");
    const templatePath = t.templateFile("documents", "hop-dong-lao-dong", ".docx");
    const before = sha256(templatePath);

    const res = await request(t.app)
      .post(`/api/templates/${tpl.id}/documents`)
      .send({ title: "HĐLĐ - Trần Văn Lập", fields: { TenNguoiLaoDong: "Trần Văn Lập", MucLuong: "30.000.000" } })
      .expect(201);
    const doc = res.body as DocumentDto;
    expect(res.headers.location).toBe(`/api/documents/${doc.id}`);
    expect(doc).toMatchObject({ title: "HĐLĐ - Trần Văn Lập", templateId: tpl.id, version: 1, fileExtension: ".docx" });

    const output = await download(doc.id);
    const shape = await docxShape(output);
    expect(shape.text).toContain("Trần Văn Lập");
    expect(shape.text).toContain("30.000.000");
    expect(shape.text).toContain("Công ty TNHH Giải pháp Văn phòng"); // giá trị mặc định
    expect(shape.text).not.toContain("{{TenNguoiLaoDong}}");
    expect(shape.title).toBe("HĐLĐ - Trần Văn Lập");

    // File template gốc không đổi một byte.
    expect(sha256(templatePath)).toBe(before);
    expect(output.equals(fs.readFileSync(templatePath))).toBe(false);

    // Lượt sử dụng của template tăng.
    expect((await template("document", "hop-dong-lao-dong")).usageCount).toBe(1);
  });

  it("giữ nguyên định dạng cơ bản của DOCX", async () => {
    const tpl = await template("document", "bang-bao-gia");
    const original = await docxShape(fs.readFileSync(t.templateFile("documents", "bang-bao-gia", ".docx")));

    const doc = await create(tpl.id, { title: "Báo giá ACME", fields: { TenKhachHang: "ACME" } });
    const copy = await docxShape(await download(doc.id));

    expect(copy.paragraphs).toBe(original.paragraphs);
    expect(copy.tables).toBe(original.tables);
    expect(copy.tableRows).toBe(original.tableRows);
    expect(copy.boldRuns).toBe(original.boldRuns);
    expect(copy.lists).toBe(original.lists);
    expect(copy.styles).toBe(original.styles);
    expect(copy.section).toBe(original.section); // khổ giấy, lề
  });

  it("các tài liệu tạo từ cùng một mẫu độc lập với nhau", async () => {
    const tpl = await template("document", "don-xin-nghi-phep");
    const a = await create(tpl.id, { title: "Đơn A" });
    const b = await create(tpl.id, { title: "Đơn B" });
    const bBefore = await download(b.id);

    const edited = await appendParagraph(await download(a.id), "Nội dung chỉnh sửa của A");
    const put = await request(t.app).put(`/api/documents/${a.id}/content`).attach("file", edited, "a.docx").expect(200);

    expect((put.body as DocumentDto).version).toBe(2);
    expect((await docxShape(await download(a.id))).text).toContain("Nội dung chỉnh sửa của A");
    expect((await download(b.id)).equals(bBefore)).toBe(true);
  });

  it("tạo bản trình chiếu với đủ slide và tải xuống PPTX", async () => {
    const tpl = await template("presentation", "gioi-thieu-san-pham");
    const original = await pptxShape(fs.readFileSync(t.templateFile("presentations", "gioi-thieu-san-pham", ".pptx")));

    const doc = await create(tpl.id, { title: "Thuyết trình OfficeFlow", fields: { TenSanPham: "OfficeFlow Pro" } });
    const res = await request(t.app).get(`/api/documents/${doc.id}/download`).buffer(true).parse(binaryParser as never).expect(200);

    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(res.headers["content-disposition"]).toContain(`filename*=UTF-8''${encodeURIComponent("Thuyết trình OfficeFlow.pptx")}`);
    const copy = await pptxShape(res.body);
    expect(copy.slides).toBe(original.slides);
    expect(copy.text).toContain("OfficeFlow Pro");
  });

  it("từ chối trường không có trong template và tiêu đề không hợp lệ", async () => {
    const tpl = await template("document", "thu-moi-su-kien");

    const unknown = await request(t.app)
      .post(`/api/templates/${tpl.id}/documents`)
      .send({ title: "x", fields: { KhongCo: "1" } })
      .expect(400);
    expect(unknown.body.errors).toHaveProperty("fields.KhongCo");

    const tooLong = await request(t.app).post(`/api/templates/${tpl.id}/documents`).send({ title: "a".repeat(201) }).expect(400);
    expect(tooLong.body.errors).toHaveProperty("title");

    await request(t.app).post(`/api/templates/${tpl.id}/documents`).set("content-type", "application/json").send("{bad").expect(400);
  });

  it("template không tồn tại trả 404", async () => {
    await request(t.app).post("/api/templates/00000000-0000-4000-8000-000000000000/documents").send({ title: "x" }).expect(404);
  });

  it("từ chối file tải lên không phải tài liệu hợp lệ và giữ nguyên phiên bản", async () => {
    const tpl = await template("document", "to-trinh-de-xuat");
    const doc = await create(tpl.id, { title: "Tờ trình" });

    const res = await request(t.app).put(`/api/documents/${doc.id}/content`).attach("file", Buffer.from("hello"), "fake.docx").expect(400);
    expect(res.body.errors).toHaveProperty("file");

    // PPTX hợp lệ nhưng sai loại cho tài liệu DOCX cũng bị từ chối.
    const pptx = fs.readFileSync(t.templateFile("presentations", "dao-tao-noi-bo", ".pptx"));
    await request(t.app).put(`/api/documents/${doc.id}/content`).attach("file", pptx, "x.docx").expect(400);

    expect(((await request(t.app).get(`/api/documents/${doc.id}`)).body as DocumentDto).version).toBe(1);
  });

  it("liệt kê theo loại, đổi tên, xóa tài liệu và file của nó", async () => {
    const tpl = await template("document", "bien-ban-cuoc-hop");
    const doc = await create(tpl.id, { title: "Biên bản" });

    const list = (await request(t.app).get("/api/documents?type=document").expect(200)).body as PagedResult<DocumentDto>;
    expect(list.items[0].id).toBe(doc.id); // mới nhất trước
    expect(((await request(t.app).get("/api/documents?type=presentation")).body as PagedResult<DocumentDto>).items.every((d) => d.kind === "presentation")).toBe(true);

    const renamed = await request(t.app).patch(`/api/documents/${doc.id}`).send({ title: "Biên bản họp tuần" }).expect(200);
    expect(renamed.body.title).toBe("Biên bản họp tuần");
    await request(t.app).patch(`/api/documents/${doc.id}`).send({ title: "   " }).expect(400);

    const filesBefore = fs.readdirSync(t.documentsRoot, { recursive: true }).map(String).filter((f) => f.includes(doc.id.replaceAll("-", "")));
    expect(filesBefore).toHaveLength(1);

    await request(t.app).delete(`/api/documents/${doc.id}`).expect(204);
    await request(t.app).get(`/api/documents/${doc.id}`).expect(404);
    expect(fs.readdirSync(t.documentsRoot, { recursive: true }).map(String).some((f) => f.includes(doc.id.replaceAll("-", "")))).toBe(false);
  });
});
