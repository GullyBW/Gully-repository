variable "project_id" {
  type        = string
  description = "GCP project for the Platform entity (Pay/Letlole are separate projects per doc §16)"
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "ledger_db_tier" {
  type    = string
  default = "db-custom-2-7680"
}

variable "redis_gb" {
  type    = number
  default = 1
}
