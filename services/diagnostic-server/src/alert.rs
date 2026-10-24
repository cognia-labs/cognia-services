use std::{sync::Arc, time::Duration};

use anyhow::Context;
use chrono::{DateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use lettre::{
    message::header::ContentType, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use reqwest::Url;
use sha2::Sha256;
use tokio::sync::watch;

use crate::{
    config::ServerConfig,
    db::{AlertDeliveryRecord, DiagnosticRepository},
};

const MAX_ALERT_ATTEMPTS: i32 = 10;

/// The transports an alert is queued on.
///
/// Only the ones this process can deliver: a delivery row for a transport with
/// no configuration can only ever fail (`webhook_not_configured`, …), which
/// used to leave one permanently failed row per alert. OTel needs no setup —
/// it is a structured log line — so it is always on.
pub const OTEL_TRANSPORT: &str = "otel";

/// When an alert is raised, and where it is queued. Built once from the
/// server configuration and carried by the repository, which is where every
/// alert is enqueued.
#[derive(Debug, Clone, PartialEq)]
pub struct AlertPolicy {
    pub transports: Vec<&'static str>,
    /// One alert per (project, kind, group) per window for the windowed kinds.
    pub dedupe_window: Duration,
    pub spike: SpikeRule,
    pub backlog: BacklogRule,
}

impl Default for AlertPolicy {
    fn default() -> Self {
        Self {
            transports: vec![OTEL_TRANSPORT],
            dedupe_window: Duration::from_secs(3_600),
            spike: SpikeRule::default(),
            backlog: BacklogRule::default(),
        }
    }
}

impl AlertPolicy {
    pub fn from_config(config: &ServerConfig) -> Self {
        let mut transports = Vec::new();
        if config.alert_webhook_url.is_some() {
            transports.push("webhook");
        }
        // `ServerConfig::from_env` refuses a partial SMTP setup, so all three
        // are present or none is.
        if config.alert_smtp_url.is_some()
            && config.alert_smtp_from.is_some()
            && config.alert_smtp_to.is_some()
        {
            transports.push("smtp");
        }
        transports.push(OTEL_TRANSPORT);
        Self {
            transports,
            dedupe_window: config.alert_dedupe_window,
            spike: SpikeRule {
                window: config.alert_spike_window,
                baseline_windows: config.alert_spike_baseline_windows,
                min_incidents: config.alert_spike_min_incidents,
                factor: config.alert_spike_factor,
            },
            backlog: BacklogRule {
                max_incidents: config.alert_backlog_max_incidents,
                max_age: config.alert_backlog_max_age,
            },
        }
    }
}

/// A crash spike: a group accepts far more incidents in the trailing window
/// than its own recent average.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpikeRule {
    pub window: Duration,
    /// Earlier windows of the same length that form the baseline.
    pub baseline_windows: u32,
    /// Floor, so a quiet group's second crash is not a spike.
    pub min_incidents: u32,
    /// Multiple of the baseline average (at least one incident per window).
    pub factor: f64,
}

impl Default for SpikeRule {
    fn default() -> Self {
        Self {
            window: Duration::from_secs(3_600),
            baseline_windows: 24,
            min_incidents: 10,
            factor: 3.0,
        }
    }
}

impl SpikeRule {
    /// `current` counts the trailing window; `baseline_total` the
    /// `baseline_windows` before it.
    pub fn is_spike(&self, current: i64, baseline_total: i64) -> bool {
        if current < i64::from(self.min_incidents) {
            return false;
        }
        let average = baseline_total.max(0) as f64 / f64::from(self.baseline_windows.max(1));
        current as f64 >= self.factor * average.max(1.0)
    }
}

/// A processing backlog: too many incidents waiting, or one waiting too long.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BacklogRule {
    pub max_incidents: u32,
    pub max_age: Duration,
}

impl Default for BacklogRule {
    fn default() -> Self {
        Self {
            max_incidents: 100,
            max_age: Duration::from_secs(900),
        }
    }
}

impl BacklogRule {
    pub fn is_backlog(&self, queued: i64, oldest_age: Duration) -> bool {
        queued >= i64::from(self.max_incidents) || (queued > 0 && oldest_age >= self.max_age)
    }
}

impl AlertDeliveryRecord {
    fn webhook_payload(&self) -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "deliveryId": self.id,
            "tenantId": self.tenant_id,
            "projectId": self.project_id,
            "incidentId": self.incident_id,
            "groupId": self.group_id,
            "kind": self.alert_kind,
            "payload": self.payload,
        })
    }

    fn email_body(&self) -> String {
        format!(
            "Diagnostic alert: {}\nProject: {}\nIncident: {}\nGroup: {}\nDetails: {}\n",
            self.alert_kind,
            self.project_id,
            self.incident_id
                .map_or_else(|| "n/a".to_owned(), |id| id.to_string()),
            self.group_id
                .map_or_else(|| "n/a".to_owned(), |id| id.to_string()),
            self.payload
        )
    }
}

#[derive(Clone)]
pub struct AlertDispatcher {
    http: reqwest::Client,
    webhook_url: Option<Url>,
    webhook_secret: Option<Arc<[u8]>>,
    smtp_url: Option<String>,
    smtp_from: Option<String>,
    smtp_to: Option<String>,
}

impl AlertDispatcher {
    pub fn from_config(config: &ServerConfig) -> anyhow::Result<Self> {
        crate::ensure_crypto_provider();
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(config.alert_timeout)
                .build()
                .context("build alert HTTP client")?,
            webhook_url: config.alert_webhook_url.clone(),
            webhook_secret: config
                .alert_webhook_secret
                .as_deref()
                .map(|value| Arc::<[u8]>::from(value.as_bytes())),
            smtp_url: config.alert_smtp_url.clone(),
            smtp_from: config.alert_smtp_from.clone(),
            smtp_to: config.alert_smtp_to.clone(),
        })
    }

    pub async fn deliver(&self, delivery: &AlertDeliveryRecord) -> Result<(), AlertError> {
        match delivery.transport.as_str() {
            "webhook" => self.deliver_webhook(delivery).await,
            "smtp" => self.deliver_smtp(delivery).await,
            "otel" => {
                tracing::warn!(
                    event_name = "cognia.diagnostics.alert",
                    tenant_id = %delivery.tenant_id,
                    project_id = %delivery.project_id,
                    incident_id = ?delivery.incident_id,
                    group_id = ?delivery.group_id,
                    alert_kind = %delivery.alert_kind,
                    payload = %delivery.payload,
                    "diagnostic alert signal"
                );
                Ok(())
            }
            _ => Err(AlertError::permanent("alert_transport_unknown")),
        }
    }

    async fn deliver_webhook(&self, delivery: &AlertDeliveryRecord) -> Result<(), AlertError> {
        let url = self
            .webhook_url
            .as_ref()
            .ok_or_else(|| AlertError::permanent("webhook_not_configured"))?;
        let body = serde_json::to_vec(&delivery.webhook_payload())
            .map_err(|_| AlertError::permanent("webhook_payload_invalid"))?;
        let mut request = self
            .http
            .post(url.clone())
            .header("content-type", "application/json")
            .header("idempotency-key", delivery.id.to_string());
        if let Some(secret) = &self.webhook_secret {
            let signature = webhook_signature(secret, &body);
            request = request.header("x-cognia-signature", format!("sha256={signature}"));
        }
        let response = request
            .body(body)
            .send()
            .await
            .map_err(|_| AlertError::retryable("webhook_transport_failed"))?;
        if response.status().is_success() {
            Ok(())
        } else if response.status().is_server_error() || response.status().as_u16() == 429 {
            Err(AlertError::retryable("webhook_retryable_status"))
        } else {
            Err(AlertError::permanent("webhook_rejected"))
        }
    }

    async fn deliver_smtp(&self, delivery: &AlertDeliveryRecord) -> Result<(), AlertError> {
        let smtp_url = self
            .smtp_url
            .as_deref()
            .ok_or_else(|| AlertError::permanent("smtp_not_configured"))?;
        let from = self
            .smtp_from
            .as_deref()
            .ok_or_else(|| AlertError::permanent("smtp_from_missing"))?;
        let to = self
            .smtp_to
            .as_deref()
            .ok_or_else(|| AlertError::permanent("smtp_to_missing"))?;
        let email = Message::builder()
            .from(
                from.parse()
                    .map_err(|_| AlertError::permanent("smtp_from_invalid"))?,
            )
            .to(to
                .parse()
                .map_err(|_| AlertError::permanent("smtp_to_invalid"))?)
            .subject(format!("Cognia diagnostics: {}", delivery.alert_kind))
            .header(ContentType::TEXT_PLAIN)
            .body(delivery.email_body())
            .map_err(|_| AlertError::permanent("smtp_message_invalid"))?;
        let mailer = AsyncSmtpTransport::<Tokio1Executor>::from_url(smtp_url)
            .map_err(|_| AlertError::permanent("smtp_url_invalid"))?
            .build();
        mailer
            .send(email)
            .await
            .map_err(|_| AlertError::retryable("smtp_transport_failed"))?;
        Ok(())
    }
}

#[derive(Debug)]
pub struct AlertError {
    code: &'static str,
    retryable: bool,
}

impl AlertError {
    fn retryable(code: &'static str) -> Self {
        Self {
            code,
            retryable: true,
        }
    }

    fn permanent(code: &'static str) -> Self {
        Self {
            code,
            retryable: false,
        }
    }
}

#[derive(Clone)]
pub struct AlertWorker {
    repository: DiagnosticRepository,
    dispatcher: AlertDispatcher,
    interval: Duration,
    batch_size: usize,
}

impl AlertWorker {
    pub fn new(
        repository: DiagnosticRepository,
        dispatcher: AlertDispatcher,
        interval: Duration,
        batch_size: usize,
    ) -> Self {
        Self {
            repository,
            dispatcher,
            interval,
            batch_size,
        }
    }

    pub async fn run(self, mut shutdown: watch::Receiver<bool>) {
        loop {
            if *shutdown.borrow() {
                break;
            }
            if let Err(error) = self.drain_due().await {
                tracing::error!(error = %error, "diagnostic alert iteration failed");
            }
            tokio::select! {
                _ = tokio::time::sleep(self.interval) => {},
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() { break; }
                }
            }
        }
    }

    pub async fn drain_due(&self) -> anyhow::Result<usize> {
        let tenants = self.repository.tenant_ids().await?;
        // The backlog check lives here rather than in the processor: the
        // processor stalling (or being switched off) is exactly when the
        // backlog grows, and it must not be the thing that notices.
        for tenant_id in &tenants {
            self.repository.raise_processing_backlog(*tenant_id).await?;
        }
        let mut processed = 0;
        while processed < self.batch_size {
            let mut claimed = false;
            for tenant_id in &tenants {
                if processed >= self.batch_size {
                    break;
                }
                let Some(delivery) = self.repository.claim_next_alert(*tenant_id).await? else {
                    continue;
                };
                claimed = true;
                processed += 1;
                match self.dispatcher.deliver(&delivery).await {
                    Ok(()) => self.repository.complete_alert(&delivery).await?,
                    Err(error) => {
                        self.repository
                            .fail_alert(
                                &delivery,
                                error.code,
                                alert_retry_at(delivery.attempts),
                                error.retryable && delivery.attempts < MAX_ALERT_ATTEMPTS,
                            )
                            .await?;
                    }
                }
            }
            if !claimed {
                break;
            }
        }
        Ok(processed)
    }
}

fn webhook_signature(secret: &[u8], body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts arbitrary key sizes");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

fn alert_retry_at(attempts: i32) -> DateTime<Utc> {
    let exponent = u32::try_from(attempts.saturating_sub(1).clamp(0, 10)).unwrap_or(10);
    Utc::now() + chrono::Duration::seconds(30_i64.saturating_mul(2_i64.pow(exponent)).min(21_600))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_signatures_are_stable_and_sensitive_to_content() {
        assert_eq!(
            webhook_signature(b"secret", b"payload"),
            "b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4"
        );
        assert_ne!(
            webhook_signature(b"secret", b"payload"),
            webhook_signature(b"secret", b"changed")
        );
    }

    fn config() -> ServerConfig {
        ServerConfig::for_router_tests(true)
    }

    #[test]
    fn alerts_queue_only_on_the_transports_this_process_can_deliver() {
        assert_eq!(AlertPolicy::from_config(&config()).transports, vec!["otel"]);

        let mut webhook = config();
        webhook.alert_webhook_url = Some("https://hooks.test/alerts".parse().unwrap());
        assert_eq!(
            AlertPolicy::from_config(&webhook).transports,
            vec!["webhook", "otel"]
        );

        let mut both = webhook.clone();
        both.alert_smtp_url = Some("smtp://mail.test:25".to_owned());
        both.alert_smtp_from = Some("alerts@cognia.test".to_owned());
        both.alert_smtp_to = Some("ops@cognia.test".to_owned());
        assert_eq!(
            AlertPolicy::from_config(&both).transports,
            vec!["webhook", "smtp", "otel"]
        );
    }

    #[test]
    fn the_policy_carries_the_configured_thresholds() {
        let mut tuned = config();
        tuned.alert_dedupe_window = Duration::from_secs(600);
        tuned.alert_spike_min_incidents = 4;
        tuned.alert_backlog_max_age = Duration::from_secs(60);
        let policy = AlertPolicy::from_config(&tuned);
        assert_eq!(policy.dedupe_window, Duration::from_secs(600));
        assert_eq!(policy.spike.min_incidents, 4);
        assert_eq!(policy.backlog.max_age, Duration::from_secs(60));
    }

    #[test]
    fn a_spike_needs_the_floor_and_a_multiple_of_the_baseline() {
        let rule = SpikeRule::default();
        // Below the floor, however quiet the group was.
        assert!(!rule.is_spike(9, 0));
        // At the floor with no history: 10 >= 3 x max(0/24, 1).
        assert!(rule.is_spike(10, 0));
        // A group that always crashes 10 an hour is not spiking at 20.
        assert!(!rule.is_spike(20, 240));
        // At 30 it is: three times its own average.
        assert!(rule.is_spike(30, 240));
    }

    #[test]
    fn a_backlog_is_too_many_queued_or_one_queued_too_long() {
        let rule = BacklogRule::default();
        assert!(!rule.is_backlog(0, Duration::from_secs(86_400)));
        assert!(!rule.is_backlog(5, Duration::from_secs(60)));
        assert!(rule.is_backlog(5, Duration::from_secs(900)));
        assert!(rule.is_backlog(100, Duration::ZERO));
    }

    #[test]
    fn retry_delay_is_bounded() {
        let now = Utc::now();
        assert!((alert_retry_at(1) - now).num_seconds() >= 29);
        assert!((alert_retry_at(i32::MAX) - now).num_seconds() <= 21_600);
    }
}
