import { parseServerFrame, type ServerFrame } from "../src/index";

const readyFrame = JSON.stringify({
  type: "ready",
  version: 1,
} satisfies ServerFrame);

const parsedReady = parseServerFrame(readyFrame);
if (!parsedReady.ok) {
  throw new Error(`expected ready frame to parse: ${parsedReady.error}`);
}

console.log(`parsed server frame: ${JSON.stringify(parsedReady.frame)}`);

const parsedMalformed = parseServerFrame("{not-json");
if (parsedMalformed.ok) {
  throw new Error("expected malformed frame to fail parsing");
}

console.log(`malformed frame rejected: ${parsedMalformed.error}`);
