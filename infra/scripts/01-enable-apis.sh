#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${1:?usage: $0 <project-id>}"

gcloud services enable \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  container.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT_ID"
