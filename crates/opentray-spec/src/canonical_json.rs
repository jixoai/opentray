//! RFC 8785 (JSON Canonicalization Scheme, "JCS") encoder.
//!
//! This is the single canonical byte standard for OpenTray message-channel
//! payload accounting and any other cross-language byte-exact JSON contract.
//! The TypeScript mirror in `packages/spec/src/canonical-json.ts` must
//! produce identical bytes; both implementations are verified against the
//! shared fixtures in `fixtures/canonical-json/` (input value + expected
//! canonical text).
//!
//! Encoding rules (RFC 8785 §3.2.2–3.2.3):
//! - Objects: keys sorted by UTF-16 code unit order, no whitespace.
//! - Strings: only `"` and `\` plus C0 control characters are escaped, using
//!   the short forms `\b \t \n \f \r` and lowercase-hex `\u00xx` otherwise.
//! - Numbers: serialized exactly like ECMAScript `Number::toString`
//!   (`-0` → `0`, `1.0` → `1`, `1e21` → `1e+21`, `1e-7` → `1e-7`).
//!   `serde_json` integers beyond the IEEE-754 exact range (±2^53) are
//!   first rounded to `f64`, matching what an ECMAScript JSON parser would
//!   have produced for the same input text.
//! - `true`, `false`, `null` keep their spellings; arrays keep element order.
//!
//! The encodable value domain is the RFC 8785 domain. NaN and Infinity are
//! not representable in `serde_json::Value`, and the encoder rejects them
//! defensively; callers map rejection to the typed protocol error
//! `invalid_payload`.

use std::cmp::Ordering;

use serde_json::Value;

/// Maximum integer magnitude serialized exactly as an integer; beyond this
/// the value is normalized through `f64` per the IEEE-754 / I-JSON domain.
const EXACT_INTEGER_LIMIT: u64 = 1u64 << 53;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanonicalJsonError {
    /// NaN or Infinity appeared in the value domain.
    NonFiniteNumber,
}

impl std::fmt::Display for CanonicalJsonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NonFiniteNumber => {
                f.write_str("NaN and Infinity are outside the RFC 8785 domain")
            }
        }
    }
}

impl std::error::Error for CanonicalJsonError {}

/// Encodes one JSON value to its RFC 8785 canonical text form.
pub fn canonical_json(value: &Value) -> Result<String, CanonicalJsonError> {
    let mut out = String::new();
    write_value(value, &mut out)?;
    Ok(out)
}

/// UTF-8 bytes of the RFC 8785 serialization.
pub fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, CanonicalJsonError> {
    Ok(canonical_json(value)?.into_bytes())
}

/// Byte count of the RFC 8785 serialization (queue accounting helper).
pub fn canonical_json_byte_count(value: &Value) -> Result<usize, CanonicalJsonError> {
    Ok(canonical_json_bytes(value)?.len())
}

fn write_value(value: &Value, out: &mut String) -> Result<(), CanonicalJsonError> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(boolean) => out.push_str(if *boolean { "true" } else { "false" }),
        Value::Number(number) => write_number(number, out)?,
        Value::String(text) => write_escaped_string(text, out),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_value(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            // serde_json's map may be a BTreeMap in UTF-8 byte order, which
            // differs from UTF-16 code unit order above the BMP; always
            // re-sort explicitly per RFC 8785 §3.2.3.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|left, right| utf16_code_unit_cmp(left, right));
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_escaped_string(key, out);
                out.push(':');
                write_value(&map[key.as_str()], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn write_number(number: &serde_json::Number, out: &mut String) -> Result<(), CanonicalJsonError> {
    if let Some(unsigned) = number.as_u64() {
        if unsigned <= EXACT_INTEGER_LIMIT {
            out.push_str(&unsigned.to_string());
            return Ok(());
        }
        return write_ecmascript_f64(unsigned as f64, out);
    }
    if let Some(signed) = number.as_i64() {
        let magnitude = signed.unsigned_abs();
        if magnitude <= EXACT_INTEGER_LIMIT {
            out.push_str(&signed.to_string());
            return Ok(());
        }
        return write_ecmascript_f64(signed as f64, out);
    }
    match number.as_f64() {
        Some(float) => write_ecmascript_f64(float, out),
        None => Err(CanonicalJsonError::NonFiniteNumber),
    }
}

/// Serializes a finite `f64` exactly like ECMAScript `Number::toString`.
///
/// The shortest round-trip digit string comes from Rust's `LowerExp`
/// formatting (`1.23456e15`), which is re-assembled into the ECMAScript
/// decimal/exponent grammar: with digit string `s` of length `k` and
/// `s × 10^(n−k) = m`,
/// - `k ≤ n ≤ 21`: digits followed by `n−k` zeros,
/// - `0 < n ≤ 21`: decimal point inside the digits,
/// - `−6 < n ≤ 0`: `0.` followed by `−n` zeros and the digits,
/// - otherwise: exponent form `d[.ddd]e±xx`.
fn write_ecmascript_f64(value: f64, out: &mut String) -> Result<(), CanonicalJsonError> {
    if !value.is_finite() {
        return Err(CanonicalJsonError::NonFiniteNumber);
    }
    if value == 0.0 {
        // ECMAScript prints both zeros as "0"; JCS keeps that.
        out.push('0');
        return Ok(());
    }
    if value < 0.0 {
        out.push('-');
        return write_ecmascript_f64(-value, out);
    }
    let scientific = format!("{value:e}");
    let (mantissa, exponent_text) = scientific
        .split_once('e')
        .expect("LowerExp formatting always carries an exponent");
    let exponent: i32 = exponent_text
        .parse()
        .expect("LowerExp formatting always carries a decimal exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let digit_count = digits.len() as i32;
    let n = exponent + 1;

    if digit_count <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - digit_count) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        let split = n as usize;
        out.push_str(&digits[..split]);
        out.push('.');
        out.push_str(&digits[split..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else if digit_count == 1 {
        out.push_str(&digits);
        push_exponent(out, n - 1);
    } else {
        out.push_str(&digits[..1]);
        out.push('.');
        out.push_str(&digits[1..]);
        push_exponent(out, n - 1);
    }
    Ok(())
}

fn push_exponent(out: &mut String, exponent: i32) {
    out.push('e');
    if exponent >= 0 {
        out.push('+');
    } else {
        out.push('-');
    }
    out.push_str(&exponent.unsigned_abs().to_string());
}

fn write_escaped_string(text: &str, out: &mut String) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{09}' => out.push_str("\\t"),
            '\u{0a}' => out.push_str("\\n"),
            '\u{0c}' => out.push_str("\\f"),
            '\u{0d}' => out.push_str("\\r"),
            control if (control as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", control as u32));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

/// RFC 8785 object key ordering: lexicographic over UTF-16 code units.
fn utf16_code_unit_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use serde_json::Value;

    use super::*;

    /// Shared byte-truth suite: the same fixture files are consumed by
    /// `packages/spec/src/canonical-json.test.ts` so the TypeScript and Rust
    /// encoders are pinned to identical bytes for the same input values.
    #[test]
    fn shared_fixtures_produce_expected_bytes() {
        let fixtures_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/canonical-json");
        let mut checked = 0;
        let mut entries: Vec<_> = fs::read_dir(&fixtures_dir)
            .expect("shared canonical-json fixtures directory")
            .map(|entry| entry.expect("fixture entry").path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        entries.sort();
        assert!(
            entries.len() >= 8,
            "expected at least 8 shared fixtures, found {}",
            entries.len()
        );
        for path in entries {
            let raw = fs::read_to_string(&path).expect("fixture text");
            let fixture: Value = serde_json::from_str(&raw).expect("fixture JSON");
            let name = fixture["name"].as_str().expect("fixture name");
            let input = &fixture["input"];
            let expected = fixture["expected"].as_str().expect("expected canonical text");
            let actual = canonical_json(input).unwrap_or_else(|error| {
                panic!("fixture {name} ({:?}) failed to encode: {error}", path.file_name())
            });
            assert_eq!(actual, expected, "fixture {name} canonical text mismatch");
            assert_eq!(
                actual.as_bytes().len(),
                expected.as_bytes().len(),
                "fixture {name} byte length mismatch"
            );
            let round_trip: Value =
                serde_json::from_str(&actual).unwrap_or_else(|error| panic!("fixture {name}: canonical text is not valid JSON: {error}"));
            let re_canonical = canonical_json(&round_trip)
                .unwrap_or_else(|error| panic!("fixture {name}: re-encoding failed: {error}"));
            assert_eq!(
                re_canonical, actual,
                "fixture {name}: canonical text must be stable (RFC 8785 output is reusable as input)"
            );
            checked += 1;
        }
        assert!(checked >= 8);
    }

    #[test]
    fn ecmascript_number_grammar_matches_reference_forms() {
        let cases: Vec<(f64, &str)> = vec![
            (-0.0, "0"),
            (0.0, "0"),
            (1.0, "1"),
            (4.5, "4.5"),
            (42.0, "42"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1e22, "1e+22"),
            (1.5e21, "1.5e+21"),
            (1e-7, "1e-7"),
            (2e-3, "0.002"),
            (1e-6, "0.000001"),
            (333333333.33333329, "333333333.3333333"),
            (9007199254740992.0, "9007199254740992"),
            (9007199254740993.0, "9007199254740992"),
            (-9007199254740993.0, "-9007199254740992"),
            (1.0000000000000002, "1.0000000000000002"),
        ];
        for (value, expected) in cases {
            let mut out = String::new();
            write_ecmascript_f64(value, &mut out).expect("finite value");
            assert_eq!(out, expected, "value {value:e}");
        }
    }

    #[test]
    fn integers_beyond_the_safe_domain_normalize_through_f64() {
        let beyond = serde_json::json!({
            "u55": 9007199254740994u64,
            "beyond": 9007199254740993u64,
            "bigU64": 10000000000000000000u64,
            "hugeFloat": 1234567890123456789012i128 as f64,
        });
        assert_eq!(
            canonical_json(&beyond).unwrap(),
            "{\"beyond\":9007199254740992,\"bigU64\":10000000000000000000,\"hugeFloat\":1.2345678901234568e+21,\"u55\":9007199254740994}"
        );
    }

    #[test]
    fn key_ordering_uses_utf16_code_units_not_utf8_bytes() {
        // U+FF5E (0xFF5E) sorts after the U+1F600 surrogate pair (0xD83D)
        // in UTF-16 order, although its UTF-8 bytes would sort first.
        let value = serde_json::json!({
            "\u{ff5e}": 1,
            "\u{1f600}": 2,
            "z": 3,
        });
        assert_eq!(canonical_json(&value).unwrap(), "{\"z\":3,\"😀\":2,\"～\":1}");
    }

    #[test]
    fn string_escaping_uses_short_forms_and_lowercase_hex() {
        let value = Value::String("\u{0}\u{8}\u{9}\u{a}\u{c}\u{d}\u{1f}\"\\/ ä€中😀".into());
        assert_eq!(
            canonical_json(&value).unwrap(),
            "\"\\u0000\\b\\t\\n\\f\\r\\u001f\\\"\\\\/ ä€中😀\""
        );
    }

    #[test]
    fn non_finite_numbers_are_rejected() {
        let nan = serde_json::Number::from_f64(f64::NAN);
        assert!(nan.is_none(), "serde_json cannot hold NaN");
        assert_eq!(
            write_ecmascript_f64(f64::INFINITY, &mut String::new()),
            Err(CanonicalJsonError::NonFiniteNumber)
        );
        assert_eq!(
            write_ecmascript_f64(f64::NEG_INFINITY, &mut String::new()),
            Err(CanonicalJsonError::NonFiniteNumber)
        );
    }
}
