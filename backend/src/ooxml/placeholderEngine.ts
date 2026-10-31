import JSZip from "jszip";
import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element } from "@xmldom/xmldom";
import type { DocumentKind } from "../domain/documentKinds.js";

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  dc: "http://purl.org/dc/elements/1.1/",
  cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
  xml: "http://www.w3.org/XML/1998/namespace",
};

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

interface KindSpec {
  /** Part chính bắt buộc phải có để coi là file hợp lệ. */
  mainPart: string;
  /** Các part chứa văn bản cần xử lý, theo thứ tự đọc. */
  textParts: (names: string[]) => string[];
  ns: string;
}

const byNumber = (a: string, b: string) =>
  Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

const SPECS: Record<DocumentKind, KindSpec> = {
  document: {
    mainPart: "word/document.xml",
    ns: NS.w,
    textParts: (names) => [
      "word/document.xml",
      ...names.filter((n) => /^word\/header\d*\.xml$/.test(n)).sort(byNumber),
      ...names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).sort(byNumber),
      ...names.filter((n) => n === "word/footnotes.xml" || n === "word/endnotes.xml"),
    ],
  },
  presentation: {
    mainPart: "ppt/presentation.xml",
    ns: NS.a,
    textParts: (names) => names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber),
  },
};

export class InvalidPackageError extends Error {}

/**
 * Word/PowerPoint hay tách một placeholder thành nhiều run ("{{Ten" + "CongTy}}").
 * Engine ghép text của cả đoạn, ghi giá trị vào run đầu và xóa phần còn lại.
 */
export class PlaceholderEngine {
  async findPlaceholders(file: Buffer, kind: DocumentKind): Promise<string[]> {
    const { zip, spec } = await this.open(file, kind);
    const keys: string[] = [];
    for (const name of spec.textParts(Object.keys(zip.files))) {
      const xml = await zip.file(name)?.async("string");
      if (!xml) continue;
      const doc = parseXml(xml);
      for (const texts of paragraphs(doc, spec.ns)) {
        const full = texts.map((t) => t.textContent ?? "").join("");
        for (const m of full.matchAll(PLACEHOLDER)) if (!keys.includes(m[1])) keys.push(m[1]);
      }
    }
    return keys;
  }

  /**
   * Trả về file mới đã thay placeholder; buffer đầu vào không bị sửa.
   * Placeholder không có giá trị được giữ nguyên để người dùng tự sửa trong trình soạn thảo.
   */
  async apply(
    file: Buffer,
    kind: DocumentKind,
    values: Record<string, string>,
    title?: string,
  ): Promise<{ buffer: Buffer; replaced: number }> {
    const { zip, spec } = await this.open(file, kind);
    let replaced = 0;

    for (const name of spec.textParts(Object.keys(zip.files))) {
      const xml = await zip.file(name)?.async("string");
      if (!xml || !xml.includes("{{")) continue;
      const doc = parseXml(xml);
      let changed = 0;
      for (const texts of paragraphs(doc, spec.ns)) changed += replaceInParagraph(texts, values, kind);
      if (changed > 0) {
        zip.file(name, serialize(doc));
        replaced += changed;
      }
    }

    if (title !== undefined) await setTitle(zip, title);

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return { buffer, replaced };
  }

  /** File có phải gói Open XML hợp lệ đúng loại hay không. */
  async isValidPackage(file: Buffer, kind: DocumentKind): Promise<boolean> {
    try {
      const { zip, spec } = await this.open(file, kind);
      const main = await zip.file(spec.mainPart)!.async("string");
      parseXml(main);
      return true;
    } catch {
      return false;
    }
  }

  private async open(file: Buffer, kind: DocumentKind) {
    const spec = SPECS[kind];
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new InvalidPackageError("File không phải gói Office (zip) hợp lệ.");
    }
    if (!zip.file("[Content_Types].xml") || !zip.file(spec.mainPart))
      throw new InvalidPackageError(`File không phải ${kind === "document" ? "DOCX" : "PPTX"} hợp lệ.`);
    return { zip, spec };
  }
}

function parseXml(xml: string): XmlDocument {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level !== "warning") errors.push(msg);
    },
  }).parseFromString(xml, "text/xml");
  if (errors.length > 0) throw new InvalidPackageError(`XML không hợp lệ: ${errors[0]}`);
  return doc;
}

function serialize(doc: XmlDocument): string {
  const out = new XMLSerializer().serializeToString(doc);
  return out.startsWith("<?xml") ? out : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${out}`;
}

/** Nhóm phần tử văn bản theo đoạn; chỉ lấy text thuộc trực tiếp đoạn đó (không lấy đoạn lồng trong text box). */
function* paragraphs(doc: XmlDocument, ns: string): Generator<Element[]> {
  const ps = Array.from(doc.getElementsByTagNameNS(ns, "p"));
  for (const p of ps) {
    const texts = Array.from(p.getElementsByTagNameNS(ns, "t")).filter((t) => closestParagraph(t, ns) === p);
    if (texts.length > 0) yield texts;
  }
}

function closestParagraph(node: Element, ns: string): Element | null {
  let current = node.parentNode as Element | null;
  while (current) {
    if (current.localName === "p" && current.namespaceURI === ns) return current;
    current = current.parentNode as Element | null;
  }
  return null;
}

export function replaceInParagraph(texts: Element[], values: Record<string, string>, kind: DocumentKind): number {
  const contents = texts.map((t) => t.textContent ?? "");
  const full = contents.join("");
  if (!full.includes("{{")) return 0;

  const matches = [...full.matchAll(PLACEHOLDER)];
  if (matches.length === 0) return 0;

  const starts: number[] = [];
  contents.reduce((pos, c, i) => ((starts[i] = pos), pos + c.length), 0);
  const locate = (position: number) => {
    for (let i = contents.length - 1; i >= 0; i--) {
      if (position >= starts[i] && position < starts[i] + contents[i].length) return { i, offset: position - starts[i] };
    }
    throw new Error("Placeholder position out of range.");
  };

  let replaced = 0;
  // Duyệt từ phải sang trái để vị trí các placeholder phía trước không bị lệch.
  for (const m of matches.reverse()) {
    const raw = values[m[1]];
    if (raw === undefined) continue;
    const value = sanitizeValue(raw);
    const start = locate(m.index!);
    const end = locate(m.index! + m[0].length - 1);

    if (start.i === end.i) {
      const t = contents[start.i];
      contents[start.i] = t.slice(0, start.offset) + value + t.slice(end.offset + 1);
    } else {
      contents[start.i] = contents[start.i].slice(0, start.offset) + value;
      for (let k = start.i + 1; k < end.i; k++) contents[k] = "";
      contents[end.i] = contents[end.i].slice(end.offset + 1);
    }
    replaced++;
  }

  texts.forEach((t, i) => {
    if (t.textContent === contents[i]) return;
    t.textContent = contents[i];
    // Word bỏ khoảng trắng đầu/cuối nếu không khai báo xml:space="preserve".
    if (kind === "document" && /^\s|\s$/.test(contents[i])) t.setAttributeNS(NS.xml, "xml:space", "preserve");
  });
  return replaced;
}

/** Loại ký tự không hợp lệ trong XML, đưa xuống dòng về khoảng trắng. */
export function sanitizeValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n|\r|\n/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");
}

async function setTitle(zip: JSZip, title: string) {
  const name = "docProps/core.xml";
  const xml = await zip.file(name)?.async("string");
  if (!xml) return; // gói không có core properties – bỏ qua, không bắt buộc
  const doc = parseXml(xml);
  const root = doc.documentElement!;
  let el = Array.from(doc.getElementsByTagNameNS(NS.dc, "title"))[0];
  if (!el) {
    el = doc.createElementNS(NS.dc, "dc:title");
    root.appendChild(el);
  }
  el.textContent = sanitizeValue(title);
  zip.file(name, serialize(doc));
}
