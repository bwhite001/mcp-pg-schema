#!/bin/bash
# Helper script to discover Docker networks and test connections
# Usage: ./scripts/discover-networks.sh [container-name]

set -e

echo "=== Docker Networks ==="
docker network ls

echo ""
echo "=== Active PostgreSQL Containers ==="
docker ps --filter "ancestor=postgres" --format "table {{.Names}}\t{{.Image}}\t{{.Networks}}\t{{.Status}}"
docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Image}}\t{{.Networks}}\t{{.Status}}"

if [ -n "$1" ]; then
    echo ""
    echo "=== Network Details for '$1' ==="
    docker inspect "$1" | grep -A 5 "NetworkMode\|Networks"
fi

echo ""
echo "=== Quick Test Command ==="
echo "docker run -i --rm --network <NETWORK_NAME> mcp-pg-schema postgresql://user:pass@postgres:5432/db"
