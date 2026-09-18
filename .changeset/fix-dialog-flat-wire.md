---
"@opentray/ext-dialog": patch
---

Fix: every dialog command wire is FLAT next to `type` — the shipped
0.29.0/0.30.0 facade wrapped `messageDialog`/`pickFile`/`pickDirectory`/
`pickSavePath` payloads in a nested `{options: {...}}` object that the
internally-tagged native `DialogCommand` decoder rejects with
'unknown field `options`' (issue #8: every show command failed against
the real extension). The wire now matches the crate's flat serde shape,
pinned by mirrored literals on both sides (facade exact-equality frame
assertions + a crate deserialization fixture proving the nested wrapper
never decodes).
