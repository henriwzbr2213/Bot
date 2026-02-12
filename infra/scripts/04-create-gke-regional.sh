#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${1:?usage: $0 <project-id>}"

# BR cluster regional
if ! gcloud container clusters describe discloud-br --region southamerica-east1 --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud container clusters create discloud-br \
    --project "$PROJECT_ID" \
    --region southamerica-east1 \
    --num-nodes 1 \
    --release-channel regular \
    --workload-pool "$PROJECT_ID.svc.id.goog"
fi

# US cluster regional
if ! gcloud container clusters describe discloud-us --region us-central1 --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud container clusters create discloud-us \
    --project "$PROJECT_ID" \
    --region us-central1 \
    --num-nodes 1 \
    --release-channel regular \
    --workload-pool "$PROJECT_ID.svc.id.goog"
fi
