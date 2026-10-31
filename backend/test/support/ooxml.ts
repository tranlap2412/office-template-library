import { createHash } from "node:crypto";
import fs from "node:fs";
import JSZip from "jszip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Tạo DOCX tối giản từ XML của body – đủ để kiểm thử engine. */
export async function createDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

export const p = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
export const r = (text: string, bold = false) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;

export const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;

/** Thống kê định dạng cơ bản của DOCX để so sánh template với tài liệu tạo ra. */
export async function docxShape(file: Buffer) {
  const zip = await JSZip.loadAsync(file);
  const doc = await zip.file("word/document.xml")!.async("string");
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const text = [...doc.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  return {
    paragraphs: count(doc, /<w:p[\s>]/g),
    tables: count(doc, /<w:tbl>/g),
    tableRows: count(doc, /<w:tr[\s>]/g),
    boldRuns: count(doc, /<w:b\/>/g),
    lists: count(doc, /<w:pStyle w:val="List/g) + count(doc, /<w:numPr>/g),
    styles: (await zip.file("word/styles.xml")?.async("string")) ?? "",
    section: doc.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)?.[0] ?? "",
    title: decode(core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] ?? ""),
    text: decode(text),
  };
}

export async function pptxShape(file: Buffer) {
  const zip = await JSZip.loadAsync(file);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  let text = "";
  for (const s of slides) text += (await zip.file(s)!.async("string")).match(/<a:t>[^<]*<\/a:t>/g)?.join("") ?? "";
  return { slides: slides.length, text: decode(text) };
}

/** Giả lập kết quả chỉnh sửa: thêm một đoạn văn vào cuối DOCX. */
export async function appendParagraph(file: Buffer, text: string) {
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file("word/document.xml")!.async("string");
  const at = xml.lastIndexOf("<w:sectPr");
  const para = `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  zip.file("word/document.xml", at >= 0 ? xml.slice(0, at) + para + xml.slice(at) : xml.replace("</w:body>", `${para}</w:body>`));
  return zip.generateAsync({ type: "nodebuffer" });
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Parser của supertest để nhận body nhị phân (file DOCX/PPTX). */
export function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}
