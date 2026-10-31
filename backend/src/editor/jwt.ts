import { createHmac, timingSafeEqual } from "node:crypto";

/** JWT HS256 cho config, callback và URL tải file của ONLYOFFICE. */
const HEADER = base64Url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));

export function signJwt(payload: object, secret: string): string {
  const unsigned = `${HEADER}.${base64Url(Buffer.from(JSON.stringify(payload)))}`;
  return `${unsigned}.${base64Url(hmac(unsigned, secret))}`;
}

/** Trả về payload nếu chữ ký hợp lệ và chưa hết hạn (cho phép lệch đồng hồ 60 giây), ngược lại null. */
export function verifyJwt<T = Record<string, unknown>>(token: string | undefined | null, secret: string): T | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(fromBase64Url(parts[0]).toString("utf8"));
    if (header?.alg !== "HS256") return null;

    const expected = hmac(`${parts[0]}.${parts[1]}`, secret);
    const actual = fromBase64Url(parts[2]);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    const payload = JSON.parse(fromBase64Url(parts[1]).toString("utf8"));
    if (typeof payload !== "object" || payload === null) return null;
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp + 60) return null;
    return payload as T;
  } catch {
    return null;
  }
}

function hmac(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest();
}

export function base64Url(data: Buffer) {
  return data.toString("base64url");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  return Buffer.from(value, "base64url");
}
