import type { Messages } from "@/i18n";
import { FAMILY_LABEL, type Family } from "@/lib/command-family";

/** UI-facing family name: canonical for real families, localized for custom. */
export const familyLabel = (family: Family, messages: Messages): string =>
  family === "custom" ? messages.family.custom : FAMILY_LABEL[family];
