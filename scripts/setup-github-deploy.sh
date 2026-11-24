#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy to Firebase without a key file
# (Workload Identity Federation). Run it in Google Cloud Shell:
# console.cloud.google.com → the >_ icon at the top right → paste → Enter.
set -euo pipefail
PROJECT_ID=trash-lads-4391d
REPO=bvalentine011/TrashLads
SA_NAME=github-deployer
SA="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" --quiet
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

echo "Turning on the Google services the deploy needs…"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com --quiet

echo "Creating the deploy account…"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub deploy (Trash Lads)" --quiet

echo "Giving it permission to deploy…"
for ROLE in roles/editor roles/firebase.admin roles/cloudfunctions.admin roles/run.admin \
            roles/secretmanager.admin roles/iam.serviceAccountUser roles/cloudscheduler.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

echo "Letting only the $REPO repository use it…"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub" --quiet
gcloud iam workload-identity-pools providers describe trashlads-repo --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc trashlads-repo --location=global --workload-identity-pool=github \
    --display-name="TrashLads repo" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$REPO'" --quiet
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" \
  --condition=None --quiet >/dev/null

echo
echo "Done. GitHub can now deploy to $PROJECT_ID (project number $PROJECT_NUMBER)."
