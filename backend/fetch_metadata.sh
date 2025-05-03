#!/bin/bash

# Check if required commands are available
if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed." >&2
    exit 1
fi
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed." >&2
    exit 1
fi

# Fetch token and session ID dynamically from the backend
AUTH_RESPONSE=$(curl -s -X GET "http://localhost:5000/api/mayan/auth")
if [ $? -ne 0 ]; then
    echo "Error: Failed to fetch authentication details." >&2
    exit 1
fi

CSRF_TOKEN=$(echo $AUTH_RESPONSE | jq -r '.token')
SESSION_ID=$(echo $AUTH_RESPONSE | jq -r '.sessionId')

if [ -z "$CSRF_TOKEN" ] || [ -z "$SESSION_ID" ]; then
    echo "Error: Missing CSRF token or session ID." >&2
    exit 1
fi

# Define your headers and base URL
BASE_URL=${BASE_URL:-"http://localhost"}

# Step 1 + Step 2 combined
printf "%-20s %-20s\n" "Document ID" "Metadata"
for id in $(curl -s -X GET \
    "$BASE_URL/api/v4/workflow_templates/1/states/3/documents/" \
    -H "accept: application/json" \
    -H "X-CSRFToken: $CSRF_TOKEN" \
    -H "Cookie: sessionid=$SESSION_ID" \
    | jq -r '.results[].id'); do

    if [ -z "$id" ]; then
        echo "Error: No document IDs found." >&2
        continue
    fi

    echo "----- Document ID: $id -----"

    # Step 2: Get metadata for each document
    METADATA=$(curl -s -X GET \
        "$BASE_URL/api/v4/documents/$id/metadata/?_ordering=id" \
        -H "accept: application/json" \
        -H "X-CSRFToken: $CSRF_TOKEN" \
        -H "Cookie: sessionid=$SESSION_ID" \
        | jq -r '.results[] | "\(.metadata_type.label): \(.value)"')

    if [ -z "$METADATA" ]; then
        echo "Warning: No metadata found for document ID $id." >&2
        continue
    fi

    printf "%-20s %-20s\n" "$id" "$METADATA"
done