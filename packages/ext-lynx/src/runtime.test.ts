import { afterEach, describe, expect, it } from "vitest";
import { runInThisContext } from "node:vm";

import { installLynxWindowApiFromHost } from "./runtime";

interface NativeModuleShape {
  invoke(payload: string): string;
}

interface NativeModulesShape {
  OpenTrayWindowModule?: NativeModuleShape;
}

interface RuntimeTestGlobals {
  NativeModules?: NativeModulesShape;
  __OPENTRAY_TEST_NATIVE_MODULES__?: NativeModulesShape;
}

const testGlobals = globalThis as RuntimeTestGlobals;
const lexicalNativeModules: NativeModulesShape = {};

const installLexicalNativeModules = (modules: NativeModulesShape) => {
  for (const key of Object.keys(lexicalNativeModules) as Array<
    keyof NativeModulesShape
  >) {
    delete lexicalNativeModules[key];
  }
  Object.assign(lexicalNativeModules, modules);
  testGlobals.__OPENTRAY_TEST_NATIVE_MODULES__ = lexicalNativeModules;
  delete testGlobals.NativeModules;
  try {
    runInThisContext(
      "let NativeModules = globalThis.__OPENTRAY_TEST_NATIVE_MODULES__;",
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
};

afterEach(() => {
  delete testGlobals.NativeModules;
  delete lexicalNativeModules.OpenTrayWindowModule;
});

describe("@opentray/ext-lynx runtime bridge", () => {
  it("connects through Lynx lexical NativeModules when globalThis.NativeModules is absent", async () => {
    const calls: unknown[] = [];
    installLexicalNativeModules({
      OpenTrayWindowModule: {
        invoke(payload) {
          calls.push(JSON.parse(payload));
          return JSON.stringify({
            ok: true,
            result: {
              windowApiEnabled: true,
              screenApiEnabled: true,
              globalBindingsEnabled: false,
              screenBindingsEnabled: false,
              frameless: false,
              transparent: false,
              blur: false,
            },
          });
        },
      },
    });

    const bridge = await installLynxWindowApiFromHost();

    expect(bridge.window).toBeDefined();
    expect(bridge.screen).toBeDefined();
    expect(calls).toEqual([{ cmd: "getCapabilities", payload: {} }]);
  });
});
