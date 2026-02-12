#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${1:?usage: $0 <project-id>}"
SA_NAME="discloud-control-plane"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" || true

for role in roles/storage.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/container.developer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" \
    --role "$role"
done

echo "Service Account: $SA_EMAIL"
