export const redact = (text: string, secrets: string[]): string => {
  let redacted = text;
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("<secret>");
  }
  return redacted
    .replace(/npm_[A-Za-z0-9._-]+(?:\u2026)?/gu, "npm_<redacted>")
    .replace(/\b\d{6}\b/g, "<OTP>")
    .replace(/authId=[0-9a-f-]+/giu, "authId=<redacted>");
};
