/**
 * RFC 8785 (JSON Canonicalization Scheme, "JCS") encoder.
 *
 * This is the single canonical byte standard for OpenTray message-channel
 * payload accounting and any other cross-language byte-exact JSON contract:
 * string payloads count raw UTF-8 bytes, JSON payloads count the UTF-8 bytes
 * of their RFC 8785 serialization (see `channel.ts`). The Rust mirror in
 * `crates/opentray-spec/src/canonical_json.rs` must produce identical bytes;
 * both implementations are verified against the shared fixtures in
 * `fixtures/canonical-json/` (input value + expected canonical text).
 *
 * Encoding rules (RFC 8785 §3.2.2–3.2.3):
 * - Objects: keys sorted by UTF-16 code unit order (the ECMAScript `<`
 *   string comparison), no whitespace.
 * - Strings: only `"` and `\` plus C0 control characters are escaped, using
 *   the short forms `\b \t \n \f \r` and lowercase-hex `\u00xx` otherwise;
 *   all other characters appear literally.
 * - Numbers: serialized exactly like ECMAScript `Number::toString` (e.g.
 *   `-0` → `0`, `1.0` → `1`, `1e21` → `1e+21`, `1e-7` → `1e-7`).
 * - `true`, `false`, `null` keep their spellings; arrays keep element order.
 *
 * The encodable value domain is the RFC 8785 domain: `null`, booleans, finite
 * numbers, strings, arrays, and JSON objects. NaN, Infinity, `undefined`,
 * functions, symbols, and bigints are rejected as invalid values — callers
 * map that rejection to the typed protocol error `invalid_payload`.
 */

export type CanonicalJsonEncodeResult =
  | { readonly ok: true; readonly text: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: string };

const textEncoder = new TextEncoder();

const invalid = (error: string): CanonicalJsonEncodeResult => ({ ok: false, error });

/** Encodes one JSON value to its RFC 8785 canonical form (text + UTF-8 bytes). */
export const canonicalJsonEncode = (value: unknown): CanonicalJsonEncodeResult => {
  let text: string;
  try {
    text = writeCanonicalValue(value);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "invalid canonical JSON value");
  }
  return { ok: true, text, bytes: textEncoder.encode(text) };
};

/** Byte count of the RFC 8785 serialization; rejects the same invalid values. */
export const canonicalJsonByteCount = (value: unknown): number => {
  const result = canonicalJsonEncode(value);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.bytes.byteLength;
};

/** UTF-8 byte length of a string without canonicalization (string payloads). */
export const utf8ByteCount = (value: string): number => textEncoder.encode(value).byteLength;

const writeCanonicalValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return writeCanonicalNumber(value);
    case "string":
      return writeCanonicalString(value);
    case "object":
      return Array.isArray(value) ? writeCanonicalArray(value) : writeCanonicalObject(value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
    default:
      throw new Error(
        `value is outside the RFC 8785 domain (got ${typeof value}); post it as a string or JSON value`,
      );
  }
};

const writeCanonicalNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new Error("NaN and Infinity are outside the RFC 8785 domain");
  }
  // ECMAScript Number::toString is exactly the RFC 8785 number grammar,
  // including `-0` → `0`, `1.0` → `1`, and the `1e+21` / `1e-7` exponent forms.
  return String(value);
};

const writeCanonicalString = (value: string): string => {
  let out = '"';
  for (const ch of value) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) {
      throw new Error("unreachable: for-of always yields characters");
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      // for-of yields unpaired surrogates as single characters; RFC 8785
      // input must be valid Unicode, so reject instead of corrupting bytes.
      throw new Error("lone surrogate is outside the RFC 8785 domain");
    }
    switch (codePoint) {
      case 0x22: // "
        out += '\\"';
        break;
      case 0x5c: // backslash
        out += "\\\\";
        break;
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      default:
        if (codePoint < 0x20) {
          out += `\\u${codePoint.toString(16).padStart(4, "0")}`;
        } else {
          out += ch;
        }
    }
  }
  return `${out}"`;
};

const writeCanonicalArray = (value: readonly unknown[]): string => {
  const parts: string[] = [];
  for (const element of value) {
    parts.push(writeCanonicalValue(element));
  }
  return `[${parts.join(",")}]`;
};

const writeCanonicalObject = (value: object): string => {
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const parts: string[] = [];
  for (const key of keys) {
    const property = record[key];
    // A JSON object member with an undefined/function/symbol value cannot be
    // serialized; reject rather than silently dropping members.
    const serializedProperty = writeCanonicalValue(property);
    parts.push(`${writeCanonicalString(key)}:${serializedProperty}`);
  }
  return `{${parts.join(",")}}`;
};
