// Source-resource import (openspec change unify-create-opentray-core).
//
// Uploaded files, HTTP URLs, and Data URLs normalize into validated sibling
// files inside the registration directory. `create-opentray.json` references
// them relatively and records provenance plus a content hash. An unchanged
// remote source reuses its committed local snapshot — URL drift can never
// silently change an icon during an unrelated edit.

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { IconResourceRef, ImageFormat } from "./config";
import { err, ok, type Result } from "./errors";
import { ensureLoopbackNoProxy } from "./port-scan";

export type ResourceInput =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "http"; readonly url: string }
  | { readonly kind: "data"; readonly dataUrl: string }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array; readonly name?: string };

export type IconRole = "appIcon" | "trayIcon";

const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
  svg: "svg",
};

/** Sniff the true image format from magic bytes (never trust extensions). */
export const detectImageFormat = (bytes: Uint8Array): ImageFormat | undefined => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "gif";
  }
  // SVG sniffing: leading BOM/whitespace, then `<` (with optional xml decl).
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 512))
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!doctype svg")) {
    if (head.includes("<svg")) {
      return "svg";
    }
  }
  return undefined;
};

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([a-z0-9+/=]+)$/iu;

export interface ParsedDataUrl {
  readonly bytes: Uint8Array;
  readonly format: ImageFormat;
}

/** Parse a strict `data:image/<format>;base64,<payload>` URL. */
export const parseDataImageUrl = (dataUrl: string): Result<ParsedDataUrl> => {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (match === null) {
    return err(
      "resource_invalid",
      "data URL must be data:image/(png|jpeg|webp|gif|svg+xml);base64,<payload>",
    );
  }
  const rawFormat = match[1]!.toLowerCase();
  const format: ImageFormat = rawFormat === "jpg" ? "jpeg" : rawFormat === "svg+xml" ? "svg" : (rawFormat as ImageFormat);
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(match[2]!, "base64");
  } catch (error) {
    return err("resource_invalid", `data URL payload is not valid base64: ${error instanceof Error ? error.message : String(error)}`);
  }
  return ok({ bytes, format });
};

const fetchHttpBytes = async (url: string): Promise<Result<Uint8Array>> => {
  if (!/^https?:\/\//iu.test(url)) {
    return err("resource_invalid", `HTTP icon source must be an http(s) URL: ${url}`);
  }
  ensureLoopbackNoProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      return err("resource_fetch_failed", `fetching ${url} failed with HTTP ${response.status}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    return ok(buffer);
  } catch (error) {
    return err(
      "resource_fetch_failed",
      `fetching ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
};

export interface ImportResourceOptions {
  /** Registration directory receiving the committed snapshot. */
  readonly registrationDir: string;
  /** Stable sibling filename prefix, e.g. "app-icon". */
  readonly filename: string;
}

export interface ImportedResource {
  readonly ref: IconResourceRef;
  readonly bytesHash: string;
  /** True when an identical committed snapshot was reused unchanged. */
  readonly reused: boolean;
}

/**
 * Import one source resource into the registration directory.
 *
 * Byte-format validation always runs against magic bytes (declared format
 * is never trusted). The snapshot is committed through a sibling temp file
 * so a failed write can never publish a truncated resource.
 */
export const importResource = async (
  input: ResourceInput,
  options: ImportResourceOptions,
): Promise<Result<ImportedResource>> => {
  let bytes: Uint8Array;
  let source: IconResourceRef["source"];
  if (input.kind === "file") {
    try {
      bytes = new Uint8Array(await readFile(input.path));
    } catch (error) {
      return err("resource_invalid", `cannot read icon file ${input.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    source = { kind: "file", ref: input.path };
  } else if (input.kind === "http") {
    const fetched = await fetchHttpBytes(input.url);
    if (!fetched.ok) {
      return fetched;
    }
    bytes = fetched.value;
    source = { kind: "http", ref: input.url };
  } else if (input.kind === "data") {
    const parsed = parseDataImageUrl(input.dataUrl);
    if (!parsed.ok) {
      return parsed;
    }
    bytes = parsed.value.bytes;
    source = { kind: "data", ref: input.dataUrl.slice(0, 64) };
  } else {
    bytes = input.bytes;
    source = { kind: "data", ref: input.name === undefined ? "upload" : `upload:${input.name}` };
  }

  const sniffed = detectImageFormat(bytes);
  if (sniffed === undefined) {
    return err(
      "resource_invalid",
      `icon bytes are not a recognized raster/SVG image (sniff failed) for ${options.filename}`,
    );
  }
  const format = sniffed;
  const bytesHash = createHash("sha256").update(bytes).digest("hex");
  const path = `${options.filename}.${FORMAT_EXTENSIONS[format]}`;

  // Stable-snapshot reuse: identical committed bytes keep the existing file.
  const committed = join(options.registrationDir, path);
  try {
    const existing = new Uint8Array(await readFile(committed));
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existingHash === bytesHash) {
      return ok({
        ref: { path, format, sha256: bytesHash, source },
        bytesHash,
        reused: true,
      });
    }
  } catch {
    // no committed snapshot yet
  }

  const temp = `${committed}.tmp-${bytesHash.slice(0, 8)}`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, committed);
  } catch (error) {
    return err(
      "registry_io",
      `cannot commit icon snapshot ${committed}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return ok({
    ref: { path, format, sha256: bytesHash, source },
    bytesHash,
    reused: false,
  });
};

/**
 * Resolve the committed snapshot referenced by a config resource, verifying
 * its bytes still match the recorded hash (drift detection).
 */
export const readResourceBytes = async (
  registrationDir: string,
  ref: IconResourceRef,
): Promise<Result<Uint8Array>> => {
  try {
    const bytes = new Uint8Array(await readFile(join(registrationDir, ref.path)));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== ref.sha256) {
      return err(
        "resource_invalid",
        `committed resource ${ref.path} no longer matches its recorded hash (expected ${ref.sha256}, found ${hash})`,
        { path: ref.path },
      );
    }
    return ok(bytes);
  } catch (error) {
    return err(
      "resource_invalid",
      `cannot read committed resource ${ref.path}: ${error instanceof Error ? error.message : String(error)}`,
      { path: ref.path },
    );
  }
};
