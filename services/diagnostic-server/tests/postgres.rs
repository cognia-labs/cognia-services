//! Repository and route behaviour against a real PostgreSQL.
//!
//! Ignored by default: `cargo test` stays database-free. CI's Postgres job
//! (and a local run) set `DATABASE_URL` to a role that may create databases
//! and run `cargo test --locked -- --ignored`; `sqlx::test` gives every test
//! its own freshly migrated database.

use std::{sync::Arc, time::Duration};

use axum::{body::Body, http::Request, http::StatusCode};
use cognia_diagnostic_server::{
    build_router,
    db::{AcceptProcessing, CreateIncident, IncidentRecord},
    processing::ProcessingFailure,
    AlertPolicy, AppState, ArtifactStore, BacklogRule, DiagnosticRepository, GrantSigner,
    PrivacyGate, ServerConfig, SpikeRule,
};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

struct Fixture {
    tenant_id: Uuid,
    project_id: Uuid,
    repository: DiagnosticRepository,
    pool: PgPool,
}

async fn fixture(pool: PgPool, policy: AlertPolicy) -> Fixture {
    let tenant_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants (id, name) VALUES ($1, 'Test tenant')")
        .bind(tenant_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO projects (id, tenant_id, name) VALUES ($1, $2, 'Test project')")
        .bind(project_id)
        .bind(tenant_id)
        .execute(&pool)
        .await
        .unwrap();
    Fixture {
        tenant_id,
        project_id,
        repository: DiagnosticRepository::new(pool.clone()).with_alert_policy(policy),
        pool,
    }
}

fn sha256_hex(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

impl Fixture {
    async fn incident(&self, credential: Option<&str>) -> IncidentRecord {
        self.repository
            .create_incident(CreateIncident {
                id: Uuid::new_v4(),
                tenant_id: self.tenant_id,
                project_id: self.project_id,
                installation_id: "install-test".to_owned(),
                artifact_hash: sha256_hex(Uuid::new_v4().as_bytes()),
                build_id: "1.0.0".to_owned(),
                platform: "macos".to_owned(),
                module: "cognia".to_owned(),
                exception: "panic".to_owned(),
                deletion_credential_hash: credential.map(|value| sha256_hex(value.as_bytes())),
            })
            .await
            .unwrap()
            .incident
    }

    async fn accepted(&self, fingerprint: &str) -> IncidentRecord {
        let incident = self.incident(None).await;
        self.repository
            .accept_processing(
                &incident,
                AcceptProcessing {
                    fingerprint: fingerprint.to_owned(),
                    compatible_build_family: "1.0".to_owned(),
                    grouping_basis: serde_json::json!({}),
                    raw_stack: vec!["frame".to_owned()],
                    symbolized_stack: vec!["frame".to_owned()],
                    missing_symbols: Vec::new(),
                },
            )
            .await
            .unwrap();
        incident
    }

    /// Delivery rows per transport for one alert kind.
    async fn deliveries(&self, kind: &str) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT transport FROM alert_deliveries WHERE project_id = $1 AND alert_kind = $2 ORDER BY transport",
        )
        .bind(self.project_id)
        .bind(kind)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

fn policy(transports: Vec<&'static str>) -> AlertPolicy {
    AlertPolicy {
        transports,
        ..AlertPolicy::default()
    }
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn alerts_are_queued_only_on_the_configured_transports(pool: PgPool) {
    let otel_only = fixture(pool.clone(), policy(vec!["otel"])).await;
    otel_only.accepted("fp-otel").await;
    assert_eq!(otel_only.deliveries("new_regression").await, vec!["otel"]);

    let webhook = fixture(pool, policy(vec!["webhook", "otel"])).await;
    webhook.accepted("fp-webhook").await;
    assert_eq!(
        webhook.deliveries("new_regression").await,
        vec!["otel", "webhook"]
    );
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn a_crash_spike_is_raised_once_per_window(pool: PgPool) {
    let f = fixture(
        pool,
        AlertPolicy {
            spike: SpikeRule {
                window: Duration::from_secs(3_600),
                baseline_windows: 24,
                min_incidents: 3,
                factor: 3.0,
            },
            ..policy(vec!["otel"])
        },
    )
    .await;
    f.accepted("fp-spike").await;
    f.accepted("fp-spike").await;
    assert!(
        f.deliveries("crash_spike").await.is_empty(),
        "below the floor"
    );
    f.accepted("fp-spike").await;
    assert_eq!(f.deliveries("crash_spike").await, vec!["otel"]);
    f.accepted("fp-spike").await;
    assert_eq!(
        f.deliveries("crash_spike").await,
        vec!["otel"],
        "one spike is one alert, not one per incident"
    );
    // Another group's spike is its own situation.
    for _ in 0..3 {
        f.accepted("fp-other").await;
    }
    assert_eq!(f.deliveries("crash_spike").await.len(), 2);
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn a_steady_group_does_not_spike(pool: PgPool) {
    let f = fixture(
        pool,
        AlertPolicy {
            spike: SpikeRule {
                window: Duration::from_secs(3_600),
                baseline_windows: 2,
                min_incidents: 3,
                factor: 3.0,
            },
            ..policy(vec!["otel"])
        },
    )
    .await;
    for _ in 0..6 {
        f.accepted("fp-steady").await;
    }
    // Move the group's history back: six incidents across the two baseline
    // windows is an average of three per window.
    sqlx::query(
        "UPDATE incidents SET accepted_at = now() - interval '90 minutes' WHERE project_id = $1",
    )
    .bind(f.project_id)
    .execute(&f.pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM alert_deliveries WHERE project_id = $1")
        .bind(f.project_id)
        .execute(&f.pool)
        .await
        .unwrap();
    for _ in 0..8 {
        f.accepted("fp-steady").await;
    }
    assert!(
        f.deliveries("crash_spike").await.is_empty(),
        "8 in an hour against an average of 3 is under 3x"
    );
    f.accepted("fp-steady").await;
    assert_eq!(f.deliveries("crash_spike").await, vec!["otel"]);
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn upload_and_storage_failures_are_one_alert_per_window(pool: PgPool) {
    let f = fixture(pool, policy(vec!["otel"])).await;
    let incident = f.incident(None).await;
    assert!(f
        .repository
        .record_upload_failure(&incident, "part_checksum_mismatch")
        .await
        .unwrap());
    assert!(!f
        .repository
        .record_upload_failure(&incident, "part_too_large")
        .await
        .unwrap());
    assert_eq!(f.deliveries("upload_failure").await, vec!["otel"]);

    assert!(f
        .repository
        .record_storage_failure(&incident, "upload")
        .await
        .unwrap());
    // The processor hitting the same outage does not raise a second alert.
    f.repository
        .fail_processing(&incident, ProcessingFailure::StorageUnavailable)
        .await
        .unwrap();
    assert_eq!(f.deliveries("storage_failure").await, vec!["otel"]);

    // Once the window has passed, the next failure is news again.
    sqlx::query("UPDATE alert_deliveries SET created_at = now() - interval '2 hours'")
        .execute(&f.pool)
        .await
        .unwrap();
    f.repository
        .fail_processing(&incident, ProcessingFailure::StorageUnavailable)
        .await
        .unwrap();
    assert_eq!(f.deliveries("storage_failure").await.len(), 2);
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn a_processing_backlog_is_raised_by_count_or_by_age(pool: PgPool) {
    let f = fixture(
        pool,
        AlertPolicy {
            backlog: BacklogRule {
                max_incidents: 3,
                max_age: Duration::from_secs(600),
            },
            ..policy(vec!["otel"])
        },
    )
    .await;
    let first = f.incident(None).await;
    // Still uploading: not the processor's backlog.
    assert!(f
        .repository
        .raise_processing_backlog(f.tenant_id)
        .await
        .unwrap()
        .is_empty());
    f.repository
        .queue_processing(f.tenant_id, first.id)
        .await
        .unwrap();
    assert!(f
        .repository
        .raise_processing_backlog(f.tenant_id)
        .await
        .unwrap()
        .is_empty());

    // One queued incident overdue by more than the age limit is a backlog.
    sqlx::query(
        "UPDATE incidents SET next_processing_at = now() - interval '20 minutes' WHERE id = $1",
    )
    .bind(first.id)
    .execute(&f.pool)
    .await
    .unwrap();
    assert_eq!(
        f.repository
            .raise_processing_backlog(f.tenant_id)
            .await
            .unwrap(),
        vec![f.project_id]
    );
    // Deduped for the window.
    assert!(f
        .repository
        .raise_processing_backlog(f.tenant_id)
        .await
        .unwrap()
        .is_empty());
    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM alert_deliveries WHERE alert_kind = 'processing_backlog'",
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(payload["queuedIncidents"], serde_json::json!(1));
    assert!(payload["oldestQueuedSeconds"].as_u64().unwrap() >= 1_200);

    // By count: three fresh queued incidents in another project's quiet
    // state would trip it too; here, reset the window and queue two more.
    sqlx::query("DELETE FROM alert_deliveries")
        .execute(&f.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE incidents SET next_processing_at = now() WHERE id = $1")
        .bind(first.id)
        .execute(&f.pool)
        .await
        .unwrap();
    for _ in 0..2 {
        let incident = f.incident(None).await;
        f.repository
            .queue_processing(f.tenant_id, incident.id)
            .await
            .unwrap();
    }
    assert_eq!(
        f.repository
            .raise_processing_backlog(f.tenant_id)
            .await
            .unwrap(),
        vec![f.project_id]
    );
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn the_deletion_credential_finds_only_its_own_incident(pool: PgPool) {
    let f = fixture(pool, policy(vec!["otel"])).await;
    let credential = format!("del_{}", Uuid::new_v4().simple());
    let incident = f.incident(Some(&credential)).await;
    let hash = sha256_hex(credential.as_bytes());

    let lookup = |project: Uuid, incident_id: Uuid, hash: String| {
        let repository = f.repository.clone();
        let tenant = f.tenant_id;
        async move {
            repository
                .incident_for_deletion_credential(tenant, project, incident_id, &hash)
                .await
                .unwrap()
        }
    };
    assert!(lookup(f.project_id, incident.id, hash.clone())
        .await
        .is_some());
    assert!(lookup(f.project_id, incident.id, sha256_hex(b"del_wrong"))
        .await
        .is_none());
    assert!(lookup(Uuid::new_v4(), incident.id, hash.clone())
        .await
        .is_none());
    assert!(lookup(f.project_id, Uuid::new_v4(), hash).await.is_none());

    f.repository
        .delete_with_credential(f.tenant_id, incident.id)
        .await
        .unwrap();
    let (state, details): (String, Option<serde_json::Value>) = sqlx::query_as(
        r#"SELECT i.client_state::text, a.details FROM incidents i
        JOIN audit_events a ON a.incident_id = i.id AND a.action = 'incident.deleted'
        WHERE i.id = $1"#,
    )
    .bind(incident.id)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(state, "deleted");
    assert_eq!(
        details.unwrap()["authorizedBy"],
        serde_json::json!("deletion_credential")
    );
}

#[sqlx::test]
#[ignore = "needs DATABASE_URL pointing at PostgreSQL"]
async fn the_credential_route_deletes_without_a_grant_and_even_with_intake_off(pool: PgPool) {
    let f = fixture(pool.clone(), policy(vec!["otel"])).await;
    let credential = format!("del_{}", Uuid::new_v4().simple());
    let incident = f.incident(Some(&credential)).await;

    let artifacts_dir = std::env::temp_dir().join(format!("cognia-diagnostic-{}", Uuid::new_v4()));
    let mut config = ServerConfig::for_router_tests(false);
    config.object_store_local_dir = Some(artifacts_dir.clone());
    let config = Arc::new(config);
    let artifacts = ArtifactStore::from_config(&config, f.repository.clone()).unwrap();
    let signer = GrantSigner::new(config.grant_signing_key.as_bytes()).unwrap();
    let router = build_router(AppState::new(
        config,
        f.repository.clone(),
        artifacts,
        signer,
        PrivacyGate::v1(),
    ));
    let request = |credential: &str| {
        Request::post(format!(
            "/v1/incidents/{}/delete-with-credential",
            incident.id
        ))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "tenantId": f.tenant_id,
                "projectId": f.project_id,
                "deletionCredential": credential,
            })
            .to_string(),
        ))
        .unwrap()
    };

    let wrong = format!("del_{}", Uuid::new_v4().simple());
    let response = router.clone().oneshot(request(&wrong)).await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = router.clone().oneshot(request(&credential)).await.unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let state: String =
        sqlx::query_scalar("SELECT client_state::text FROM incidents WHERE id = $1")
            .bind(incident.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(state, "deleted");
    let _ = std::fs::remove_dir_all(artifacts_dir);
}
