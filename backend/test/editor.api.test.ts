import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "../src/editor/jwt.js";
import type { DocumentDto, PagedResult, TemplateSummaryDto } from "../src/services/dto.js";
import { appendParagraph, binaryParser, docxShape } from "./support/ooxml.js";
import { createTestApp, EDITOR_INTERNAL_URL, EDITOR_PUBLIC_URL, JWT_SECRET, type TestApp } from "./support/testApp.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function createDocument() {
  const page = (await request(t.app).get("/api/templates?type=document&q=bien%20ban")).body as PagedResult<TemplateSummaryDto>;
  return (await request(t.app).post(`/api/templates/${page.items[0].id}/documents`).send({ title: "Biên bản" }).expect(201))
    .body as DocumentDto;
}

const key = (doc: DocumentDto, version = 1) => `${doc.id.replaceAll("-", "")}_${version}`;

async function editorConfig(id: string) {
  const res = await request(t.app).get(`/api/documents/${id}/editor-config`).expect(200);
  expect(res.body.enabled).toBe(true);
  return res.body.config;
}

async function callback(id: string, payload: object) {
  const res = await request(t.app)
    .post(`/api/documents/${id}/editor-callback`)
    .send({ token: signJwt(payload, JWT_SECRET) })
    .expect(200);
  return res.body.error as number;
}

const getVersion = async (id: string) => ((await request(t.app).get(`/api/documents/${id}`)).body as DocumentDto).version;

describe("Tích hợp ONLYOFFICE", () => {
  it("config được ký JWT và trỏ đúng tài liệu", async () => {
    const doc = await createDocument();
    const config = await editorConfig(doc.id);

    expect(config.documentType).toBe("word");
    expect(config.document.key).toBe(key(doc));
    expect(config.document.url).toMatch(new RegExp(`^http://api:8080/api/documents/${doc.id}/editor-content\\?token=`));
    expect(config.editorConfig.callbackUrl).toBe(`http://api:8080/api/documents/${doc.id}/editor-callback`);
    expect(verifyJwt<{ document: { key: string } }>(config.token, JWT_SECRET)?.document.key).toBe(key(doc));
  });

  it("tải nội dung cho editor cần token hợp lệ của đúng tài liệu", async () => {
    const doc = await createDocument();
    const url = new URL((await editorConfig(doc.id)).document.url);

    await request(t.app).get(`/api/documents/${doc.id}/editor-content`).expect(401);
    await request(t.app).get(url.pathname + url.search).expect(200);

    const other = await createDocument();
    await request(t.app).get(`/api/documents/${other.id}/editor-content${url.search}`).expect(401);
  });

  it("callback có token sai bị từ chối", async () => {
    const doc = await createDocument();
    const res = await request(t.app)
      .post(`/api/documents/${doc.id}/editor-callback`)
      .send({ key: key(doc), status: 2, url: `${EDITOR_PUBLIC_URL}/x.docx`, token: "abc.def.ghi" })
      .expect(200);
    expect(res.body.error).toBe(1);
  });

  it("callback lưu file đã sửa thành phiên bản mới, tải từ địa chỉ nội bộ", async () => {
    const doc = await createDocument();
    const original = (await request(t.app).get(`/api/documents/${doc.id}/download`).buffer(true).parse(binaryParser as never)).body;
    t.editorDownloads.body = await appendParagraph(original as Buffer, "Đã sửa trong editor");

    const error = await callback(doc.id, {
      key: key(doc),
      status: 2,
      url: `${EDITOR_PUBLIC_URL}/cache/files/${doc.id}/output.docx?md5=abc`,
    });

    expect(error).toBe(0);
    expect(t.editorDownloads.requests).toContain(`${EDITOR_INTERNAL_URL}/cache/files/${doc.id}/output.docx?md5=abc`);
    expect(await getVersion(doc.id)).toBe(2);
    const saved = (await request(t.app).get(`/api/documents/${doc.id}/download`).buffer(true).parse(binaryParser as never)).body;
    expect((await docxShape(saved as Buffer)).text).toContain("Đã sửa trong editor");
    expect((await editorConfig(doc.id)).document.key).toBe(key(doc, 2));
  });

  it("callback qua header Authorization (payload lồng) cũng được chấp nhận", async () => {
    const doc = await createDocument();
    const res = await request(t.app)
      .post(`/api/documents/${doc.id}/editor-callback`)
      .set("Authorization", `Bearer ${signJwt({ payload: { key: key(doc), status: 4 } }, JWT_SECRET)}`)
      .send({ key: key(doc), status: 4 })
      .expect(200);
    expect(res.body.error).toBe(0);
  });

  it("từ chối URL tải file không thuộc Document Server (chống SSRF)", async () => {
    const doc = await createDocument();
    expect(await callback(doc.id, { key: key(doc), status: 2, url: "http://evil.example/steal.docx" })).toBe(1);
    expect(await getVersion(doc.id)).toBe(1);
  });

  it("từ chối key của tài liệu khác", async () => {
    const doc = await createDocument();
    const other = await createDocument();
    expect(await callback(doc.id, { key: key(other), status: 2, url: `${EDITOR_PUBLIC_URL}/x.docx` })).toBe(1);
  });

  it("trạng thái đang sửa chỉ xác nhận, không lưu", async () => {
    const doc = await createDocument();
    expect(await callback(doc.id, { key: key(doc), status: 1 })).toBe(0);
    expect(await getVersion(doc.id)).toBe(1);
  });
});

