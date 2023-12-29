#!/bin/bash
set -euo pipefail

PROJECT_NAME="writer-elector-operator"
DEFAULT_GKE_PROJECT="myonlinestore-dev"
DEFAULT_GKE_ZONE="europe-west4"
DEFAULT_GKE_CLUSTER="mos-dev01"

DEFAULT_ENV="stage"
# DEFAULT_NAMESPACE="stage"
DEFAULT_NAMESPACE="operator"
# DEFAULT_CHART_VERSION="0.4.0"
DEFAULT_CHART_VERSION="1.0.3"
DEFAULT_CHART="mos/deployment"

function showUsage() {
  echo -e "Manual Kubernetes deployer for \e[1m$PROJECT_NAME\e[0m service."
  echo -e "Deploys to \e[93m$GKE_PROJECT/$GKE_ZONE/$GKE_CLUSTER\e[0m k8s cluster."
  echo -e "\e[91mUse with caution!! \e[0m"
  echo ""
  echo "Usage:"
  echo "  ./manual-deploy.sh <image_tag> [<chart:version> <app_env> <namespace> <gke_project> <gke_zone> <gke_cluster>]"
  echo ""
  echo "Options:"
  echo "  <image_tag>       tag of built docker image usually a git revision sha. (use latest to fetch most recent sha from the image repository)"
  echo "  <chart:version>   Helm chart and version to be used. [default: $DEFAULT_CHART:$DEFAULT_CHART_VERSION]"
  echo "  <app_env>         APP_ENV which should be deployed. [default: $DEFAULT_ENV]"
  echo "  <namespace>       Kubernetes namespace to be used. [default: $DEFAULT_NAMESPACE]"
  echo "  <gke_project>     GKE Project to be used. [default: $DEFAULT_GKE_PROJECT]"
  echo "  <gke_zone>        GKE Project Zone to be used. [default: $DEFAULT_GKE_ZONE]"
  echo "  <gke_cluster>     GKE Pluster to be used. [default: $DEFAULT_GKE_CLUSTER]"
  echo ""
  echo "Example":
  echo " ./manual-deploy"
  echo ""
}

IMAGE_TAG=${1-}
CHART_AND_CHARTVERSION=${2-}
APP_ENV=${3-$DEFAULT_ENV}
NAMESPACE=${4-$DEFAULT_NAMESPACE}
GKE_PROJECT=${5-$DEFAULT_GKE_PROJECT}
GKE_ZONE=${6-$DEFAULT_GKE_ZONE}
GKE_CLUSTER=${7-$DEFAULT_GKE_CLUSTER}

if [ -z $IMAGE_TAG ]; then
  showUsage
  exit 1
fi

if [ $IMAGE_TAG == "latest" ]; then
  IMAGE_TAG=$(gcloud container images list-tags --filter="tags[]=latest" eu.gcr.io/$GKE_PROJECT/$PROJECT_NAME 2>&1 | head -n 2 | tail -1 | awk -F' ' '{print $2}' | awk -F',' '{print $1}')

  if [ -z "$IMAGE_TAG" ]; then
    echo 'Image tag "latest" not found, deployment aborted'
    exit 1
  fi

  echo "Image tag "latest" found! ($IMAGE_TAG)"
fi

if [ ! -z $CHART_AND_CHARTVERSION ]; then
  CHART=$(echo $CHART_AND_CHARTVERSION | cut -f1 -d:)
  CHART_VERSION=$(echo $CHART_AND_CHARTVERSION | cut -f2 -d:)

  # If :version is not specified in input (causing CHART_VERSION above to be the same as CHART) set CHART_VERSION back to default.
  [ $CHART == $CHART_VERSION ] && CHART_VERSION=$DEFAULT_CHART_VERSION
else
  CHART=$DEFAULT_CHART
  CHART_VERSION=$DEFAULT_CHART_VERSION
fi

IMAGE_HASH=$(gcloud container images describe eu.gcr.io/$GKE_PROJECT/$PROJECT_NAME:$IMAGE_TAG --format=json | jq .image_summary.digest --raw-output)

VALUE_FILES=""
if [ -f ./base-values.yml ]; then
  VALUE_FILES="-f ./base-values.yml"
fi
if [ -f ./base-values-$APP_ENV.yml ]; then
  VALUE_FILES="$VALUE_FILES -f ./base-values-$APP_ENV.yml"
fi
if [ -f ./values.yml ]; then
  VALUE_FILES="$VALUE_FILES -f ./values.yml"
fi
if [ -f ./values-$APP_ENV.yml ]; then
  VALUE_FILES="$VALUE_FILES -f ./values-$APP_ENV.yml"
fi

helm diff upgrade $PROJECT_NAME $CHART \
  --version $CHART_VERSION \
  $VALUE_FILES \
  --set fullnameOverride=$PROJECT_NAME \
  --set nameOverride=$PROJECT_NAME \
  --set image.repository=eu.gcr.io/$GKE_PROJECT \
  --set image.name=$PROJECT_NAME \
  --set image.tag=$IMAGE_TAG \
  --set image.hash=$IMAGE_HASH \
  --set cluster.name=$GKE_CLUSTER \
  --set project=$GKE_PROJECT \
  --namespace $NAMESPACE \
  --detailed-exitcode \
  --allow-unreleased && echo "Helm Diff: No changes" || true

read -p "Do you want to perform these changes? y/N: " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  helm upgrade --install $PROJECT_NAME $CHART \
  --version $CHART_VERSION \
  $VALUE_FILES \
  --set fullnameOverride=$PROJECT_NAME \
  --set nameOverride=$PROJECT_NAME \
  --set image.repository=eu.gcr.io/$GKE_PROJECT \
  --set image.name=$PROJECT_NAME \
  --set image.tag=$IMAGE_TAG \
  --set image.hash=$IMAGE_HASH \
  --set cluster.name=$GKE_CLUSTER \
  --set project=$GKE_PROJECT \
  --namespace $NAMESPACE
else
  echo "Deployment aborted"
  exit 1
fi
