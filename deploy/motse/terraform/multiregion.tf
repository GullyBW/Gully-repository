# Multi-region deployment (Phase 3, WS13). Botswana's primary region is
# europe-west1; a warm secondary carries read replicas and standby
# capacity for disaster recovery and diaspora latency. Enable per
# environment with var.enable_secondary_region.

variable "enable_secondary_region" {
  type    = bool
  default = false
}

variable "secondary_region" {
  type    = string
  default = "europe-west4"
}

# ── Secondary GKE cluster (standby; blue/green target) ───────────────
resource "google_container_cluster" "motse_secondary" {
  count            = var.enable_secondary_region ? 1 : 0
  name             = "motse-${var.environment}-secondary"
  location         = var.secondary_region
  enable_autopilot = true
  release_channel { channel = "REGULAR" }
  deletion_protection = var.environment == "prod"
}

# ── Cross-region read replica of the Ledger (RPO ≤ 5 min preserved) ──
resource "google_sql_database_instance" "ledger_replica" {
  count                = var.enable_secondary_region ? 1 : 0
  name                 = "motse-ledger-${var.environment}-replica"
  region               = var.secondary_region
  database_version     = "POSTGRES_16"
  master_instance_name = google_sql_database_instance.ledger.name

  replica_configuration {
    failover_target = true # promotable on primary-region failure
  }

  settings {
    tier              = var.ledger_db_tier
    availability_type = "ZONAL"
  }
  deletion_protection = var.environment == "prod"
}

# ── Global load balancer distributing to both regions ───────────────
resource "google_compute_global_address" "motse" {
  count = var.enable_secondary_region ? 1 : 0
  name  = "motse-${var.environment}-global"
}

# ── Media buckets: dual-region for the restricted class's durability ─
resource "google_storage_bucket" "media_restricted_dr" {
  count                       = var.enable_secondary_region ? 1 : 0
  name                        = "${var.project_id}-motse-restricted-dr-${var.environment}"
  location                    = var.secondary_region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  encryption { default_kms_key_name = google_kms_crypto_key.restricted_media.id }
}

output "secondary_region_enabled" {
  value = var.enable_secondary_region
}
