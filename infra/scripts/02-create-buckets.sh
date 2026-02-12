#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${1:?usage: $0 <project-id>}"
BR_BUCKET="${2:-discloud-zips-br}"
US_BUCKET="${3:-discloud-zips-us}"

gsutil mb -p "$PROJECT_ID" -l southamerica-east1 "gs://${BR_BUCKET}" || true
gsutil mb -p "$PROJECT_ID" -l us-central1 "gs://${US_BUCKET}" || true
