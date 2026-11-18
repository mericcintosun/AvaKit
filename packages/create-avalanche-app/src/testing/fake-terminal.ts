/**
 * Test helper: stand-ins for the terminal streams, so the Ink wizard can be
 * rendered and driven with keystrokes inside a test. The same approach as
 * ink-testing-library, kept local because it is forty lines and saves a
 * dependency.
 */

import { EventEmitter } from "node:events";
import type { RenderOptions } from "ink";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class FakeStdout extends EventEmitter {
  readonly columns = 100;
  readonly rows = 50;
  readonly isTTY = true;
  frames: string[] = [];
  write = (frame: string): boolean => {
    this.frames.push(frame);
    return true;
  };
}

class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  private pending: string | null = null;
  send(input: string): void {
    this.pending = input;
    this.emit("readable");
  }
  // Ink drains the stream by calling read() until it returns null.
  read = (): string | null => {
    const input = this.pending;
    this.pending = null;
    return input;
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

export const KEY = {
  enter: "\r",
  down: "\u001b[B",
  up: "\u001b[A",
} as const;

export interface FakeTerminal {
  /** Pass to Ink's `render`. */
  renderOptions: RenderOptions;
  /** The screen as last drawn, without escape codes. */
  frame(): string;
  /** Type text or send a key from `KEY`. Wait for the screen to react before the next one. */
  press(input: string): void;
  /**
   * Resolve once the latest frame contains `text` and the wizard is ready for
   * input again; reject after `timeoutMs`.
   */
  waitFor(text: string, timeoutMs?: number): Promise<void>;
}

/**
 * Ink draws a frame when React commits, but the components on it only start
 * listening for keys in the effects that run just after. A key sent in between
 * is lost, so give those effects their turn before reporting the frame as ready.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 15));
}

export function fakeTerminal(): FakeTerminal {
  const stdout = new FakeStdout();
  const stderr = new FakeStdout();
  const stdin = new FakeStdin();
  const clean = (text: string) => text.replace(ANSI, "");
  // Ink's last write on exit only restores the cursor, so skip writes with no
  // text: after the wizard has exited this is still the final screen it drew.
  const frame = () => stdout.frames.map(clean).findLast((written) => written.trim() !== "") ?? "";
  return {
    renderOptions: {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      // Each update is written out in full, so the last frame is the screen.
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
    frame,
    press: (input) => stdin.send(input),
    waitFor: async (text, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (!frame().includes(text)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for "${text}". Last frame:\n${frame()}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await settle();
    },
  };
}
