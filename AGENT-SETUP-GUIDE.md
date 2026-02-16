# Agent Setup Guide - MCP PostgreSQL Schema Server

> **Purpose**: This document provides comprehensive instructions for AI agents to understand, install, and configure the MCP PostgreSQL Schema Server.

## Repository Overview

**Repository**: `bwhite001/mcp-pg-schema`  
**Version**: 0.4.0  
**Author**: bwhite001  
**License**: MIT

### What This Server Does

This is a **Model Context Protocol (MCP) server** that provides read-only access to PostgreSQL database schema metadata. It enables AI assistants to:
- Inspect database structure (tables, columns, constraints, indexes)
- Understand relationships between tables
- Query composite types and function signatures
- **WITHOUT** accessing actual table data (metadata only)

### Key Capabilities

- **Read-only by design**: No data access, only schema metadata
- **Three connection modes**: Direct database, SSH tunnel, or static SQL file
- **MCP stdio transport**: Runs as subprocess, no network ports
- **Docker-only deployment**: Consistent cross-platform execution
- **PostgreSQL 12+ support**: Works with all modern PostgreSQL versions

## Project Structure

```
/mcp/mcp-pg-schema/
├── index.ts                    # Main server implementation (~1300 lines)
├── package.json                # NPM dependencies and build scripts
├── tsconfig.json              # TypeScript configuration
├── Dockerfile                 # Docker image definition
├── docker-compose.yml         # Local test environment
├── README.md                  # User documentation
├── SECURITY.md                # Security guidelines
├── LIMITATIONS.md             # Compatibility information
├── DOCKER-NETWORKS.md         # Advanced networking guide
├── examples/
│   ├── CONNECTION-EXAMPLES.md # Connection mode examples
│   └── sample-schema.sql      # Test database schema
└── scripts/
    └── discover-networks.sh   # Network discovery utility
```

## Installation Steps

### Step 1: Verify Prerequisites

Before installation, ensure:

```bash
# Check Docker is installed and running
docker --version
# Expected: Docker version 20.x or higher

docker ps
# Should not show errors (Docker daemon running)

# Verify working directory
pwd
# Should be: /mcp/mcp-pg-schema
```

### Step 2: Build the Docker Image

```bash
cd /mcp/mcp-pg-schema
docker build -t mcp-pg-schema .
```

**Expected output**: Image builds successfully, ending with:
```
Successfully built <image-id>
Successfully tagged mcp-pg-schema:latest
```

**Verify build**:
```bash
docker images | grep mcp-pg-schema
# Should show: mcp-pg-schema   latest   <image-id>   <time>   <size>
```

### Step 3: Choose Installation Type

Select one of three installation types based on user needs:

#### Type A: Local Development (with test database)

**Use when**: User wants to test the server with an included PostgreSQL instance.

```bash
# Start both PostgreSQL test database and MCP server
docker compose up -d

# Verify running
docker compose ps
# Should show: postgres (healthy), mcp-server (running)

# Test connection
docker compose logs mcp-server
# Should show MCP server initialization messages
```

**Stop when done**:
```bash
docker compose down
```

#### Type B: GitHub Copilot Integration

**Use when**: User wants to use the server with GitHub Copilot in VS Code.

**Configuration Location**:
- **macOS/Linux**: `~/.vscode/settings.json` or workspace `.vscode/settings.json`
- **Windows**: `%APPDATA%\Code\User\settings.json`

**Basic Configuration (Direct Connection)**:
```json
{
  "github.copilot.chat.mcp.servers": {
    "postgres": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp-pg-schema"],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "YOUR_DATABASE_NAME",
        "PGUSER": "YOUR_DATABASE_USER",
        "PGPASSWORD": "YOUR_DATABASE_PASSWORD",
        "PGSSLMODE": "require"
      }
    }
  }
}
```

**Replace**:
- `YOUR_DATABASE_NAME`: Actual database name
- `YOUR_DATABASE_USER`: Database username (recommend read-only user)
- `YOUR_DATABASE_PASSWORD`: Database password

**Platform-specific adjustments**:
- **macOS/Windows**: Use `host.docker.internal` for localhost connections
- **Linux**: Add `--network=host` to args: `["run", "-i", "--rm", "--network=host", "mcp-pg-schema"]`

**After configuration**:
1. Reload VS Code: `Cmd/Ctrl + Shift + P` → "Developer: Reload Window"
2. Open GitHub Copilot Chat
3. Test with: "List all tables in the database"

#### Type C: Claude Desktop Integration

**Use when**: User wants to use the server with Claude Desktop.

**Configuration Location**:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Configuration (Direct Connection)**:
```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp-pg-schema"],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "YOUR_DATABASE_NAME",
        "PGUSER": "YOUR_DATABASE_USER",
        "PGPASSWORD": "YOUR_DATABASE_PASSWORD",
        "PGSSLMODE": "require"
      }
    }
  }
}
```

**After configuration**:
1. Restart Claude Desktop
2. Look for MCP server indicator in interface
3. Test with: "What tables are in my database?"

### Step 4: Connection Mode Configuration

Choose the appropriate connection mode:

#### Mode 1: Direct Database Connection

**Use when**: PostgreSQL is directly accessible (same machine, Docker network, or cloud database).

**Environment Variables Method (Recommended)**:
```json
"env": {
  "PGHOST": "host.docker.internal",     // or actual hostname
  "PGPORT": "5432",
  "PGDATABASE": "mydb",
  "PGUSER": "mcp_reader",
  "PGPASSWORD": "secure_password",
  "PGSSLMODE": "require"                // or disable, allow, prefer, verify-ca, verify-full
}
```

**Connection String Method**:
```json
"args": [
  "run", "-i", "--rm",
  "mcp-pg-schema",
  "postgresql://mcp_reader:password@host.docker.internal:5432/mydb?sslmode=require"
]
```

**Common hosts**:
- Localhost (macOS/Windows): `host.docker.internal`
- Localhost (Linux): Use `--network=host` arg
- Docker container: `container-name` (must be same network)
- Remote server: `hostname.example.com` or IP address

#### Mode 2: SSH Tunnel Connection

**Use when**: PostgreSQL is behind a firewall or bastion host requiring SSH access.

**With SSH Key**:
```json
"args": [
  "run", "-i", "--rm",
  "-v", "/Users/you/.ssh/id_rsa:/config/id_rsa:ro",
  "mcp-pg-schema",
  "--ssh", "ssh://username@ssh-server:22",
  "--db", "postgresql://dbuser:dbpass@localhost:5432/mydb",
  "--ssh-key", "/config/id_rsa"
]
```

**With SSH Password**:
```json
"args": [
  "run", "-i", "--rm",
  "mcp-pg-schema",
  "--ssh", "ssh://username@ssh-server:22",
  "--db", "postgresql://dbuser:dbpass@localhost:5432/mydb",
  "--ssh-password", "ssh-password-here"
]
```

**Important**: The `--db` host should be relative to the SSH server (usually `localhost` if PostgreSQL is on the same server).

#### Mode 3: Static SQL File

**Use when**: No database access available, working with exported schema.

**Export schema first** (if needed):
```bash
pg_dump -h hostname -U username -d database --schema-only -f schema.sql
```

**Configuration**:
```json
"args": [
  "run", "-i", "--rm",
  "-v", "/absolute/path/to/schema.sql:/config/schema.sql:ro",
  "mcp-pg-schema",
  "--file", "/config/schema.sql"
]
```

**Limitations**: Static file mode has reduced metadata (no indexes, limited constraints, no composite types or functions).

### Step 5: Security Configuration

#### Create Read-Only Database User (Recommended)

```sql
-- Connect to PostgreSQL as superuser
psql -h localhost -U postgres -d your_database

-- Create dedicated read-only user
CREATE USER mcp_reader WITH PASSWORD 'secure_random_password';

-- Grant minimal permissions (metadata access only)
GRANT CONNECT ON DATABASE your_database TO mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT USAGE ON SCHEMA your_schema_name TO mcp_reader;

-- Verify no table access
-- (mcp_reader can see structure but cannot SELECT actual data)
```

#### Enable SSL (Production)

**For cloud databases** (AWS RDS, Azure, GCP):
```json
"env": {
  "PGSSLMODE": "require"  // or verify-full for certificate validation
}
```

**SSL Modes**:
- `disable`: No SSL (not recommended)
- `require`: SSL required, no certificate verification
- `verify-full`: SSL required with hostname verification (most secure)

### Step 6: Verification and Testing

#### Test 1: Direct Docker Execution

```bash
# Test direct connection (replace with your connection details)
docker run -i --rm mcp-pg-schema \
  postgresql://mcp_reader:password@host.docker.internal:5432/mydb

# Should output: MCP server initialization messages (if successful)
# Press Ctrl+C to stop
```

#### Test 2: Interactive Testing via MCP Client

Once configured in GitHub Copilot or Claude Desktop:

**Test queries**:
1. "List all schemas in the database"
2. "Show me the schema for the users table"
3. "What are all the foreign key relationships?"
4. "List all composite types in the public schema"
5. "Show me the functions in the reporting schema"

#### Test 3: Check Server Logs

**Docker Compose**:
```bash
docker compose logs mcp-server
```

**GitHub Copilot**:
- VS Code → Output panel → "GitHub Copilot Chat"

**Claude Desktop**:
- Check application logs (varies by OS)

## Troubleshooting

### Issue: Cannot connect to database

**Symptoms**: Connection refused, timeout, or authentication errors

**Solutions**:
```bash
# Test database connectivity from Docker
docker run -it --rm postgres:12 psql postgresql://user:pass@host.docker.internal:5432/db

# If this fails, check:
# 1. PostgreSQL is running: docker ps | grep postgres
# 2. Firewall allows connections
# 3. PostgreSQL accepts remote connections (postgresql.conf: listen_addresses)
# 4. pg_hba.conf allows the connection method
```

### Issue: MCP server not appearing in client

**For GitHub Copilot**:
1. Verify Docker image exists: `docker images | grep mcp-pg-schema`
2. Check VS Code settings.json syntax (valid JSON)
3. Reload VS Code: Cmd/Ctrl + Shift + P → "Developer: Reload Window"
4. Check Output panel for errors

**For Claude Desktop**:
1. Verify config file location and syntax
2. Restart Claude Desktop completely
3. Check for MCP indicator in UI

### Issue: Docker permission denied

**Linux**:
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in, or:
newgrp docker
```

### Issue: SSH key permission errors

```bash
# Fix SSH key permissions
chmod 600 ~/.ssh/id_rsa

# Verify key works
ssh -i ~/.ssh/id_rsa user@ssh-server
```

## Available MCP Tools

Once installed, the server exposes these tools:

| Tool | Purpose | Required Parameters |
|------|---------|---------------------|
| `list_schemas` | List all database schemas | None |
| `list_tables` | List tables (optionally by schema) | `schema` (optional) |
| `table_schema` | Get detailed table metadata | `schema`, `table` |
| `schema` | Get all tables in a schema | `schema` |
| `composite_types` | List user-defined types | `schema`, `type_name` (optional) |
| `functions` | List function signatures | `schema`, `name` (optional), `include_internal` (optional) |

## Agent Decision Tree

Use this decision tree to guide installation choices:

```
Is Docker installed and running?
├─ NO → Install Docker first, then restart
└─ YES → Continue

What is the use case?
├─ Testing/Development → Use docker-compose.yml (includes test DB)
├─ GitHub Copilot → Configure VS Code settings.json
├─ Claude Desktop → Configure claude_desktop_config.json
└─ Custom MCP client → Use docker run with appropriate connection mode

Can you directly connect to PostgreSQL?
├─ YES → Use Direct Connection Mode (env vars or connection string)
├─ NO, but SSH access available → Use SSH Tunnel Mode
└─ NO, but have schema dump → Use Static SQL File Mode

Is this for production use?
├─ YES → Create read-only user + Enable SSL (sslmode=require or verify-full)
└─ NO → Can use existing credentials

Is PostgreSQL on localhost?
├─ macOS/Windows → Use host.docker.internal
└─ Linux → Add --network=host to docker args
```

## Quick Reference Commands

```bash
# Build image
docker build -t mcp-pg-schema .

# Test with docker-compose
docker compose up -d
docker compose down

# Manual test (direct connection)
docker run -i --rm mcp-pg-schema postgresql://user:pass@host:5432/db

# Manual test (SSH tunnel with key)
docker run -i --rm \
  -v ~/.ssh/id_rsa:/config/id_rsa:ro \
  mcp-pg-schema \
  --ssh ssh://user@host:22 \
  --db postgresql://dbuser:dbpass@localhost:5432/db \
  --ssh-key /config/id_rsa

# Manual test (static file)
docker run -i --rm \
  -v /path/to/schema.sql:/config/schema.sql:ro \
  mcp-pg-schema \
  --file /config/schema.sql

# View logs
docker compose logs mcp-server
docker logs <container-id>

# Cleanup
docker compose down
docker rmi mcp-pg-schema
```

## Additional Resources

- **README.md**: Comprehensive user documentation
- **SECURITY.md**: Security best practices and user setup
- **LIMITATIONS.md**: Compatibility matrix and known issues
- **DOCKER-NETWORKS.md**: Advanced Docker networking scenarios
- **examples/CONNECTION-EXAMPLES.md**: More connection examples

## Support and Troubleshooting

If installation fails:

1. **Verify prerequisites**: Docker version, connectivity, permissions
2. **Check logs**: Docker logs, VS Code Output panel, or Claude Desktop logs
3. **Test connection manually**: Use `docker run` commands above
4. **Review security**: Firewall rules, PostgreSQL authentication, SSL requirements
5. **Consult documentation**: README.md and specific mode documentation

## Summary

Once completed, you should have:
- ✅ Docker image built: `mcp-pg-schema`
- ✅ Configuration file updated (VS Code settings.json or Claude Desktop config)
- ✅ Connection verified (can query schema metadata)
- ✅ Security configured (read-only user, SSL enabled)

The MCP server will now provide PostgreSQL schema context to your AI assistant without exposing actual table data.
