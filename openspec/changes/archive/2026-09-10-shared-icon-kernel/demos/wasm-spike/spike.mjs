import { readFileSync, writeFileSync } from "node:fs";
const check = (n, ok, d = "") => console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`);
const { init } = await import("@jsquash/png/decode.js");
await init(readFileSync(new URL("./node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm", import.meta.url)));
const { Resvg, initWasm } = await import("@resvg/resvg-wasm");
await initWasm(readFileSync(new URL("./node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)));
const { decode, encode } = await import("@jsquash/png");
const resizeMod = await import("@jsquash/resize");
await resizeMod.initResize(readFileSync(new URL("./node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm", import.meta.url)));

const fonts = [
  readFileSync("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
  readFileSync("/System/Library/Fonts/STHeiti Light.ttc"),
];
const render = (ch) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="192" fill="#0A84FF"/><text x="512" y="512" font-family="Embedded" font-size="560" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${ch}</text></svg>`;
  return new Resvg(svg, {
    font: { loadSystemFonts: false, fontBuffers: fonts, defaultFontFamily: "Embedded" },
    background: "rgba(0,0,0,0)",
  }).render().asPng();
};

for (const ch of ["A", "笔"]) {
  const img = await decode(render(ch));
  let white = 0, opaque = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const [r, g, b, a] = [img.data[i], img.data[i+1], img.data[i+2], img.data[i+3]];
    if (a > 200) opaque++;
    if (a > 200 && r > 230 && g > 230 && b > 230) white++;
  }
  const total = img.width * img.height;
  check(`glyph "${ch}" letter pixels present`, white / total > 0.02, `white=${(white/total*100).toFixed(1)}% opaque=${(opaque/total*100).toFixed(1)}%`);
  if (ch === "A") {
    const small = await resizeMod.default(img, { width: 824, height: 824, method: "lanczos3" });
    writeFileSync(new URL("./spike-glyph-A-824.png", import.meta.url), new Uint8Array(await encode(small)));
  }
}
