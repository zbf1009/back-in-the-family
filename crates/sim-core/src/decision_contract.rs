//! Fixed production D contract, separate from the frozen probe implementation.
//!
//! The fingerprint is precomputed because every field is fixed. The offline
//! TypeScript proof recomputes SHA-256 of the mapping and the NUL-separated fields
//! with WebCrypto and compares the actual native and wasm32 contract traces.

use crate::decision_fingerprint::DecisionFingerprint;

pub const PROVIDER: &str = "cloudflare_workers_ai";
pub const MODEL: &str = "@cf/cloudflare/clef";
pub const MAPPING_VERSION: &str = "system-one-v1";
pub const MAPPING_HASH: &str = "e275f397327b91dc1b6f69290535d6ef72c6bb712021ff130ed9da43589b337d";
pub const RESPONSE_SCHEMA: &str = "clef-system-one-choice-v1";

// The browser can import this production text with Vite's ?raw loader. Neither
// adapter needs the probe tree or a runtime template read.
pub const SYSTEM_ONE_MAPPING: &str = include_str!("../../../web/src/shared/system-one-v1.txt");

pub const FINGERPRINT: DecisionFingerprint = DecisionFingerprint::from_bytes([
    0x6f, 0xfb, 0x8d, 0x3a, 0x25, 0x5d, 0xbc, 0x1d, 0x06, 0x6b, 0xa3, 0xb4, 0xa1, 0xc3, 0x82, 0x91,
    0xb1, 0xad, 0xfd, 0xa5, 0xaa, 0x1f, 0x4e, 0x3c, 0x65, 0xa9, 0xad, 0xaf, 0xbd, 0x24, 0x3a, 0x32,
]);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_contract_production_mapping_is_the_frozen_template() {
        let frozen = include_bytes!("../../../eval/probe/templates/decision.system_one.v1.txt");
        assert_eq!(SYSTEM_ONE_MAPPING.as_bytes(), frozen);
        assert_eq!(SYSTEM_ONE_MAPPING.len(), 1879);
        assert!(SYSTEM_ONE_MAPPING.ends_with('\n'));
    }

    #[test]
    fn decision_contract_static_metadata_and_typed_fingerprint_are_pinned() {
        assert_eq!(PROVIDER, "cloudflare_workers_ai");
        assert_eq!(MODEL, "@cf/cloudflare/clef");
        assert_eq!(MAPPING_VERSION, "system-one-v1");
        assert_eq!(
            MAPPING_HASH,
            "e275f397327b91dc1b6f69290535d6ef72c6bb712021ff130ed9da43589b337d"
        );
        assert_eq!(RESPONSE_SCHEMA, "clef-system-one-choice-v1");
        assert_eq!(
            FINGERPRINT.to_string(),
            "6ffb8d3a255dbc1d066ba3b4a1c38291b1adfda5aa1f4e3c65a9adafbd243a32"
        );
        let fields = [
            PROVIDER,
            MODEL,
            MAPPING_VERSION,
            MAPPING_HASH,
            RESPONSE_SCHEMA,
        ];
        assert!(fields.iter().all(|field| !field.contains('\0')));
        let input = fields.join("\0");
        assert_eq!(input.len(), 146);
        assert_eq!(input.bytes().filter(|byte| *byte == 0).count(), 4);
        assert!(!input.ends_with('\0'));
    }
}
