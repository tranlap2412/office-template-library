import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { PlaceholderEngine, sanitizeValue } from "../src/ooxml/placeholderEngine.js";
import { createDocx, p, pptxShape, r } from "./support/ooxml.js";
import { REPO_TEMPLATES } from "./support/testApp.js";

const engine = new PlaceholderEngine();
const documentXml = async (file: Buffer) => (await JSZip.loadAsync(file)).file("word/document.xml")!.async("string");

describe("PlaceholderEngine", () => {
  it("thay placeholder bị Word tách qua nhiều run và giữ định dạng của run đầu tiên", async () => {
    const docx = await createDocx(p(r("Kính gửi: "), r("{{Ten", true), r("KhachHang}}"), r(".")));

    const { buffer, replaced } = await engine.apply(docx, "document", { TenKhachHang: "Công ty ABC" });

    expect(replaced).toBe(1);
    const xml = await documentXml(buffer);
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Công ty ABC</w:t></w:r>');
    expect(xml.replace(/<[^>]+>/g, "")).toBe("Kính gửi: Công ty ABC.");
  });

  it("giữ nguyên placeholder không có giá trị", async () => {
    const docx = await createDocx(p(r("{{A}} và {{B}}")));

    const { buffer, replaced } = await engine.apply(docx, "document", { A: "x" });

    expect(replaced).toBe(1);
    expect((await documentXml(buffer)).replace(/<[^>]+>/g, "")).toBe("x và {{B}}");
  });

  it("không sửa buffer đầu vào", async () => {
    const docx = await createDocx(p(r("{{A}}")));
    const before = Buffer.from(docx);
    await engine.apply(docx, "document", { A: "x" });
    expect(docx.equals(before)).toBe(true);
  });

  it("tìm placeholder trong đoạn văn và bảng theo thứ tự, không trùng lặp", async () => {
    const table = `<w:tbl><w:tr><w:tc>${p(r("{{InTable}} {{First}}"))}</w:tc></w:tr></w:tbl>`;
    const docx = await createDocx(p(r("{{First}} - {{ Second }}")) + table);

    expect(await engine.findPlaceholders(docx, "document")).toEqual(["First", "Second", "InTable"]);
  });

  it("escape ký tự đặc biệt XML và loại ký tự điều khiển", async () => {
    const docx = await createDocx(p(r("{{A}}")));
    const { buffer } = await engine.apply(docx, "document", { A: "A & B <c>\u0001\nd" });

    const xml = await documentXml(buffer);
    expect(xml).toMatch(/A &amp; B &lt;c(>|&gt;) d</);
    expect(sanitizeValue("a\u0001b\nc")).toBe("ab c");
  });

  it("thay placeholder trong PPTX, giữ nguyên số slide và đặt tiêu đề", async () => {
    const original = fs.readFileSync(path.join(REPO_TEMPLATES, "presentations/gioi-thieu-san-pham/template.pptx"));

    const { buffer, replaced } = await engine.apply(original, "presentation", { TenSanPham: "OfficeFlow X" }, "Pitch");

    expect(replaced).toBeGreaterThanOrEqual(1);
    const shape = await pptxShape(buffer);
    expect(shape.slides).toBe((await pptxShape(original)).slides);
    expect(shape.text).toContain("OfficeFlow X");
    expect(shape.text).not.toContain("{{TenSanPham}}");
    const core = await (await JSZip.loadAsync(buffer)).file("docProps/core.xml")!.async("string");
    expect(core).toContain("<dc:title>Pitch</dc:title>");
  });

  it("kiểm tra đúng loại gói Open XML", async () => {
    const docx = await createDocx(p(r("hello")));
    expect(await engine.isValidPackage(docx, "document")).toBe(true);
    expect(await engine.isValidPackage(docx, "presentation")).toBe(false);
    expect(await engine.isValidPackage(Buffer.from("not a zip"), "document")).toBe(false);
  });
});
