# Connection Mode Examples

This document provides detailed examples for each connection mode supported by mcp-pg-schema.

## Mode 1: Direct Connection

### Basic Connection

```bash
# Connect to local PostgreSQL
docker run -i --rm mcp-pg-schema \
  postgresql://user:password@localhost:5432/mydb

# Connect to host machine from Docker (macOS/Windows)
docker run -i --rm mcp-pg-schema \
  postgresql://user:password@host.docker.internal:5432/mydb

# Connect to PostgreSQL in same Docker network
docker run -i --rm --network my-network mcp-pg-schema \
  postgresql://user:password@postgres:5432/mydb
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "postgres-direct": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "mcp-pg-schema",
        "postgresql://host.docker.internal:5432/mydb"
      ]
    }
  }
}
```

## Mode 2: SSH Tunnel Connection

### With SSH Key Authentication (Recommended)

```bash
# Using SSH key
docker run -i --rm \
  -v ~/.ssh/id_rsa:/config/id_rsa:ro \
  mcp-pg-schema \
  --ssh ssh://user@remote-server.com:22 \
  --db postgresql://dbuser:dbpass@localhost:5432/mydb \
  --ssh-key /config/id_rsa
```

### With SSH Password Authentication

```bash
# Using SSH password
docker run -i --rm \
  mcp-pg-schema \
  --ssh ssh://user@remote-server.com:22 \
  --db postgresql://dbuser:dbpass@localhost:5432/mydb \
  --ssh-password mysshpassword
```

### Different SSH Port

```bash
# Custom SSH port
docker run -i --rm \
  -v ~/.ssh/custom_key:/config/key:ro \
  mcp-pg-schema \
  --ssh ssh://user@server.com:2222 \
  --db postgresql://dbuser:dbpass@localhost:5432/mydb \
  --ssh-key /config/key
```

### Remote PostgreSQL (not localhost)

```bash
# If PostgreSQL is on a different host than SSH server
docker run -i --rm \
  -v ~/.ssh/id_rsa:/config/id_rsa:ro \
  mcp-pg-schema \
  --ssh ssh://user@bastion-server.com:22 \
  --db postgresql://dbuser:dbpass@db-server.internal:5432/mydb \
  --ssh-key /config/id_rsa
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "postgres-ssh": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/Users/you/.ssh/id_rsa:/config/id_rsa:ro",
        "mcp-pg-schema",
        "--ssh", "ssh://user@remote-server.com:22",
        "--db", "postgresql://dbuser:dbpass@localhost:5432/mydb",
        "--ssh-key", "/config/id_rsa"
      ]
    }
  }
}
```

## Mode 3: Static SQL File

### Using a SQL Dump File

```bash
# Parse local SQL file
docker run -i --rm \
  -v /path/to/schema.sql:/config/schema.sql:ro \
  mcp-pg-schema \
  --file /config/schema.sql
```

### Creating a SQL Dump for This Mode

```bash
# Export schema only (no data) using pg_dump
pg_dump -h localhost -U myuser -d mydb \
  --schema-only \
  --no-owner \
  --no-privileges \
  -f schema.sql

# Then use with mcp-pg-schema
docker run -i --rm \
  -v $(pwd)/schema.sql:/config/schema.sql:ro \
  mcp-pg-schema \
  --file /config/schema.sql
```

### Claude Desktop Configuration

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

## Docker Compose Examples

### All Three Modes

```yaml
services:
  # Mode 1: Direct connection
  mcp-direct:
    image: mcp-pg-schema
    stdin_open: true
    tty: true
    networks:
      - db-network
    command: ["postgresql://user:pass@postgres:5432/mydb"]

  # Mode 2: SSH tunnel
  mcp-ssh:
    image: mcp-pg-schema
    stdin_open: true
    tty: true
    volumes:
      - ~/.ssh/id_rsa:/config/id_rsa:ro
    command:
      - "--ssh"
      - "ssh://user@remote-server:22"
      - "--db"
      - "postgresql://dbuser:dbpass@localhost:5432/mydb"
      - "--ssh-key"
      - "/config/id_rsa"

  # Mode 3: Static file
  mcp-file:
    image: mcp-pg-schema
    stdin_open: true
    tty: true
    volumes:
      - ./schema.sql:/config/schema.sql:ro
    command:
      - "--file"
      - "/config/schema.sql"

networks:
  db-network:
    driver: bridge
```

## Troubleshooting

### SSH Connection Issues

**Permission denied (publickey)**
- Ensure SSH key has correct permissions: `chmod 600 ~/.ssh/id_rsa`
- Verify the key is mounted correctly in Docker
- Check that the SSH user has access to the server

**Connection refused on port 22**
- Verify SSH server is running: `ssh user@server -p 22`
- Check if custom SSH port is being used
- Ensure firewall allows SSH connections

**Could not establish tunnel**
- Verify PostgreSQL host/port from SSH server: `psql -h localhost -p 5432 -U dbuser`
- Check if PostgreSQL allows connections from SSH server
- Ensure database credentials are correct

### SQL File Parsing Issues

**No tables found**
- Ensure SQL file contains CREATE TABLE statements
- Check that the schema format matches expected pattern
- Verify file is properly mounted in Docker

**Incomplete schema information**
- Static file mode has limited constraint parsing
- For full schema details, use direct or SSH connection modes
- Consider using `pg_dump --schema-only` for best results

### Direct Connection Issues

**Connection refused**
- On macOS/Windows, use `host.docker.internal` instead of `localhost`
- Verify PostgreSQL is accepting TCP connections (check `postgresql.conf`)
- Ensure `pg_hba.conf` allows connections from Docker network

**Authentication failed**
- Verify database credentials
- Check `pg_hba.conf` allows password authentication
- Ensure user has CONNECT privilege on database
