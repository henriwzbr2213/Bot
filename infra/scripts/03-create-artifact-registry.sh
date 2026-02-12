#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${1:?usage: $0 <project-id>}"
REPO="${2:-discloud-apps}"
LOCATION="${3:-us-central1}"

gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$LOCATION" \
  --project="$PROJECT_ID" || true
