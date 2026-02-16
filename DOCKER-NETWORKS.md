# Connecting to External PostgreSQL in Docker Networks

This guide shows how to connect the MCP Schema Server to a PostgreSQL instance running in a separate Docker network.

## Scenario 1: Postgres in a Named Docker Network

### Step 1: Find Your Postgres Network

```bash
# List all Docker networks
docker network ls

# Inspect your postgres container to find its network
docker inspect your-postgres-container | grep -i network
```

Example output:
```
NETWORK ID     NAME                    DRIVER    SCOPE
abc123def456   my-postgres-network     bridge    local
```

### Step 2: Configure Connection

Edit `docker-compose.external.yml`:

```yaml
services:
  mcp-server:
    image: mcp-pg-schema
    stdin_open: true
    tty: true
    networks:
      - my-postgres-network  # Your actual network name
    command: ["postgresql://user:pass@postgres-container:5432/mydb"]

networks:
  my-postgres-network:
    external: true
```

### Step 3: Run the MCP Server

```bash
docker compose -f docker-compose.external.yml up
```

## Scenario 2: Connect via Docker Run

If you don't want to use docker-compose:

```bash
# Build the image first
docker build -t mcp-pg-schema .

# Run with network connection
docker run -i --rm \
  --network my-postgres-network \
  mcp-pg-schema \
  postgresql://user:password@postgres-host:5432/database
```

## Scenario 3: Bridge Multiple Networks

If you need to connect to postgres in one network and expose to another:

```yaml
services:
  mcp-server:
    image: mcp-pg-schema
    networks:
      - postgres-network      # Where postgres lives
      - application-network   # Your app network
    command: ["postgresql://user:pass@postgres:5432/mydb"]

networks:
  postgres-network:
    external: true
    name: actual-postgres-network-name
  application-network:
    external: true
    name: actual-app-network-name
```

## Scenario 4: Host Machine Postgres

### On macOS/Windows:
```bash
docker run -i --rm mcp-pg-schema \
  postgresql://host.docker.internal:5432/mydb
```

### On Linux:
```bash
docker run -i --rm --network host mcp-pg-schema \
  postgresql://localhost:5432/mydb
```

## Scenario 5: Claude Desktop with External Postgres

Edit your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network", "your-postgres-network",
        "mcp-pg-schema",
        "postgresql://user:pass@postgres-container:5432/mydb"
      ]
    }
  }
}
```

## Troubleshooting

### Error: "network not found"

Make sure the network exists:
```bash
docker network ls
```

If using external network, ensure it's marked as `external: true` in docker-compose.

### Error: "could not connect to server"

1. Verify postgres container is running:
```bash
docker ps | grep postgres
```

2. Check they're on the same network:
```bash
docker network inspect your-network-name
```

3. Use container name (not localhost) as hostname

### Error: "authentication failed"

Verify credentials by connecting directly:
```bash
docker exec -it postgres-container psql -U username -d database
```

## Helper Script

Use the included script to discover networks:

```bash
./scripts/discover-networks.sh [container-name]
```

## Testing Connection

Once configured, test the connection:

```bash
# In one terminal - start MCP server
docker compose -f docker-compose.external.yml up

# The server will connect and expose schema information via MCP protocol
```

## PostgreSQL Version Support

Supports PostgreSQL 12, 13, 14, 15, 16+ (any version with standard information_schema views)
