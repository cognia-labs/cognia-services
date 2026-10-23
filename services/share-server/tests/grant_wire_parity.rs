//! The share service and the app's `crates/cognia-tenant-auth` must agree on
//! the grant wire format — ADR-0149 §8.
//!
//! This service verifies grants with its own implementation
//! (`cognia_share_core::grant`): the crate that mints them lives in the app
//! repository, and this service builds with its own directory as the Docker
//! context besides.
//!
//! Duplicated code that nothing pins drifts. The drift would be invisible
//! until grants the collaboration server mints started being rejected here —
//! in production, reported as "sharing stopped working".
//!
//! So both sides verify the same frozen bytes. The app's crate owns the
//! format and its fixture; `fixtures/grant-wire-vector.json` here is a
//! byte-identical copy, and the app's pinned-services check fails the moment
//! the two copies differ.

use std::path::PathBuf;

use cognia_share_core::grant::{GrantError, GrantVerifier};

fn vector() -> serde_json::Value {
    // A byte-identical copy of the owning crate's fixture; editing it alone
    // fails the app's pinned-services check.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/grant-wire-vector.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "the frozen grant vector must be readable at {}: {error}. \
             It is the only thing keeping these two implementations in step — \
             do not delete it, and never edit it without the app's copy.",
            path.display()
        )
    });
    serde_json::from_str(&raw).expect("fixture is json")
}

fn hex_bytes(value: &str) -> Vec<u8> {
    assert!(value.len().is_multiple_of(2), "hex must be even length");
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("hex"))
        .collect()
}

#[test]
fn a_grant_minted_by_the_collaboration_server_verifies_here() {
    let vector = vector();
    let verifier =
        GrantVerifier::new(&hex_bytes(vector["keyHex"].as_str().expect("keyHex"))).expect("key");
    let claims = verifier
        .verify(
            vector["token"].as_str().expect("token"),
            vector["verifyAtUnix"].as_i64().expect("verifyAtUnix"),
        )
        .expect("the frozen vector must verify");

    assert_eq!(claims.org_id, "org_acmecorporation000001");
    assert_eq!(claims.user_id, "usr_adalovelace000000000001");
}

#[test]
fn the_same_grant_is_refused_once_it_expires() {
    let vector = vector();
    let verifier =
        GrantVerifier::new(&hex_bytes(vector["keyHex"].as_str().expect("keyHex"))).expect("key");
    assert_eq!(
        verifier.verify(
            vector["token"].as_str().expect("token"),
            vector["expiredAtUnix"].as_i64().expect("expiredAtUnix"),
        ),
        Err(GrantError::Expired)
    );
}
