# MCP PostgreSQL Schema Server

[![Model Context Protocol](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12%2B-blue)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://www.docker.com/)

A **Model Context Protocol (MCP)** server that provides secure, read-only access to PostgreSQL database schemas. This server enables LLMs like Claude to inspect and understand database structures including tables, columns, constraints, indexes, and relationships—without accessing any actual data.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard for connecting AI assistants to external data sources and tools. This server implements MCP to expose PostgreSQL database schemas to any MCP-compatible host.

## Key Features

- 🔒 **Read-only by design** - No data access, only metadata
- 🔌 **Three connection modes** - Direct,  SSH tunnel, or static SQL file
- 🚀 **MCP stdio transport** - Runs as a subprocess, no network service required
- 🐳 **Docker-only** - Consistent runtime across all platforms
- 📊 **Rich metadata** - Tables, columns, constraints, indexes, composite types, functions
- 🛡️ **Security-focused** - Minimal permissions, parameterized queries, audit-ready
- 🌐 **Cloud-ready** - Works with AWS RDS, Azure, GCP, and all PostgreSQL 12+
- 🔧 **BI/reporting aware** - Understands composite types and function signatures for complex schemas

## MCP Protocol Implementation

### Transport

This server uses **MCP stdio transport** exclusively:

- Runs as a subprocess communicating over standard input/output
- No HTTP server, no network ports exposed
- Host process (e.g., Claude Desktop) manages lifecycle
- All communication happens through newline-delimited JSON over stdin/stdout

**Why stdio?** It's simpler, more secure (no network exposure), and perfect for desktop integrations.

### MCP Tools

The server exposes six tools for querying schema metadata:

| Tool Name | Description | Required Parameters | Returns |
|-----------|-------------|---------------------|---------|
| `list_schemas` | List all database schemas | None | Array of schema names |
| `list_tables` | List all tables (optionally filtered by schema) | `schema` (optional) | Array of tables with schema and name |
| `table_schema` | Get detailed schema for a specific table | `schema`, `table` | Full table details with columns, constraints, indexes |
| `schema` | Get all tables in a schema | `schema` | Array of tables with complete metadata |
| `composite_types` | List composite types and their fields | `schema`, `type_name` (optional) | Composite types with field definitions |
| `functions` | List functions with signatures and return types | `schema`, `name` (optional), `include_internal` (optional) | Functions with arguments and return types |

**Example Tool Request/Response:**

Request (from MCP host to server):
```json
{
  "method": "tools/call",
  "params": {
    "name": "table_schema",
    "arguments": {
      "schema": "public",
      "table": "users"
    }
  }
}
```

Response  (from server to MCP host):
```json
{
  "content": [{
    "type": "text",
    "text": "{\"table_schema\":\"public\",\"table_name\":\"users\",\"columns\":[{\"column_name\":\"id\",\"data_type\":\"integer\",\"is_nullable\":\"NO\",\"column_default\":\"nextval('users_id_seq'::regclass)\"},...],\"constraints\":[...],\"indexes\":[...]}"
  }]
}
```

### MCP Resources

The server automatically discovers all tables and exposes them as MCP resources:

- **Resource URI Pattern**: `postgres://<host>/<schema>/<table>/schema`
- **Discovery**: Call MCP `resources/list` to get all available table schemas
- **Read**: Call MCP `resources/read` with a specific table URI

**Example Resource:**
```json
{
  "uri": "postgres://mydb.example.com/public/users/schema",
  "name": "\"public.users\" schema",
  "mimeType": "application/json",
  "description": "Schema for the public.users table"
}
```

Resources are useful for letting MCP hosts discover what's available, while tools are better for targeted queries.

## Usage with MCP Hosts

This server works with any MCP-compatible host. Tested with:

- ✅ **Claude Desktop** (Anthropic) - Full support
- ✅ **Cursor IDE** - Full support
- ✅ **Continue.dev** - Full support
- ✅ **Custom MCP clients** - Any client following the MCP specification

Configuration examples for each host are provided below.

## Security

⚠️ **Important**: This server provides read-only access by design but requires proper configuration for production use.

### Read-Only Guarantees

- **No data access**: Only metadata (schema, structure) is queried, never actual table data
- **No write operations**: Cannot execute INSERT, UPDATE, DELETE, CREATE, ALTER, or DROP statements
- **Parameterized queries**: All SQL uses parameterized placeholders ($1, $2) to prevent injection
- **No arbitrary SQL**: Tools only execute predefined metadata queries

### Recommended Database User Setup

Create a dedicated read-only user for this MCP server:

```sql
-- Create a read-only user
CREATE USER mcp_reader WITH PASSWORD 'secure_password_here';

-- Grant CONNECT and USAGE (no table-level permissions needed)
GRANT CONNECT ON DATABASE your_database TO mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT USAGE ON SCHEMA your_schema TO mcp_reader;

-- The user can now read metadata but NOT table data
```

### Credentials Management

**Do NOT hardcode credentials in configuration files.** Use one of these secure approaches:

#### Option 1: Environment Variables (Recommended for Claude Desktop)

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp-pg-schema"],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "mydb",
        "PGUSER": "mcp_reader",
        "PGPASSWORD": "secure_password",
        "PGSSLMODE": "require"
      }
    }
  }
}
```

#### Option 2: Docker Secrets (Recommended for Docker Compose)

```yaml
services:
  mcp-server:
    image: mcp-pg-schema
    secrets:
      - pg_password
    environment:
      PGHOST: postgres
      PGDATABASE: mydb
      PGUSER: mcp_reader
      PGPASSWORD_FILE: /run/secrets/pg_password
      PGSSLMODE: require

secrets:
  pg_password:
    file: ./secrets/pg_password.txt
```

**See [SECURITY.md](SECURITY.md) for comprehensive security guidelines.**

## Quick Start

### 1. Build the Docker Image

```bash
docker build -t mcp-pg-schema .
```

### 2. Run with Docker Compose (Includes Test Database)

```bash
# Start PostgreSQL 12 + MCP Server
docker compose up

# Or run in background
docker compose up -d
```

## Connection Modes

### Mode 1: Direct Connection

Connect directly to a PostgreSQL database using a connection string or environment variables.

#### Using Connection String

```bash
# Docker run
docker run -i --rm mcp-pg-schema postgresql://user:pass@host:5432/mydb
```

#### Using Environment Variables (Recommended)

```bash
# Docker run with env vars
docker run -i --rm \
  -e PGHOST=host.docker.internal \
  -e PGPORT=5432 \
  -e PGDATABASE=mydb \
  -e PGUSER=mcp_reader \
  -e PGPASSWORD=secure_password \
  -e PGSSLMODE=require \
  mcp-pg-schema
```

**Claude Desktop Configuration (with environment variables):**

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp-pg-schema"],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "mydb",
        "PGUSER": "mcp_reader",
        "PGPASSWORD": "your_password",
        "PGSSLMODE": "require"
      }
    }
  }
}
```

**Claude Desktop Configuration (with connection string):**

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "mcp-pg-schema",
        "postgresql://mcp_reader:password@host.docker.internal:5432/mydb?sslmode=require"
      ]
    }
  }
}
```

### Mode 2: SSH Tunnel Connection

Connect to a remote PostgreSQL database through an SSH tunnel. This is useful for accessing databases behind firewalls or when direct access is not available.

```bash
# With password authentication
docker run -i --rm \
  mcp-pg-schema \
  --ssh ssh://user@ssh-server:22 \
  --db postgresql://dbuser:dbpass@localhost:5432/mydb \
  --ssh-password your-ssh-password

# With SSH key authentication
docker run -i --rm \
  -v /path/to/ssh/key:/config/id_rsa:ro \
  mcp-pg-schema \
  --ssh ssh://user@ssh-server:22 \
  --db postgresql://dbuser:dbpass@localhost:5432/mydb \
  --ssh-key /config/id_rsa
```

**Claude Desktop Configuration:**

```json
{
  "mcpServers": {
    "postgres-ssh": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/Users/you/.ssh/id_rsa:/config/id_rsa:ro",
        "mcp-pg-schema",
        "--ssh", "ssh://user@remote-server:22",
        "--db", "postgresql://dbuser:dbpass@localhost:5432/mydb",
        "--ssh-key", "/config/id_rsa"
      ]
    }
  }
}
```

**SSH Tunnel Notes:**
- The database host in `--db` should be relative to the SSH server (often `localhost` if PostgreSQL is on the same server)
- SSH key files must be mounted into the container with `-v`
- Use `--ssh-password` for password auth or `--ssh-key` for key-based auth

### Mode 3: Static SQL File

Parse schema information from a SQL dump file (offline mode). This is useful for analyzing schemas without database access.

```bash
# Parse SQL file
docker run -i --rm \
  -v /path/to/schema.sql:/config/schema.sql:ro \
  mcp-pg-schema \
  --file /config/schema.sql
```

**Claude Desktop Configuration:**

```json
{
  "mcpServers": {
    "postgres-file": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/path/to/schema.sql:/config/schema.sql:ro",
        "mcp-pg-schema",
        "--file", "/config/schema.sql"
      ]
    }
  }
}
```

**SQL File Notes:**
- Supports standard `CREATE TABLE` statements from pg_dump
- Parses column definitions, types, and NULL constraints
- Limited constraint parsing compared to live database connection
- Best for quick schema inspection without database credentials

## Docker Network Configuration

### Connecting to Postgres in Same Network

If your postgres container is in a Docker network, add the MCP server to that network:

```yaml
services:
  mcp-server:
    image: mcp-pg-schema
    networks:
      - your-postgres-network
    command: ["postgresql://user:pass@postgres-container:5432/mydb"]

networks:
  your-postgres-network:
    external: true
```

### Connecting to Multiple Networks

To bridge between networks:

```yaml
services:
  mcp-server:
    image: mcp-pg-schema
    networks:
      - network1
      - network2
    command: ["postgresql://user:pass@postgres:5432/mydb"]
```

## Connection String Format

`postgresql://[user[:password]@][host][:port][/database][?param=value]`

### Examples

- **Host machine**: `postgresql://host.docker.internal:5432/mydb`
- **Docker network**: `postgresql://user:pass@postgres:5432/mydb`
- **Container name**: `postgresql://user:pass@my-postgres-container:5432/mydb`
- **External host**: `postgresql://user:pass@192.168.1.100:5432/mydb`

## PostgreSQL Compatibility

**Supports PostgreSQL 12, 13, 14, 15, 16+**

The server uses standard `information_schema` views that are available in all modern PostgreSQL versions (12+).

### Tested Configurations

- ✅ PostgreSQL 12-alpine (Docker)
- ✅ PostgreSQL 13-16 (Docker & standalone)
- ✅ AWS RDS PostgreSQL
- ✅ Azure Database for PostgreSQL
- ✅ Google Cloud SQL PostgreSQL

## Advanced Docker Networking

For connecting to PostgreSQL instances in separate Docker networks, see [DOCKER-NETWORKS.md](DOCKER-NETWORKS.md) for detailed examples including:

- Connecting to external Docker networks
- Bridging multiple networks
- Network discovery scripts
- Troubleshooting connection issues

## Troubleshooting

### Cannot connect to host postgres

On macOS/Windows: Use `host.docker.internal` instead of `localhost`
```bash
postgresql://host.docker.internal:5432/mydb
```

### Cannot connect to postgres in another container

1. Verify both containers are in the same network:
```bash
docker network inspect your-network-name
```

2. Use the postgres container name (not localhost):
```bash
postgresql://user:pass@postgres-container-name:5432/mydb
```

### Find docker network name

```bash
docker network ls
docker inspect <container-name> | grep NetworkMode
```

## Development

### Build and Test Locally

```bash
# Build image
docker build -t mcp-pg-schema .

# Run with test database
docker compose up

# Test connection
docker run -i --rm mcp-pg-schema postgresql://testuser:testpass@host.docker.internal:5432/testdb
```

### Rebuild After Changes

```bash
docker compose build
docker compose up
```

## SSL/TLS Support

### Enabling SSL

For production deployments, **always use SSL/TLS** encryption for database connections.

#### Via Connection String

```bash
# Require SSL (don't verify certificate)
postgresql://user:pass@host:5432/db?sslmode=require

# Require SSL with certificate verification (recommended)
postgresql://user:pass@host:5432/db?sslmode=verify-full
```

#### Via Environment Variable

```bash
export PGSSLMODE=require  # or verify-ca, verify-full
```

### SSL Modes

| Mode | Security Level | Description |
|------|---------------|-------------|
| `disable` | ❌ None | No SSL (NOT recommended for production) |
| `allow` | ⚠️ Low | Try SSL, fallback to plain |
| `prefer` | ⚠️ Medium | Try SSL first (default) |
| `require` | ✅ Good | Require SSL, but don't verify certificate |
| `verify-ca` | ✅ Better | Require SSL and verify server certificate |
| `verify-full` | ✅✅ Best | Require SSL, verify certificate matches hostname |

**Recommended for production**: `verify-full`

### Cloud Provider SSL

Most cloud providers require SSL:

- **AWS RDS**: Use `?sslmode=require` or set `PGSSLMODE=require`
- **Azure Database**: SSL enabled by default, use `sslmode=require`
- **Google Cloud SQL**: Use Cloud SQL Proxy or `sslmode=require`
- **Heroku PostgreSQL**: SSL required, automatically configured

## Tool Reference

### `list_schemas`

Lists all available schemas (excludes system schemas).

```json
{
  "name": "list_schemas",
  "arguments": {}
}
```

**Returns**: Array of schema names
```json
[
  {"schema_name": "public"},
  {"schema_name": "myapp"},
  {"schema_name": "analytics"}
]
```

### `list_tables`

Lists all tables, optionally filtered by schema.

```json
{
  "name": "list_tables",
  "arguments": {
    "schema": "public"  // optional
  }
}
```

**Returns**: Array of tables
```json
[
  {"table_schema": "public", "table_name": "users"},
  {"table_schema": "public", "table_name": "posts"}
]
```

### `table_schema`

Get detailed information for a specific table (includes indexes, constraints).

```json
{
  "name": "table_schema",
  "arguments": {
    "schema": "public",
    "table": "users"
  }
}
```

**Returns**: Comprehensive table metadata including columns, constraints, indexes

### `schema`

Get all tables and their complete metadata for an entire schema.

```json
{
  "name": "schema",
  "arguments": {
    "schema": "public"
  }
}
```

**Returns**: Array of all tables with columns, constraints, and relationships

### `composite_types`

List composite types (user-defined types) and their fields. **Especially useful for databases with complex BI/reporting structures** where domain concepts are encoded as composite types rather than just tables.

```json
{
  "name": "composite_types",
  "arguments": {
    "schema": "public",
    "type_name": "client_report"  // optional: filter to specific type
  }
}
```

**Returns**: Composite types with field definitions
```json
{
  "schema": "public",
  "types": [
    {
      "schema": "public",
      "name": "client_report",
      "kind": "composite",
      "description": "Client reporting fields used in BI functions",
      "attributes": [
        {
          "name": "clientid",
          "data_type": "integer",
          "is_nullable": true,
          "default": null,
          "ordinal_position": 1
        },
        {
          "name": "firstname",
          "data_type": "character varying",
          "is_nullable": true,
          "default": null,
          "ordinal_position": 2
        }
      ]
    }
  ]
}
```

**Why use this?** In schemas with heavy PL/pgSQL reporting logic (like social services systems or BI platforms), composite types often represent report outputs or domain aggregations. This tool helps LLMs understand those structures without executing application functions.

**Note**: Not available in static SQL file mode. Returns empty array with a note.

### `functions`

List functions and their signatures, including arguments and return types. **This is for documentation only**—the MCP server does NOT execute functions.

```json
{
  "name": "functions",
  "arguments": {
    "schema": "public",
    "name": "age_range",  // optional: filter to specific function
    "include_internal": false  // optional: include functions starting with '_'
  }
}
```

**Returns**: Functions with metadata
```json
{
  "schema": "public",
  "functions": [
    {
      "schema": "public",
      "name": "age_range",
      "argument_types": [
        {
          "name": "ageyrs",
          "data_type": "integer"
        }
      ],
      "return_type": {
        "schema": "pg_catalog",
        "name": "text",
        "kind": "scalar"
      },
      "language": "plpgsql",
      "volatility": "stable",
      "returns_set": false,
      "description": "Bucket an integer age into a textual age range"
    },
    {
      "schema": "public",
      "name": "bi_accom_fields",
      "argument_types": [
        {
          "name": "p_clientid",
          "data_type": "integer"
        }
      ],
      "return_type": {
        "schema": "public",
        "name": "bi_accom_fields",
        "kind": "composite"
      },
      "language": "plpgsql",
      "volatility": "stable",
      "returns_set": true,
      "description": "Return accommodation reporting rows"
    }
  ]
}
```

**Why use this?** When your database encapsulates business rules and reporting logic in PL/pgSQL functions (especially those returning composite types), this tool lets LLMs see how reports are structured and what data shapes to expect—without executing potentially expensive or side-effect-heavy functions.

**Note**: Not available in static SQL file mode. Returns empty array with a note.

## Real-World Example: BI/Reporting Schemas

Many production databases encode domain logic in **composite types** and **functions** rather than just tables. This is especially common in:

- **Social services systems** (case management, client tracking)
- **BI/reporting platforms** (aggregate views, domain aggregations)
- **Healthcare databases** (patient data, clinical workflows)
- **Financial systems** (transaction aggregations, risk calculations)

### Why This Matters

Consider a social services database with:

```sql
-- Domain concept encoded as composite type
CREATE TYPE client_report AS (
  clientid integer,
  firstname varchar,
  lastname varchar,
  contacts integer,
  plans integer,
  lencontacts integer
);

-- Business logic encapsulated in function
CREATE FUNCTION bi_get_client_list(start_date date, end_date date)
RETURNS SETOF client_report
LANGUAGE plpgsql
AS $$...$$;
```

**Without `composite_types` and `functions` tools**, an LLM would only see:
- Base tables (`clients`, `contacts`, `plans`)
- No understanding of how reports are structured
- No visibility into what `bi_get_client_list` returns

**With these tools**, an LLM can:
1. Use `composite_types` to see that `client_report` has fields like `contacts`, `plans`, `lencontacts`
2. Use `functions` to see that `bi_get_client_list` returns `SETOF client_report`
3. Align generated SQL with existing BI contracts
4. Understand reporting structures without executing functions

This helps LLMs **reverse-engineer BI logic** and generate queries that match how the application actually consumes data.

### Use Case: Migration or Modernization

When modernizing legacy systems with heavy PL/pgSQL logic:

- Export schema with `pg_dump --schema-only`
- Point MCP server at production database (read-only user)
- Use `composite_types` and `functions` tools to document existing contracts
- Generate migration plans that preserve reporting structures
- Validate that new queries match existing function outputs

## Limitations and Compatibility

### PostgreSQL Version Compatibility

- ✅ **Supported**: PostgreSQL 12, 13, 14, 15, 16, 17+
- ⚠️ **Not Supported**: PostgreSQL 11 and earlier
- ❌ **Other Databases**: This server only works with PostgreSQL

### Cloud Provider Compatibility

Tested and working with:
- ✅ AWS RDS PostgreSQL
- ✅ Azure Database for PostgreSQL (Flexible Server)
- ✅ Google Cloud SQL for PostgreSQL
- ✅ DigitalOcean Managed PostgreSQL
- ✅ Heroku PostgreSQL
- ✅ Supabase
- ✅ Neon
- ✅ Railway

### What's Included

- ✅ Tables, views, materialized views
- ✅ Columns with types, defaults, nullability
- ✅ Primary keys, foreign keys, unique constraints, check constraints
- ✅ Indexes (B-tree, Hash, GiST, GIN, BRIN, SP-GiST)
- ✅ Multi-column constraints
- ✅ Cross-schema foreign keys
- ✅ Table and column comments
- ✅ Composite types (user-defined types) with field definitions
- ✅ Function signatures with arguments and return types (metadata only, not executed)

### What's Not Included

- ❌ Table data (by design - metadata only)
- ❌ Partitioned table structure (shown as regular tables)
- ❌ Trigger definitions (trigger functions visible via `functions` tool)
- ❌ Function bodies/implementation (only signatures via `functions` tool)
- ❌ Row-level security policies
- ❌ Table inheritance hierarchy

**See [LIMITATIONS.md](LIMITATIONS.md) for detailed compatibility information.**

### Multi-Database Support

- ⚠️ **One database per MCP server instance**
- To access multiple databases, configure multiple MCP server instances in your host configuration

### Performance Notes

- **Large databases** (1000+ tables): Initial resource discovery may take 1-2 seconds
- **Recommended**: Use `table_schema` tool for targeted queries instead of `schema` for large schemas
- **No caching**: Metadata is queried fresh on each request (ensures accuracy)

### Static File Mode Limitations

When using `--file` mode with SQL dumps:
- ⚠️ Limited metadata (only what's in CREATE TABLE statements)
- ❌ No index information
- ❌ No check constraint details
- ❌ No table comments

**Recommendation**: Use direct or SSH tunnel modes for production access.

## Additional Documentation

- **[SECURITY.md](SECURITY.md)** - Comprehensive security guidelines, database user setup, credentials management, audit configuration
- **[LIMITATIONS.md](LIMITATIONS.md)** - Detailed compatibility matrix, known issues, performance considerations, feature support matrix
- **[DOCKER-NETWORKS.md](DOCKER-NETWORKS.md)** - Advanced Docker networking, bridging networks, troubleshooting
- **[examples/CONNECTION-EXAMPLES.md](examples/CONNECTION-EXAMPLES.md)** - More connection examples for all three modes

## Contributing

Contributions are welcome! Please see the repository for:
- Issue tracking
- Feature requests
- Pull requests

Areas for future enhancement:
- Enum value extraction
- Partition table metadata
- Function/procedure signatures
- Statistics and table size estimates

