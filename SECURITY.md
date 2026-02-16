# Security Guide

## Read-Only Guarantee

This MCP server is designed with security as a primary concern. It provides **strictly read-only** access to PostgreSQL database schemas.

### How Read-Only Access is Enforced

1. **No Data Modification Operations**: The server never executes INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, or any other data modification statements
2. **Catalog Queries Only**: All queries use PostgreSQL's `information_schema` views and `pg_catalog` for metadata only
3. **Parameterized Queries**: All SQL queries use parameterized placeholders ($1, $2, etc.) to prevent SQL injection
4. **No Arbitrary SQL**: The MCP tools do not accept arbitrary SQL - they only query predefined schema information

### What the Server Can Access

- Table and column names
- Data types and constraints
- Foreign key relationships
- Index definitions
- Check constraints
- Schema-level metadata

### What the Server Cannot Access

- **Table data**: The server never queries actual table contents (no SELECT * FROM tables)
- **User passwords**: Connection credentials are used only for authentication, never logged or exposed
- **System tables**: Excludes pg_catalog and information_schema from discovery

## Database User Permissions

### Recommended Permissions

For maximum security, create a dedicated read-only PostgreSQL user for this MCP server:

```sql
-- Create a read-only user
CREATE USER mcp_reader WITH PASSWORD 'secure_password_here';

-- Grant CONNECT permission to the database
GRANT CONNECT ON DATABASE your_database TO mcp_reader;

-- Grant USAGE on schemas you want to expose
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT USAGE ON SCHEMA your_schema TO mcp_reader;

-- Grant SELECT only on information_schema and pg_catalog (for metadata)
-- No explicit grants needed - these are accessible by default

-- DO NOT GRANT: INSERT, UPDATE, DELETE, or DDL permissions
```

### Minimal Permissions Required

The server only needs:
- `CONNECT` to the database
- `USAGE` on target schemas
- Default read access to `information_schema` views (available to all users)

No table-level SELECT permissions are required because the server only reads metadata, not data.

## Credentials Management

### Best Practices

1. **Use Environment Variables**: Avoid hardcoding credentials in configuration files

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
        "PGPASSWORD": "secure_password"
      }
    }
  }
}
```

2. **Docker Secrets**: For production docker-compose  deployments, use Docker secrets:

```yaml
services:
  mcp-server:
    image: mcp-pg-schema
    secrets:
      - pg_password
    environment:
      PGPASSWORD_FILE: /run/secrets/pg_password
      PGHOST: postgres
      PGDATABASE: mydb
      PGUSER: mcp_reader

secrets:
  pg_password:
    file: ./secrets/pg_password.txt
```

3. **SSH Key Security**: When using SSH tunnel mode, protect your private keys:
   - Use `chmod 600` on key files
   - Mount keys as read-only in Docker: `-v ~/.ssh/id_rsa:/config/id_rsa:ro`
   - Never commit private keys to version control

4. **Connection String Safety**: If passing connection strings directly:
   - Store them in secure secret management (Vault, AWS Secrets Manager, etc.)
   - Avoid logging connection strings (passwords are stripped from resource URIs)
   - Rotate credentials regularly

## Network Security

### Recommended Network Configurations

1. **Firewall Rules**: Restrict database access to only the MCP server container
   - Allow connections only from MCP server IP/container
   - Use PostgreSQL's `pg_hba.conf` to limit access by source

2. **SSL/TLS Encryption**: Always use SSL for database connections:

```bash
# Connection string with SSL
postgresql://user:pass@host:5432/db?sslmode=require

# Environment variable
export PGSSLMODE=require
```

SSL modes (in order of security):
- `disable`: No SSL (NOT RECOMMENDED for production)
- `allow`: Try SSL, fallback to plain
- `prefer`: Default - try SSL first
- `require`: Require SSL, but don't verify server certificate
- `verify-ca`: Require SSL and verify server certificate
- `verify-full`: Require SSL and verify server certificate matches hostname (RECOMMENDED)

3. **SSH Tunnel**: For accessing databases across untrusted networks, always use SSH tunnel mode:
   - Encrypts all traffic through SSH
   - Leverages existing SSH authentication and security
   - No direct database exposure to public networks

4. **Docker Network Isolation**: 
   - Use isolated Docker networks
   - Don't expose PostgreSQL ports publicly
   - Use `docker network create` for private networks

## MCP Server Security Model

### Transport Security

- **stdio Transport Only**: This server uses MCP's stdio transport (not HTTP)
- Communication happens over standard input/output within the Docker container
- No network ports are opened by the MCP server itself
- Host system (e.g., Claude Desktop) manages process lifecycle

### Container Isolation

When running in Docker:
- The container has no internet access (unless explicitly configured)
- Only outbound connections to database/SSH hosts
- Filesystem access limited to mounted volumes (SQL files, SSH keys)
- No privilege escalation or host access

## Audit and Monitoring

### What to Monitor

1. **Connection Attempts**: Monitor PostgreSQL logs for authentication attempts
2. **Query Patterns**: Watch for unusual metadata query volumes
3. **Failed Authentications**: Alert on repeated failed login attempts
4. **Schema Access**: Track which schemas/tables are being queried

### PostgreSQL Logging

Enable connection and statement logging in `postgresql.conf`:

```conf
log_connections = on
log_disconnections = on
log_duration = on
log_statement = 'all'  # Or 'ddl' for just schema changes
```

## Vulnerability Disclosure

If you discover a security vulnerability in this MCP server, please:
1. Do NOT open a public GitHub issue
2. Email the maintainer directly (see repository for contact)
3. Include detailed steps to reproduce
4. Allow reasonable time for a fix before public disclosure

## Security Checklist

Before deploying to production:

- [ ] Created a dedicated read-only database user
- [ ] Granted minimal required permissions (CONNECT + USAGE only)
- [ ] Using environment variables or secrets for credentials
- [ ] Never committed credentials to version control
- [ ] Enabled SSL/TLS for database connections (`sslmode=require` or higher)
- [ ] Restricted database firewall rules to MCP server only
- [ ] Protected SSH keys with appropriate filesystem permissions (chmod 600)
- [ ] Reviewed and understood what metadata will be exposed
- [ ] Configured monitoring/logging for database access
- [ ] Using private Docker networks (not exposing ports publicly)
- [ ] Regularly rotating database credentials
- [ ] Keeping Docker base images updated

## Additional Resources

- [PostgreSQL Security Best Practices](https://www.postgresql.org/docs/current/security.html)
- [Docker Security](https://docs.docker.com/engine/security/)
- [Model Context Protocol Security](https://modelcontextprotocol.io/docs/security)
