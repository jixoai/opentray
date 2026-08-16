/**
 * ghostty-web terminal mount with an objective data path:
 * server SSE strings → term.write(data) verbatim; term.onData(data) → POST
 * verbatim. The renderer owns every byte's interpretation.
 */
import * as React from "react";

type GhosttyModule = typeof import("ghostty-web");

// Shared import+init promise: prewarming at page load means the terminal is
// ready the instant the user clicks Run instead of racing the first output.
let ghosttyReady: Promise<GhosttyModule> | undefined;

export const prewarmGhostty = (): void => {
  ghosttyReady ??= (async () => {
    const ghostty = (await import("ghostty-web")) as GhosttyModule;
    await ghostty.init();
    return ghostty;
  })();
};

export interface TerminalHandle {
  write(data: string): void;
  reset(): void;
  fit(): void;
  focus(): void;
  /** Cursor position and selection range for the status bar. */
  readState(): {
    cols: number;
    rows: number;
    cursorX: number;
    cursorY: number;
    selection?: { start: { x: number; y: number }; end: { x: number; y: number } };
  };
  onData(listener: (data: string) => void): () => void;
  onResize(listener: (size: { cols: number; rows: number }) => void): () => void;
  dispose(): void;
}

export async function createGhosttyTerminal(
  host: HTMLElement,
): Promise<TerminalHandle | undefined> {
  let ghostty: GhosttyModule;
  try {
    prewarmGhostty();
    ghostty = await ghosttyReady!;
  } catch {
    return undefined;
  }

  const terminal = new ghostty.Terminal({
    fontSize: 13,
    theme: {
      background: "#05070b",
      foreground: "#b7c3d8",
      cursor: "#3d8bff",
      selectionBackground: "#2a3550",
    },
  });
  terminal.open(host);
  const fit = new ghostty.FitAddon();
  terminal.loadAddon(fit);
  fit.fit();

  const dataListeners = new Set<(data: string) => void>();
  const resizeListeners = new Set<(size: { cols: number; rows: number }) => void>();
  const offData = terminal.onData((data) => {
    for (const listener of dataListeners) listener(data);
  });
  const offResize = terminal.onResize(({ cols, rows }) => {
    for (const listener of resizeListeners) listener({ cols, rows });
  });

  const ro = new ResizeObserver(() => {
    try {
      fit.fit();
    } catch {
      // container may be mid-unmount
    }
  });
  ro.observe(host);

  return {
    write: (data) => terminal.write(data),
    reset: () => terminal.reset(),
    fit: () => fit.fit(),
    focus: () => host.querySelector("canvas")?.dispatchEvent(new Event("focus")),
    readState: () => {
      const buffer = terminal.buffer.active;
      const selectionPosition = terminal.getSelectionPosition();
      return {
        cols: terminal.cols,
        rows: terminal.rows,
        cursorX: buffer.cursorX,
        cursorY: buffer.cursorY,
        ...(selectionPosition === undefined
          ? {}
          : {
              selection: {
                start: { x: selectionPosition.start.x, y: selectionPosition.start.y },
                end: { x: selectionPosition.end.x, y: selectionPosition.end.y },
              },
            }),
      };
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onResize(listener) {
      resizeListeners.add(listener);
      return () => resizeListeners.delete(listener);
    },
    dispose() {
      ro.disconnect();
      offData.dispose();
      offResize.dispose();
      terminal.dispose();
    },
  };
}
