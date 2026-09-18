/**
 * Host-atoms acceptance panel (add-ext-clipboard / add-ext-opener /
 * add-ext-notification).
 *
 * A real tray menu drives every public API surface and the advanced-option
 * and typed-rejection corners of the three host-atom extensions. Each
 * scenario prints an acceptance block to the console (OK/result/typed
 * payload); notification scenarios are additionally their own visual
 * evidence. The tray's primary action runs the whole suite sequentially
 * with a PASS/FAIL summary.
 *
 * Run: pnpm --filter opentray run example:hostAtoms
 * (embedded native libraries under the ext packages' platforms/ directories
 * must exist: staged by the release pipeline, or built locally with
 * `bun run scripts/binaries/build-native-job.ts --target <target>
 * --components clipboard,opener,notification`.)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createTray } from "../src/index";
import { prepareExampleBrokerBinary } from "./_support/example-runtime-mode";
import { attachClipboard } from "../../ext-clipboard/src/index";
import { attachOpener } from "../../ext-opener/src/index";
import { attachNotification } from "../../ext-notification/src/index";
import { attachDialog } from "../../ext-dialog/src/index";
import { attachSound } from "../../ext-sound/src/index";
import {
  CLIPBOARD_MAX_WRITE_UTF16,
  NOTIFICATION_BODY_LIMIT_UTF16,
  NOTIFICATION_SUBTITLE_LIMIT_UTF16,
  NOTIFICATION_TITLE_LIMIT_UTF16,
} from "../../spec/src/index";

await prepareExampleBrokerBinary(import.meta.url);

// Staged-platforms freshness preflight: `platforms/` is a gitignored build
// output, so after a version bump the embedded identity chain (manifest
// facadeVersion vs package.json) goes stale and EVERY dispatched scenario
// rejects with OPENTRAY_NATIVE_EXTENSION_MANIFEST_INVALID. Fail loudly with
// the self-service fix instead of 23 cryptic scenario errors. All stale
// packages are reported together and the fix is ONE paste-able block —
// exiting on the first mismatch would send the runner through five
// consecutive failures.
{
  const exampleDir = dirname(fileURLToPath(import.meta.url));
  // examples/ lives at <repo>/packages/cli/examples; the restage block's
  // `packages/$p` paths need cwd = <repo> (the parent of packages/).
  const repoRoot = resolve(exampleDir, "../../..");
  const stale: Array<{ pkg: string; packageVersion: string; manifestVersion: string | undefined }> = [];
  for (const pkg of ["ext-clipboard", "ext-opener", "ext-notification", "ext-dialog", "ext-sound"]) {
    const manifestUrl = new URL(`../../${pkg}/platforms/manifest.json`, `file://${exampleDir}/`);
    let manifestVersion: string | undefined;
    try {
      manifestVersion = (
        JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8")) as {
          facadeVersion?: string;
        }
      ).facadeVersion;
    } catch {
      // missing platforms/ entirely — the guidance below covers it too
    }
    const packageVersion = (
      JSON.parse(
        readFileSync(new URL(`../../${pkg}/package.json`, `file://${exampleDir}/`), "utf8"),
      ) as { version: string }
    ).version;
    if (manifestVersion !== packageVersion) {
      stale.push({ pkg, packageVersion, manifestVersion });
    }
  }
  if (stale.length > 0) {
    const details = stale
      .map(
        ({ pkg, packageVersion, manifestVersion }) =>
          `  ${pkg}: package.json ${packageVersion}   platforms/manifest.json ${manifestVersion ?? "<absent>"}`,
      )
      .join("\n");
    const restageEntries = stale.map(({ pkg, packageVersion }) => `"${pkg}@${packageVersion}"`).join(" ");
    console.error(
      `\nhost-atoms panel: staged platforms/ stale or missing for ${stale.length} package(s)\n` +
        `${details}\n` +
        `  The embedded identity chain rejects mismatched builds with\n` +
        `  OPENTRAY_NATIVE_EXTENSION_MANIFEST_INVALID on every command.\n\n` +
        `  One-paste restage from the published artifacts (exact bytes the\n` +
        `  embedded identity chain expects):\n` +
        `    cd ${repoRoot}\n` +
        `    for entry in ${restageEntries}; do\n` +
        `      p=\${entry%@*}; v=\${entry#*@}\n` +
        `      npm pack @opentray/$p@$v --pack-destination /tmp\n` +
        `      rm -rf packages/$p/platforms /tmp/package\n` +
        `      tar -xzf /tmp/opentray-$p-$v.tgz -C /tmp\n` +
        `      cp -R /tmp/package/platforms packages/$p/platforms && rm -rf /tmp/package\n` +
        `    done\n` +
        `  (or build locally: bun run scripts/binaries/build-native-job.ts\n` +
        `   --target <target> --components clipboard,opener,notification)\n`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Acceptance harness (declared before the tray: menu construction registers
// scenarios while the createTray options object evaluates)
// ---------------------------------------------------------------------------

interface Scenario {
  readonly id: number;
  readonly title: string;
  readonly run: () => Promise<string>;
  /** Interactive scenarios block on real modal/picker UI: skipped by --self-test. */
  readonly interactive: boolean;
}

const scenarios = new Map<number, Scenario>();
let nextScenarioId = 100;
function scenario(title: string, run: () => Promise<string>, interactive = false): number {
  const id = nextScenarioId++;
  scenarios.set(id, { id, title, run, interactive });
  return id;
}

function item(id: number, title: string) {
  return { type: "item" as const, id, title };
}

function formatError(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    const details = (error as { details?: unknown }).details;
    return `${(error as { code: string }).code} ${JSON.stringify(details ?? {}) ?? ""}`;
  }
  return String(error);
}

async function runScenario(scenario_: Scenario): Promise<boolean> {
  console.log(`\n──────── [${scenario_.id}] ${scenario_.title}`);
  try {
    const outcome = await scenario_.run();
    console.log(`  PASS  ${outcome}`);
    return true;
  } catch (error) {
    // Typed rejections ARE the expected outcome for the negative scenarios:
    // they report PASS only when the printed code/details match the frozen
    // contract (the human reads the payload off the console).
    console.log(`  THREW ${formatError(error)}`);
    return false;
  }
}

async function runSuite(): Promise<void> {
  const selfTest = process.argv.includes("--self-test");
  const ordered = [...scenarios.values()].sort((a, b) => a.id - b.id);
  const runnable = ordered.filter((one) => !selfTest || !one.interactive);
  let passed = 0;
  for (const one of runnable) {
    if (await runScenario(one)) passed += 1;
  }
  if (selfTest && runnable.length < ordered.length) {
    console.log(`\n  (${ordered.length - runnable.length} interactive dialog scenarios skipped in --self-test: run them from the tray menu)`);
  }
  console.log(`\n════════ suite summary: ${passed}/${runnable.length} scenarios completed without throwing`);
  // Called on a menu click, by which time `notification` is attached.
  await notification
    .notify({
      title: "Acceptance suite finished",
      body: `${passed}/${ordered.length} scenarios green — see console for the typed payloads`,
    })
    .catch(() => undefined);
}

const tray = await createTray(
  {
    id: "com.example.opentray.host-atoms",
    icon: { "text-only": "HA" },
    menu: {
      items: [
        { type: "item", id: 1, title: "Run Full Acceptance Suite", primaryEvent: true },
        { type: "separator" },
        { type: "submenu", title: "Clipboard", items: clipboardMenuItems() },
        { type: "submenu", title: "Opener", items: openerMenuItems() },
        { type: "submenu", title: "Notification", items: notificationMenuItems() },
        { type: "submenu", title: "Dialog", items: dialogMenuItems() },
        { type: "submenu", title: "Sound", items: soundMenuItems() },
        { type: "separator" },
        { type: "item", id: 3, title: "Quit Host-Atoms Panel" },
      ],
    },
  },
  { appId: "com.example.opentray.host-atoms", appName: "Host Atoms Panel" },
);

const clipboard = attachClipboard(tray, { mountId: "host-atoms-clipboard" });
const opener = attachOpener(tray, { mountId: "host-atoms-opener" });
const notification = attachNotification(tray, { mountId: "host-atoms-notification" });
const dialog = attachDialog(tray, { mountId: "host-atoms-dialog" });
const sound = attachSound(tray, { mountId: "host-atoms-sound" });

// A real file on disk for the open/reveal scenarios (Finder/Explorer
// selects it; the default app opens it).
const revealTarget = join(tmpdir(), "opentray-host-atoms-probe.txt");
writeFileSync(revealTarget, "host-atoms acceptance probe\n");
mkdirSync(join(tmpdir(), "opentray-host-atoms-dir"), { recursive: true });

// ---------------------------------------------------------------------------
// Menu builders (each item registers one scenario; the run closures capture
// the capabilities lazily — they execute on menu clicks)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clipboard scenarios (design: UTF-16 contract, null empty state, HGLOBAL laws)
// ---------------------------------------------------------------------------

function clipboardMenuItems() {
  return [
    item(
      scenario("read board (null = no text, never an error)", async () => {
        const text = await clipboard.readText();
        return `readText() -> ${text === null ? "null (first-class empty state)" : JSON.stringify(text.slice(0, 80))}`;
      }),
      "Read board",
    ),
    item(
      scenario("write surrogate-pair text (emoji round trip)", async () => {
        await clipboard.writeText("host-atoms 🎉 clipboard probe");
        const back = await clipboard.readText();
        if (back !== "host-atoms 🎉 clipboard probe") {
          throw new Error(`round trip broke: ${JSON.stringify(back)}`);
        }
        return "write 🎉 + read back byte-identical (paste anywhere to observe cross-process)";
      }),
      "Write emoji + read back",
    ),
    item(
      scenario("write EMPTY string — a write, not a clear", async () => {
        await clipboard.writeText("");
        const back = await clipboard.readText();
        if (back !== "") {
          throw new Error(`empty write must read back "", got ${JSON.stringify(back)}`);
        }
        return `read back ${JSON.stringify(back)} ("" — distinct from clear's null)`;
      }),
      "Write empty string",
    ),
    item(
      scenario("clear board (reads back null)", async () => {
        await clipboard.clear();
        const back = await clipboard.readText();
        if (back !== null) {
          throw new Error(`cleared board must read null, got ${JSON.stringify(back)}`);
        }
        return "clear() -> readText() === null";
      }),
      "Clear board",
    ),
    item(
      scenario(`write exactly ${CLIPBOARD_MAX_WRITE_UTF16} UTF-16 units (frozen cap boundary)`, async () => {
        await clipboard.writeText("a".repeat(CLIPBOARD_MAX_WRITE_UTF16));
        return `wrote ${CLIPBOARD_MAX_WRITE_UTF16} units in one command (legal boundary)`;
      }),
      "Write 1 MiB boundary",
    ),
    item(
      scenario("write over the cap -> typed clipboard_payload_too_large", async () => {
        await clipboard.writeText("a".repeat(CLIPBOARD_MAX_WRITE_UTF16 + 1));
        return "UNEXPECTED: over-cap write resolved";
      }),
      "OVER cap (typed reject)",
    ),
    item(
      scenario('write lone surrogate "\\uD83D" -> typed clipboard_payload_invalid', async () => {
        // eslint-disable-next-line no-control-regex
        await clipboard.writeText("\ud83d");
        return "UNEXPECTED: lone surrogate resolved";
      }),
      "Lone surrogate (typed reject)",
    ),
    item(
      scenario("getBackend() frozen snapshot", async () => {
        const backend = await clipboard.getBackend();
        return `maxWriteUtf16=${backend.maxWriteUtf16} textOnly=${backend.textOnly} boundedOpenRetry=${backend.boundedOpenRetry} platform=${backend.platform}`;
      }),
      "Backend snapshot",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Opener scenarios (design: frozen path matrix, scheme allowlist, root laws)
// ---------------------------------------------------------------------------

function openerMenuItems() {
  return [
    item(
      scenario("open https URL in the default browser", async () => {
        await opener.open("https://example.com/");
        return "resolve-on-acceptance: browser presentation is the visual check";
      }),
      "Open https://example.com",
    ),
    item(
      scenario("open a file: URL verbatim (never normalized to a path)", async () => {
        await opener.open(`file://${revealTarget}`);
        return "file: dispatched as-is (default app is the visual check)";
      }),
      "Open file: URL",
    ),
    item(
      scenario("open mailto: through the default mail client", async () => {
        await opener.open("mailto:hi@example.com?subject=host-atoms");
        return "mailto accepted (mail client is the visual check)";
      }),
      "Open mailto:",
    ),
    item(
      scenario("open an absolute path with the default app", async () => {
        await opener.open(revealTarget);
        return "absolute path dispatched verbatim (TextEdit/notepad is the visual check)";
      }),
      "Open file by path",
    ),
    item(
      scenario("reveal the probe file (selected) in Finder/Explorer", async () => {
        await opener.revealInFolder(revealTarget);
        return "file manager opens with the file selected (default behavior; visual check)";
      }),
      "Reveal + select file",
    ),
    item(
      scenario("reveal the tmp ROOT (root law: opens the root itself, never trimmed)", async () => {
        await opener.revealInFolder(tmpdir());
        return "root reveal = open the root folder (visual check)";
      }),
      "Reveal root (root law)",
    ),
    item(
      scenario("reveal a directory (opens the folder itself)", async () => {
        await opener.revealInFolder(join(tmpdir(), "opentray-host-atoms-dir"));
        return "directory reveal = open the folder (visual check)";
      }),
      "Reveal directory",
    ),
    item(
      scenario("open ftp:// -> typed opener_scheme_blocked {scheme:'ftp'}", async () => {
        await opener.open("ftp://example.com/");
        return "UNEXPECTED: blocked scheme resolved";
      }),
      "Blocked scheme (typed reject)",
    ),
    item(
      scenario("open relative path -> typed opener_target_invalid {reason:'relative'}", async () => {
        await opener.open("relative/notes.txt");
        return "UNEXPECTED: relative resolved";
      }),
      "Relative path (typed reject)",
    ),
    item(
      scenario('reveal path containing a quote -> typed {reason:\'path-quote\'}', async () => {
        await opener.revealInFolder('/tmp/e"vil.txt');
        return "UNEXPECTED: quote path resolved";
      }),
      "Quote in path (typed reject)",
    ),
    item(
      scenario("getBackend() frozen snapshot", async () => {
        const backend = await opener.getBackend();
        return `allowedSchemes=${backend.allowedSchemes.join("/")}`;
      }),
      "Backend snapshot",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Notification scenarios (design: 64/256/64 UTF-16, subtitle join, deferred auth)
// ---------------------------------------------------------------------------

function notificationMenuItems() {
  return [
    item(
      scenario("notify — title only", async () => {
        await notification.notify({ title: "host-atoms: title only" });
        return "banner is the visual check";
      }),
      "Notify: title only",
    ),
    item(
      scenario("notify — title + body", async () => {
        await notification.notify({ title: "host-atoms", body: "title + body notification" });
        return "banner is the visual check";
      }),
      "Notify: + body",
    ),
    item(
      scenario("notify — + subtitle (darwin native field / win32 em-dash join)", async () => {
        await notification.notify({
          title: "host-atoms",
          subtitle: "CI",
          body: "subtitle projects natively on darwin, joins with an em dash on win32",
        });
        return "subtitle presentation differs per platform (documented degradation)";
      }),
      "Notify: + subtitle",
    ),
    item(
      scenario("notify — subtitle only, no body (never a dangling separator)", async () => {
        await notification.notify({ title: "host-atoms", subtitle: "subtitle alone" });
        return "win32 shows the subtitle alone — no trailing em dash";
      }),
      "Notify: subtitle only",
    ),
    item(
      scenario("notify — silent (no sound)", async () => {
        await notification.notify({ title: "host-atoms", body: "this one is silent", silent: true });
        return "banner without the alert sound";
      }),
      "Notify: silent",
    ),
    item(
      scenario(`notify — exact frozen boundaries ${NOTIFICATION_TITLE_LIMIT_UTF16}/${NOTIFICATION_BODY_LIMIT_UTF16}/${NOTIFICATION_SUBTITLE_LIMIT_UTF16}`, async () => {
        await notification.notify({
          title: "t".repeat(NOTIFICATION_TITLE_LIMIT_UTF16),
          body: "b".repeat(NOTIFICATION_BODY_LIMIT_UTF16),
          subtitle: "s".repeat(NOTIFICATION_SUBTITLE_LIMIT_UTF16),
        });
        return "boundary-exact payload accepted, never truncated";
      }),
      "Notify: exact boundaries",
    ),
    item(
      scenario(`notify — ${NOTIFICATION_TITLE_LIMIT_UTF16 + 1}-unit title -> typed notification_payload_invalid`, async () => {
        await notification.notify({ title: "t".repeat(NOTIFICATION_TITLE_LIMIT_UTF16 + 1) });
        return "UNEXPECTED: over-limit title resolved";
      }),
      "OVER-limit title (typed reject)",
    ),
    item(
      scenario(`notify — ${NOTIFICATION_BODY_LIMIT_UTF16 + 1}-unit body -> typed notification_payload_invalid`, async () => {
        await notification.notify({ title: "t", body: "b".repeat(NOTIFICATION_BODY_LIMIT_UTF16 + 1) });
        return "UNEXPECTED: over-limit body resolved";
      }),
      "OVER-limit body (typed reject)",
    ),
    item(
      scenario("notify — unknown field -> typed notification_payload_invalid {field}", async () => {
        await notification.notify({ title: "t", mystery: true } as never);
        return "UNEXPECTED: unknown field resolved";
      }),
      "Unknown field (typed reject)",
    ),
    item(
      scenario(
        "requestAuthorization() — darwin prompts (or returns the real decision); win32 always true. " +
          "NOTE darwin: an unsigned non-bundled example process may get nsError 1 from UNUserNotificationCenter " +
          "(the OS requires a properly signed app bundle) — that typed notification_failed is itself correct behavior",
        async () => {
          const granted = await notification.requestAuthorization();
          return `granted=${granted} (darwin: real user decision; win32: documented always-true)`;
        },
      ),
      "Request authorization",
    ),
    item(
      scenario("getAuthorizationStatus()", async () => {
        const status = await notification.getAuthorizationStatus();
        return `status=${status} (granted | denied | notDetermined)`;
      }),
      "Authorization status",
    ),
    item(
      notificationEnvironmentProbeScenario(),
      "Environment probe (darwin signing)",
    ),
    item(
      scenario("getBackend() frozen snapshot", async () => {
        const backend = await notification.getBackend();
        return (
          `platform=${backend.platform} channel=${backend.channel} authorizationModel=${backend.authorizationModel} ` +
          `titleLimitUtf16=${backend.titleLimitUtf16} supportsSubtitle=${backend.supportsSubtitle}`
        );
      }),
      "Backend snapshot",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Dialog scenarios (ext-dialog: modal surfaces through the deferred
// transaction — every scenario's visual check IS the dialog)
// ---------------------------------------------------------------------------

function dialogMenuItems() {
  return [
    item(
      scenario("alert — one-button modal", async () => {
        await dialog.alert("host-atoms: alert", { detail: "the one-button sugar modal" });
        return "modal appeared and was dismissed (visual check)";
      }, true),
      "Alert",
    ),
    item(
      scenario("confirm — two-button modal returning the button", async () => {
        const yes = await dialog.confirm("host-atoms: confirm?", { severity: "warning" });
        return `response=${yes} (the button you clicked)`;
      }, true),
      "Confirm",
    ),
    item(
      scenario("messageDialog — full options (buttons/default/cancel/severity/suppression)", async () => {
        const result = await dialog.messageDialog({
          message: "Apply the staged changes?",
          detail: "messageDialog exercises the complete MessageDialogOptions surface",
          buttons: ["Review", "Apply", "Cancel"],
          defaultId: 1,
          cancelId: 2,
          severity: "info",
          suppressionLabel: "Remember my choice",
        });
        return `response=${JSON.stringify(result)} (suppression checkbox is part of the result)`;
      }, true),
      "MessageDialog (full)",
    ),
    item(
      scenario("pickFile — single + multiple pickers (filters, defaultPath)", async () => {
        const single = await dialog.pickFile({ filters: [{ name: "Text", extensions: ["txt", "md"] }] });
        const many = await dialog.pickFile({
          multiple: true,
          defaultPath: revealTarget,
        });
        return `single=${JSON.stringify(single)} multiple=${JSON.stringify(many)} (cancel = null, first-class)`;
      }, true),
      "Pick files",
    ),
    item(
      scenario("pickDirectory + pickSavePath (fileNameLabel, filters)", async () => {
        const dir = await dialog.pickDirectory({ title: "host-atoms: choose a directory" });
        const save = await dialog.pickSavePath({
          fileNameLabel: "host-atoms-report",
          filters: [],
        });
        return `dir=${JSON.stringify(dir)} save=${JSON.stringify(save)} (save canonicalizes against its parent)`;
      }, true),
      "Pick directory / save path",
    ),
    item(
      scenario("getBackend() frozen snapshot", async () => {
        const backend = await dialog.getBackend();
        return `platform=${backend.platform} modalEngine=${(backend as { modalEngine?: string }).modalEngine ?? "n/a"}`;
      }),
      "Backend snapshot",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Sound scenarios (ext-sound: OS feedback atoms — audibility IS the check)
// ---------------------------------------------------------------------------

function soundMenuItems() {
  return [
    item(
      scenario('beep — every kind (default/info/warning/error/question)', async () => {
        for (const kind of ["default", "info", "warning", "error", "question"] as const) {
          await sound.beep(kind);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        return "five system beeps played in sequence (audibility is the check)";
      }),
      "Beep: all kinds",
    ),
    item(
      scenario('playSystemSound — common names (notification/warning/error)', async () => {
        for (const name of ["notification", "warning", "error"] as const) {
          await sound.playSystemSound(name);
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
        return "three common-name sounds played (audibility is the check)";
      }),
      "System sounds: common",
    ),
    item(
      scenario("playSystemSound — one platform-native name + one guaranteed miss", async () => {
        const native = process.platform === "win32" ? "SystemHand" : "Basso";
        await sound.playSystemSound(native).catch(() => undefined);
        try {
          await sound.playSystemSound("DefinitelyNotASoundNameXYZ");
          return "UNEXPECTED: guaranteed miss resolved";
        } catch (error) {
          return `miss rejected typed: ${formatError(error)}`;
        }
      }),
      "Native name + typed miss",
    ),
    item(
      scenario("playSound — a generated WAV file (440 Hz sine, 150 ms; darwin NSSound / win32 RIFF path)", async () => {
        // Synthesize a real, minimal 16-bit PCM mono 8 kHz WAV at runtime —
        // no fixture file, valid on both platforms (win32 runs its exact
        // RIFF structural validation against it).
        const sampleRate = 8000;
        const durationSeconds = 0.15;
        const sampleCount = Math.floor(sampleRate * durationSeconds);
        const dataSize = sampleCount * 2;
        const buffer = Buffer.alloc(44 + dataSize);
        buffer.write("RIFF", 0, "ascii");
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write("WAVE", 8, "ascii");
        buffer.write("fmt ", 12, "ascii");
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20); // PCM
        buffer.writeUInt16LE(1, 22); // mono
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
        buffer.writeUInt16LE(2, 32); // block align
        buffer.writeUInt16LE(16, 34); // bits per sample
        buffer.write("data", 36, "ascii");
        buffer.writeUInt32LE(dataSize, 40);
        for (let index = 0; index < sampleCount; index += 1) {
          const amplitude = 0.5 * 32767 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
          buffer.writeInt16LE(Math.round(amplitude), 44 + index * 2);
        }
        const wavPath = join(tmpdir(), "opentray-host-atoms-probe.wav");
        writeFileSync(wavPath, buffer);
        await sound.playSound(wavPath);
        await new Promise((resolve) => setTimeout(resolve, 400));
        return `${buffer.length} bytes at ${wavPath} — a 440 Hz tone should have just played (audibility is the check)`;
      }),
      "Play generated WAV",
    ),
    item(
      scenario("getBackend() frozen snapshot", async () => {
        const backend = await sound.getBackend();
        return `platform=${backend.platform} commonNames=${(backend as { commonSystemSoundNames?: readonly string[] }).commonSystemSoundNames?.join("/") ?? "n/a"}`;
      }),
      "Backend snapshot",
    ),
  ];
}

// ---------------------------------------------------------------------------
// Notification environment probe (darwin macOS 26 signing reality)
// ---------------------------------------------------------------------------

function notificationEnvironmentProbeScenario(): number {
  return scenario(
    "notification environment probe — darwin carrier signing reality (macOS 26)",
    async () => {
      const status = await notification.getAuthorizationStatus();
      const backend = await notification.getBackend();
      if (backend.platform !== "darwin") {
        return `win32: authorization is the documented always-granted projection (status=${status})`;
      }
      const lines = [
        `authorizationStatus=${status}`,
        "darwin facts (empirical, macOS 26.5): the UN center refuses authorization for",
        "ad-hoc/linker-signed carriers in every launch shape — so every post triages the",
        "process's code-signature class first: a properly signed app posts through the UN",
        "center (full experience); an unsigned carrier posts through the osascript",
        "display-notification bridge (Apple-signed host, always allowed; banners attribute",
        "to the osascript icon — the documented degradation). Authorization commands keep",
        "their honest UN semantics; a denied state still rejects typed with zero delivery.",
      ];
      return lines.join("\n         ");
    },
  );
}

tray.onMenuClick(({ itemId }) => {
  const one = scenarios.get(itemId);
  if (one !== undefined) {
    void runScenario(one);
    return;
  }
  if (itemId === 1) {
    void runSuite();
    return;
  }
  if (itemId === 3) {
    void tray.destroy();
  }
});

console.log(`
host-atoms acceptance panel is running (tray icon: HA)

  • Click the tray icon for the scenario menus (Clipboard / Opener / Notification)
  • The primary action "Run Full Acceptance Suite" executes everything sequentially
  • Every scenario prints an acceptance block here: PASS + outcome, or the typed
    rejection's code and details payload (the negative scenarios are DESIGNED to
    throw — read the printed code against the frozen contract)
  • Notification scenarios double as their own visual evidence (banner + sound)
  • Opener scenarios open real browser/Finder windows — the visual check
  • Ctrl-C exits (or menu: Quit Host-Atoms Panel)
`);

if (process.argv.includes("--self-test")) {
  // Headless-ish validation mode: run every scenario once, print the
  // summary, exit. Notification banners and opener windows still present
  // on the real desktop (that is the point); the exit makes CI/loop runs
  // deterministic.
  console.log("self-test: running the full suite, then exiting…");
  await runSuite();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await tray.destroy();
}
