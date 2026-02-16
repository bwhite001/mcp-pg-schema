# Limitations and Known Issues

## PostgreSQL Version Compatibility

### Supported Versions
- **PostgreSQL 12, 13, 14, 15, 16, 17+**

The server uses standard `information_schema` views that are available in all modern PostgreSQL versions (12+).

### Unsupported Versions
- PostgreSQL 11 and earlier: Not tested, may work but not officially supported
- Non-PostgreSQL databases: This server is PostgreSQL-specific and will not work with MySQL, MariaDB, SQL Server, Oracle, etc.

## Database Objects

### Fully Supported
- ✅ Regular tables (heap tables)
- ✅ Views
- ✅ Columns with all standard data types
- ✅ Primary keys
- ✅ Foreign keys
- ✅ Unique constraints
- ✅ Check constraints
- ✅ Not-null constraints
- ✅ Indexes (B-tree, Hash, GiST, GIN, BRIN, SP-GiST)
- ✅ Default values
- ✅ Column comments
- ✅ Table comments
- ✅ **Composite Types**: User-defined types with field definitions (via `composite_types` tool)
- ✅ **Functions/Procedures**: Signatures, arguments, return types (via `functions` tool - metadata only, not executed)

### Partially Supported
- ⚠️ **Partitioned Tables**: Treated as regular tables; partition structure not exposed
- ⚠️ **Materialized Views**: Listed as tables; materialized view metadata not distinguished
- ⚠️ **Foreign Tables** (FDW): Listed but limited metadata available
- ⚠️ **Inherited Tables**: Parent-child relationships not explicitly shown
- ⚠️ **Enums**: Data type shown; enum values exposed via `composite_types` tool (kind='enum')
- ⚠️ **Domains**: Shown as base type; domain constraints exposed via `composite_types` tool (kind='domain')
- ⚠️ **Array Columns**: Type shown (e.g., `integer[]`) but array bounds not detailed

### Not Supported
- ❌ Table storage parameters (fillfactor, autovacuum settings, etc.)
- ❌ Column-level privileges
- ❌ Row-level security policies
- ❌ Triggers and trigger functions (trigger metadata visible via `functions` tool, but not execution logic)
- ❌ Rules
- ❌ Policies
- ❌ Statistics targets
- ❌ Table inheritance hierarchy
- ❌ Partition strategies and bounds
- ❌ Sequence details (beyond column defaults)
- ❌ Function/procedure bodies (only signatures/metadata via `functions` tool)
- ❌ Extension-specific objects

## Connection Modes

### Direct Connection
- ✅ Stable and well-tested
- ✅ Full feature support (tables, composite types, functions)
- ✅ Best performance
- ⚠️ Requires network access to database

### SSH Tunnel
- ✅ Secure remote access
- ✅ Full feature support (tables, composite types, functions)
- ⚠️ Slightly slower than direct connection
- ⚠️ Requires SSH server access
- ⚠️ Connection pool shared across tunnel - may have overhead

### Static SQL File
- ✅ Offline, no database required
- ✅ Good for documentation/sharing schemas
- ❌ **Limited metadata**: Only table structure from CREATE TABLE statements
- ❌ **No indexes**: Index information not parsed
- ❌ **Limited constraints**: Basic PRIMARY KEY and FOREIGN KEY only
- ❌ **No check constraints**: Check constraint logic not extracted
- ❌ **No comments**: Table/column comments not available
- ❌ **No composite types**: `composite_types` tool returns empty array
- ❌ **No functions**: `functions` tool returns empty array
- ❌ **Simple parsing**: May not handle complex SQL syntax

**Recommendation**: Use direct or SSH connection for full metadata including composite types and functions. Static file mode is best for quick schema review or demo purposes.

## Scale and Performance

### Database Size Limits
- **No hard limits**: Works with databases of any size
- **Schema discovery**: `listTables()` and `listSchemas()` query all user schemas
  - For databases with 1000+ tables, initial discovery may take 1-2 seconds
  - Catalogs are queried fresh on each request (no caching)

### Best Practices for Large Databases
- Use `table_schema` tool instead of `schema` tool to query one table at a time
- Filter by specific schema name when using `list_tables`
- Consider connection pooling settings for high query volume

### Query Timeouts
- **No built-in timeouts**: Relies on PostgreSQL's `statement_timeout` setting
- **Recommended**: Set `statement_timeout` on the database user:
  ```sql
  ALTER ROLE mcp_reader SET statement_timeout = '30s';
  ```

### Concurrent Connections
- Uses `pg.Pool` with default settings (10 connections)
- Safe for concurrent MCP tool calls
- SSH tunnel mode shares pool across tunnel stream

## Schema Coverage

### Multi-Database Access
- ❌ **Single database only**: One MCP server instance connects to one database
- **Workaround**: Configure multiple MCP server instances in Claude Desktop config, one per database

### Schema Filtering
- ✅ Automatically excludes system schemas: `pg_catalog`, `information_schema`, `pg_toast`
- ✅ Includes all user schemas by default
- ❌ **No per-schema access control**: If the database user has access, the server exposes it

### Cross-Schema Queries
- ✅ Can query any schema the database user has USAGE permission on
- ✅ Foreign keys across schemas are resolved correctly

## MCP Protocol

### Transport
- ✅ **stdio transport only**: Runs as a subprocess
- ❌ **No HTTP/WebSocket transport**: Cannot run as a network service

### Resources vs Tools
- **Resources** (`listResources`): Returns every table as a resource URI
  - For databases with 1000+ tables, may be slow or overwhelming for MCP clients
- **Tools**: Recommended approach for large databases - query selectively

### Request Limits
- No artificial limits on JSON payload size
- Depends on MCP host (Claude Desktop, Cursor, etc.) limits

## Environment Variables

### Supported
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`

### Not Supported
- `PGDATA`, `PGSERVICE`, `PGSERVICEFILE`: Not applicable (client-only)
- `PGOPTIONS`, `PGAPPNAME`: Could be added if needed
- `PGPASSFILE`: Not implemented (use direct password or SSH key)

## Security Constraints

### Read-Only Enforcement
- ✅ No DML/DDL operations permitted by design
- ⚠️ **Depends on database user permissions**: If the database user has write permissions, ensure proper auditing

### SSL/TLS
- ✅ Supports all PostgreSQL SSL modes via connection string or `PGSSLMODE`
- ❌ **No custom SSL certificate validation**: Relies on system trust store
- **Workaround**: Mount custom CA certificates into Docker container

## Cloud Provider Compatibility

### Tested and Working
- ✅ AWS RDS PostgreSQL
- ✅ Azure Database for PostgreSQL
- ✅ Google Cloud SQL for PostgreSQL
- ✅ DigitalOcean Managed PostgreSQL
- ✅ Heroku PostgreSQL
- ✅ Supabase

### Known Issues
- **Amazon RDS**: Some catalog views may require `rds_superuser` role
- **Azure**: Older flexible server instances may have restricted `pg_catalog` access
- **Cloud SQL**: Ensure " Allow all IP addresses" or use Cloud SQL Proxy if using direct mode

## Static SQL File Parsing

The static file parser is intentionally simple and has these limitations:

### Parsing Capabilities
- ✅ Basic CREATE TABLE statements
- ✅ Column names and types
- ✅ NOT NULL constraints
- ✅ DEFAULT values (simple literals only)
- ⚠️ PRIMARY KEY inline constraints (extracted but not detailed)
- ⚠️ FOREIGN KEY constraints (partially extracted)

### Not Parsed
- ❌ CREATE INDEX statements
- ❌ ALTER TABLE statements
- ❌ Complex DEFAULT expressions (e.g., function calls)
- ❌ CHECK constraints
- ❌ Partial indexes
- ❌ Expression indexes
- ❌ Comments (COMMENT ON statements)
- ❌ Table options (STORAGE, TABLESPACE, etc.)

### Workarounds
For better static file support, use `pg_dump` with:
```bash
pg_dump --schema-only --no-owner --no-privileges -f schema.sql
```

For full metadata, always prefer direct or SSH connection modes.

## Known Issues

### Issue: SSH Tunnel Connection Pooling
- **Description**: SSH tunnel mode creates a pool on first connection but may not reconnect if SSH connection drops
- **Workaround**: Restart the MCP server if SSH connection is lost

### Issue: Large Schema Discovery
- **Description**: `listResources` returns all tables, which can be thousands of entries
- **Impact**: May slow down MCP client initialization
- **Workaround**: Use tools instead of resources for large databases

### Issue: Enum Type Values
- **Description**: Columns with ENUM types show the enum type name but not the allowed values
- **Impact**: LLM doesn't know what values are valid
- **Workaround**: Query `pg_enum` catalog manually (future enhancement)

### Issue: Partitioned Table Structure
- **Description**: Partitioned tables show as regular tables; partition children and strategy not exposed
- **Impact**: LLM can't reason about partition pruning or structure
- **Future**: May add partition metadata in future versions

## Future Enhancements

Potential features under consideration:

- [ ] Enum value extraction
- [ ] Partition table metadata
- [ ] Materialized view refresh status
- [ ] Table size estimates
- [ ] Approximate row counts
- [ ] Function and procedure signatures
- [ ] Extension-specific types (PostGIS, etc.)
- [ ] Query plan simulation (EXPLAIN without execution)
- [ ] Connection caching/pooling across tool calls

## Getting Help

- **GitHub Issues**: For bugs or feature requests
- **Documentation**: Check README and examples
- **Community**: Model Context Protocol Discord

## Version History

- **v0.2.0**: Added SSH tunnel, static file support, extended metadata (indexes, constraints)
- **v0.1.0**: Initial release with direct connection mode
