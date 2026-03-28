#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────
SERVICE_NAME="minirtc"
REGION="${CLOUD_RUN_REGION:-us-central1}"
PORT=8080

# ─── Color helpers ───────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─── Check prerequisites ────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || error "gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install"

# ─── Authenticate with service account key ───────────────────
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    KEY_FILE="$GOOGLE_APPLICATION_CREDENTIALS"
elif [[ -n "${1:-}" ]]; then
    KEY_FILE="$1"
else
    echo ""
    echo "Usage:"
    echo "  ./deploy.sh <path-to-service-account-key.json>"
    echo ""
    echo "Or set the environment variable:"
    echo "  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json"
    echo "  ./deploy.sh"
    echo ""
    echo "To create a service account key:"
    echo "  1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts"
    echo "  2. Select or create a service account"
    echo "  3. Grant these roles:"
    echo "       - Cloud Run Admin"
    echo "       - Cloud Build Editor"
    echo "       - Service Account User"
    echo "       - Storage Admin"
    echo "  4. Keys tab → Add Key → Create new key → JSON"
    echo "  5. Save the downloaded JSON file and pass it to this script"
    echo ""
    error "No credential file provided."
fi

[[ -f "$KEY_FILE" ]] || error "Credential file not found: $KEY_FILE"

info "Authenticating with service account key..."
gcloud auth activate-service-account --key-file="$KEY_FILE"

# Extract project ID from the key file
PROJECT_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['project_id'])" "$KEY_FILE")
[[ -n "$PROJECT_ID" ]] || error "Could not read project_id from key file"

info "Project: $PROJECT_ID"
info "Region:  $REGION"
gcloud config set project "$PROJECT_ID" --quiet

# ─── Enable required APIs (idempotent) ──────────────────────
info "Enabling required APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    --quiet

# ─── Build and deploy ───────────────────────────────────────
info "Building and deploying to Cloud Run (this may take a few minutes)..."

gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --region "$REGION" \
    --port "$PORT" \
    --allow-unauthenticated \
    --session-affinity \
    --min-instances 0 \
    --max-instances 3 \
    --quiet

# ─── Get the service URL ────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region "$REGION" \
    --format "value(status.url)")

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  MiniRTC deployed successfully!${NC}"
echo -e "${GREEN}  ${SERVICE_URL}${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""
info "Share this URL to start a video call."
