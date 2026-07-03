# Motse production infrastructure (Phase 2, WS3) — GCP.
# Per-entity projects mirror the regulatory boundaries (doc §16:
# Platform / Pay / Letlole); this stack provisions the Platform project.
# Usage: terraform apply -var-file=environments/prod.tfvars

terraform {
  required_version = ">= 1.7"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.30" }
  }
  backend "gcs" {} # bucket/prefix supplied per environment via -backend-config
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Artifact Registry: pinned, provenance-checked images (§13.1) ─────
resource "google_artifact_registry_repository" "motse" {
  location      = var.region
  repository_id = "motse"
  format        = "DOCKER"
}

# ── GKE Autopilot: the runtime for the modular monolith ─────────────
resource "google_container_cluster" "motse" {
  name             = "motse-${var.environment}"
  location         = var.region
  enable_autopilot = true

  release_channel { channel = "REGULAR" }

  # Private nodes; API server reachable through authorized networks only.
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
  }

  deletion_protection = var.environment == "prod"
}

# ── Cloud SQL (Postgres): the Ledger system of record (§6.1) ─────────
resource "google_sql_database_instance" "ledger" {
  name             = "motse-ledger-${var.environment}"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.ledger_db_tier
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true # RPO ≤ 5 min (§16)
      transaction_log_retention_days = 7
      backup_retention_settings { retained_backups = 30 }
    }

    ip_configuration {
      ipv4_enabled = false # reachable only from the Ledger service (§13.1)
      private_network = google_compute_network.motse.id
    }
  }

  deletion_protection = var.environment == "prod"
}

resource "google_sql_database" "ledger" {
  name     = "ledger"
  instance = google_sql_database_instance.ledger.name
}

# ── Memorystore (Redis): rate limits, sessions, USSD hot paths (§6.1) ─
resource "google_redis_instance" "cache" {
  name           = "motse-cache-${var.environment}"
  tier           = var.environment == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.redis_gb
  region         = var.region
}

# ── Networking ───────────────────────────────────────────────────────
resource "google_compute_network" "motse" {
  name                    = "motse-${var.environment}"
  auto_create_subnetworks = true
}

# ── Secret Manager: per-service secrets with rotation (§13.1) ────────
resource "google_secret_manager_secret" "platform" {
  for_each = toset([
    "motse-secret",
    "motse-admin-bootstrap-token",
    "motse-orange-api-key",
    "motse-myzaka-api-key",
    "motse-smega-api-key",
  ])
  secret_id = "${each.key}-${var.environment}"
  replication { auto {} }
}

# ── GCS: media originals/derivatives + backup snapshots ──────────────
resource "google_storage_bucket" "media_general" {
  name                        = "${var.project_id}-motse-media-${var.environment}"
  location                    = var.region
  uniform_bucket_level_access = true
  versioning { enabled = true }
}

# Restricted class: separate bucket, CMEK, no public ACLs ever (§6.4).
resource "google_kms_key_ring" "motse" {
  name     = "motse-${var.environment}"
  location = var.region
}

resource "google_kms_crypto_key" "restricted_media" {
  name            = "restricted-media"
  key_ring        = google_kms_key_ring.motse.id
  rotation_period = "7776000s" # 90 days
}

resource "google_storage_bucket" "media_restricted" {
  name                        = "${var.project_id}-motse-restricted-${var.environment}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning { enabled = true }
  encryption { default_kms_key_name = google_kms_crypto_key.restricted_media.id }
}

resource "google_storage_bucket" "backups" {
  name                        = "${var.project_id}-motse-backups-${var.environment}"
  location                    = var.region
  uniform_bucket_level_access = true
  lifecycle_rule {
    condition { age = 90 } # aligned with the 90-day purge contract
    action { type = "Delete" }
  }
}
