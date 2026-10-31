import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { FORMATS, DOCUMENT_KINDS, formatFromExtension } from "../src/domain/documentKinds.js";
import { normalizeSearch, safeFileName, slugify } from "../src/domain/text.js";
import { base64Url, signJwt, verifyJwt } from "../src/editor/jwt.js";
import { LocalFileStorage } from "../src/storage/fileStorage.js";

describe("domain", () => {
  it.each([
    ["Hợp Đồng  Lao động", "hop dong lao dong"],
    ["  ĐƠN xin nghỉ phép ", "don xin nghi phep"],
    [undefined, ""],
  ])("normalizeSearch(%j)", (input, expected) => expect(normalizeSearch(input)).toBe(expected));

  it.each([
    ["Báo cáo kinh doanh Q3/2026", "bao-cao-kinh-doanh-q3-2026"],
    ["  Đề xuất!!! ", "de-xuat"],
  ])("slugify(%j)", (input, expected) => expect(slugify(input)).toBe(expected));

  it("safeFileName loại ký tự nguy hiểm", () => {
    expect(safeFileName('a/b\\c:"d"')).toBe("a_b_c__d_");
  });

  it("mỗi loại tài liệu đều có định dạng", () => {
    for (const kind of DOCUMENT_KINDS) expect(FORMATS[kind].kind).toBe(kind);
    expect(formatFromExtension(".PPTX")?.kind).toBe("presentation");
    expect(formatFromExtension(".exe")).toBeUndefined();
  });
});

describe("JWT HS256", () => {
  const secret = "0123456789abcdef0123456789abcdef";

  it("ký/xác thực và phát hiện sửa đổi", () => {
    const token = signJwt({ key: "abc", status: 2 }, secret);
    expect(verifyJwt(token, secret)).toMatchObject({ key: "abc", status: 2 });

    const [h, , s] = token.split(".");
    const tampered = `${h}.${base64Url(Buffer.from('{"key":"abc","status":6}'))}.${s}`;
    expect(verifyJwt(tampered, secret)).toBeNull();
    expect(verifyJwt(token, `${secret}x`)).toBeNull();
    expect(verifyJwt("abc.def.ghi", secret)).toBeNull();
  });

  it("từ chối token hết hạn và alg khác HS256", () => {
    expect(verifyJwt(signJwt({ exp: Math.floor(Date.now() / 1000) - 600 }, secret), secret)).toBeNull();
    const none = `${base64Url(Buffer.from('{"alg":"none"}'))}.${base64Url(Buffer.from("{}"))}.`;
    expect(verifyJwt(none, secret)).toBeNull();
  });
});

describe("LocalFileStorage", () => {
  it("chặn path traversal", () => {
    const storage = new LocalFileStorage({ templatesRoot: "/srv/templates", documentsRoot: "/srv/docs" });
    expect(storage.resolve("templates", "documents/a/template.docx")).toBe("/srv/templates/documents/a/template.docx");
    expect(() => storage.resolve("templates", "../secret")).toThrow();
    expect(() => storage.resolve("documents", "/etc/passwd")).toThrow();
    expect(() => storage.resolve("documents", "a/../../x")).toThrow();
  });
});

describe("config", () => {
  it("bắt buộc JWT secret đủ dài khi bật ONLYOFFICE", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://x@localhost/db", ONLYOFFICE_ENABLED: "true", ONLYOFFICE_JWT_SECRET: "short" }),
    ).toThrow(/ONLYOFFICE_JWT_SECRET/);
  });
});
