#!/bin/bash

set -e

echo "🚀 Loading env..."
source ecr.env

IMAGE_NAME=$REPO_NAME
ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME:latest"

echo "🧹 Building Docker image..."
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --load \
  -t $IMAGE_NAME:latest .

echo "🏷️ Tagging image..."
docker tag $IMAGE_NAME:latest $ECR_URI

echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $REGION | \
docker login --username AWS --password-stdin \
$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

echo "📤 Pushing to ECR..."
docker push $ECR_URI

echo "🚀 Updating Lambda..."
aws lambda update-function-code \
  --function-name $REPO_NAME \
  --image-uri $ECR_URI

echo "🧹 Cleaning dangling images..."
docker image prune -f

echo "✅ DEPLOY COMPLETE!"