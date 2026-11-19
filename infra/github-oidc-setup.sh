#!/usr/bin/env bash
# One-time bootstrap, run in Azure Cloud Shell. Creates the VTS resource group and a GitHub OIDC identity (no stored secret).
# The VTS shares an existing Container Apps environment + PostgreSQL server (SHARED_RG) and links to a PCS (PCS_RG),
# so the identity gets Contributor on those groups too (place the app, create its database, read the PCS link credentials).
# Usage: bash github-oidc-setup.sh <shared-rg> <pcs-rg> [vts-rg=rg-vts-dev] [location=centralindia] [repo=indranil32/vts] [environment=azure-dev] [repo-id] [owner-id]
set -euo pipefail
SHARED_RG=$1; PCS_RG=$2; RG=${3:-rg-vts-dev}; LOC=${4:-centralindia}; REPO=${5:-indranil32/vts}; ENVN=${6:-azure-dev}; REPO_ID=${7:-}; OWNER_ID=${8:-}
SUB=$(az account show --query id -o tsv); TENANT=$(az account show --query tenantId -o tsv)
az group create -n "$RG" -l "$LOC" -o none
APPID=$(az ad app list --display-name vts-github-deploy --query "[0].appId" -o tsv)
[ -n "$APPID" ] || APPID=$(az ad app create --display-name vts-github-deploy --query appId -o tsv)
az ad sp show --id "$APPID" >/dev/null 2>&1 || az ad sp create --id "$APPID" -o none
cred() { az ad app federated-credential create --id "$APPID" --parameters "{\"name\":\"$1\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"$2\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none 2>/dev/null || echo "(credential $1 already exists)"; }
cred "github-$ENVN" "repo:$REPO:environment:$ENVN"
# GitHub may send an ID-based subject (repo:owner@ownerId/name@repoId:...) — register it too when the IDs are given.
[ -n "$REPO_ID" ] && [ -n "$OWNER_ID" ] && cred "github-$ENVN-ids" "repo:${REPO%%/*}@$OWNER_ID/${REPO##*/}@$REPO_ID:environment:$ENVN"
for scope in "$RG" "$SHARED_RG" "$PCS_RG"; do
  az role assignment create --assignee "$APPID" --role Contributor --scope "/subscriptions/$SUB/resourceGroups/$scope" -o none 2>/dev/null || echo "(role on $scope already exists)"
done
cat <<OUT

=== GitHub → $REPO → Settings → Environments → $ENVN → Variables ===
AZURE_CLIENT_ID=$APPID
AZURE_TENANT_ID=$TENANT
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_RESOURCE_GROUP=$RG
SHARED_RESOURCE_GROUP=$SHARED_RG
PCS_RESOURCE_GROUP=$PCS_RG
(No secrets needed: passwords are generated on the first deploy and the PCS link is created automatically.)
OUT
