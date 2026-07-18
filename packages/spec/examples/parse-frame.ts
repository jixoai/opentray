import { parseServerFrame, PROTOCOL_VERSION, type ServerFrame } from "../src/index";

const readyFrame = JSON.stringify({
  type: "ready",
  protocolVersion: PROTOCOL_VERSION,
  brokerVersion: "0.1.0",
  brokerArtifactIdentity: {
    packageVersion: "0.1.0",
    target: { os: "darwin", arch: "arm64" },
    executableHash: "0".repeat(64),
    buildIdentity: "sha256:0000000000000000",
  },
  sessionId: "session-1",
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
