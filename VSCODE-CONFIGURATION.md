# VS Code Configuration Fix for postgres-srs Server

## Problem
The MCP server "postgres-srs" is failing with exit code 1 because it's missing required connection parameters.

## Solution
You can configure the MCP server using either `mcp.json` (recommended) or directly in `settings.json`.

## Option 1: Using mcp.json (Recommended)

This project includes an `mcp.json` file that VS Code can reference for MCP server configuration.

### Step 1: Configure mcp.json

Edit the `mcp.json` file in the project root and update with your database credentials:

```json
{
  "servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "mcp-pg-schema"
      ],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "your_database_name",
        "PGUSER": "your_database_user",
        "PGPASSWORD": "your_database_password",
        "PGSSLMODE": "require"
      }
    }
  },
  "inputs": []
}
```

**Platform-specific notes:**
- **macOS/Windows**: Use `PGHOST: "host.docker.internal"` for localhost PostgreSQL
- **Linux**: Add `"--network=host"` to args array, use `PGHOST: "localhost"` 
- **Docker Network**: Use `"--network=your-network-name"` in args, use container name as PGHOST

### Step 2: Reference mcp.json in VS Code Settings

Open VS Code settings and add:

**Using Command Palette:**
1. Press `Ctrl+Shift+P` (Linux/Windows) or `Cmd+Shift+P` (macOS)
2. Type: "Preferences: Open User Settings (JSON)"
3. Add the following:

```json
{
  "github.copilot.chat.mcp.configPath": "/mcp/mcp-pg-schema/mcp.json"
}
```

Or use workspace-relative path:
```json
{
  "github.copilot.chat.mcp.configPath": "${workspaceFolder}/mcp.json"
}
```

## Option 2: Using settings.json Directly

If you prefer to configure directly in VS Code settings without a separate file:

### Where to Configure

The settings file is located at:
- **Linux**: `~/.config/Code/User/settings.json`
- **macOS**: `~/Library/Application Support/Code/User/settings.json`  
- **Windows**: `%APPDATA%\Code\User\settings.json`

Or use workspace settings: `<workspace>/.vscode/settings.json`

### How to Access

1. Open VS Code Command Palette: `Ctrl+Shift+P` (Linux/Windows) or `Cmd+Shift+P` (macOS)
2. Type: "Preferences: Open User Settings (JSON)"
3. This will open your settings.json file

### Required Configuration

Find the section with `"github.copilot.chat.mcp.servers"` and update the `postgres-srs` server configuration:

### Configuration Method 1: Environment Variables

```json
{
  "github.copilot.chat.mcp.servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "mcp-pg-schema"
      ],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "your_database_name",
        "PGUSER": "your_database_user",
        "PGPASSWORD": "your_database_password",
        "PGSSLMODE": "require"
      }
    }
  }
}
```

### Configuration Method 2: Using Connection String

```json
{
  "github.copilot.chat.mcp.servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "mcp-pg-schema",
        "postgresql://user:password@host.docker.internal:5432/database"
      ]
    }
  }
}
```

### Configuration Method 3: Static SQL File (No Database Connection)

```json
{
  "github.copilot.chat.mcp.servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v", "/absolute/path/to/schema.sql:/config/schema.sql:ro",
        "mcp-pg-schema",
        "--file", "/config/schema.sql"
      ]
    }
  }
}
```

## What to Replace

- `your_database_name`: The name of your PostgreSQL database
- `your_database_user`: PostgreSQL username (recommend creating a read-only user)
- `your_database_password`: PostgreSQL password
- `host.docker.internal`: Use this for localhost on macOS/Windows; use `localhost` with `--network=host` on Linux
- `/absolute/path/to/schema.sql`: Actual path to your SQL schema file (for file mode)

## Platform-Specific Notes

### Linux
If connecting to localhost, add `--network=host` to Docker args:
```json
"args": ["run", "-i", "--rm", "--network=host", "mcp-pg-schema"]
```

### macOS/Windows
Use `host.docker.internal` to connect to localhost PostgreSQL:
```json
"PGHOST": "host.docker.internal"
```

## After Configuration

1. **Save** the settings.json file
2. **Reload VS Code**: Press `Ctrl+Shift+P` / `Cmd+Shift+P` → "Developer: Reload Window"
3. **Check Output**: View → Output → Select "GitHub Copilot Chat" from dropdown
4. **Test**: Open Copilot Chat and ask: "List all database schemas"

## Verify Docker Image

Before configuring, ensure the Docker image is built:

```bash
cd /mcp/mcp-pg-schema
docker build -t mcp-pg-schema .
docker images | grep mcp-pg-schema
```

## Security Best Practice

Create a dedicated read-only user for the MCP server:

```sql
-- Connect to PostgreSQL
psql -h localhost -U postgres -d your_database

-- Create read-only user
CREATE USER mcp_reader WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE your_database TO mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT USAGE ON SCHEMA your_schema TO mcp_reader;
```

Then use `mcp_reader` as the `PGUSER` in your configuration.

## Troubleshooting

### Test Connection Manually

```bash
# Test that the connection works
docker run -i --rm \
  -e PGHOST=host.docker.internal \
  -e PGPORT=5432 \
  -e PGDATABASE=your_database \
  -e PGUSER=your_user \
  -e PGPASSWORD=your_password \
  mcp-pg-schema
```

If this shows the usage error, your connection parameters are wrong.
If it starts without errors, press Ctrl+C and use the same parameters in VS Code.

### Check Logs

View VS Code Output panel:
1. View → Output
2. Select "GitHub Copilot Chat" from the dropdown
3. Look for connection errors

### Common Issues

**"connection refused"**
- PostgreSQL not running: `docker ps | grep postgres`
- Wrong host: Use `host.docker.internal` on macOS/Windows
- Firewall blocking connection

**"authentication failed"**
- Wrong username/password
- Check pg_hba.conf allows connection method
- Ensure user has CONNECT privilege

**"database does not exist"**
- Typo in database name
- Database not created: `psql -l` to list databases

## Example Working Configuration

Here's a complete working example for a local PostgreSQL:

```json
{
  "github.copilot.chat.mcp.servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "mcp-pg-schema"
      ],
      "env": {
        "PGHOST": "host.docker.internal",
        "PGPORT": "5432",
        "PGDATABASE": "testdb",
        "PGUSER": "testuser",
        "PGPASSWORD": "testpass",
        "PGSSLMODE": "disable"
      }
    }
  }
}
```

This assumes you have a local PostgreSQL with:
- Database: `testdb`
- User: `testuser`
- Password: `testpass`
- Running on port 5432

## Next Steps

1. **Locate your settings.json** using the paths above
2. **Add or update** the `postgres-srs` configuration
3. **Replace placeholders** with your actual database credentials
4. **Save and reload** VS Code
5. **Test** the connection in Copilot Chat

For more advanced configurations (SSH tunnels, external Docker networks), see [AGENT-SETUP-GUIDE.md](AGENT-SETUP-GUIDE.md).
