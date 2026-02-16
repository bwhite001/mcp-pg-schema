# MCP PostgreSQL Schema Server - VS Code Configuration

This guide explains how to configure the MCP PostgreSQL Schema Server for use with VS Code's GitHub Copilot extension.

## Recommended Approach: Wrapper Script + Environment Variables

The cleanest way to configure the MCP server is to use the provided wrapper script with environment variables. This keeps secrets out of your version-controlled configuration files.

### Setup Steps

1. **Create your `.env` file** (in the project root):
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** with your actual database credentials:
   ```bash
   PGHOST=postgres
   PGPORT=5432
   PGDATABASE=srs
   PGUSER=srs_alpha
   PGPASSWORD=your_actual_password
   PGSSLMODE=disable
   DOCKER_NETWORK=srs_default
   ```

3. **Source the `.env` file** in your shell:
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   if [ -f /mcp/mcp-pg-schema/.env ]; then
     export $(cat /mcp/mcp-pg-schema/.env | grep -v '^#' | xargs)
   fi
   ```

4. **Configure VS Code** to use the wrapper script:

   **Option A: Workspace mcp.json** (Recommended)

   Create or edit `.vscode/mcp.json`:
   ```json
   {
     "servers": {
       "postgres-srs": {
         "type": "stdio",
         "command": "/mcp/mcp-pg-schema/scripts/mcp-postgres-srs",
         "args": []
       }
     },
     "inputs": []
   }
   ```

   **Option B: User settings.json**

   Edit user settings: `Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"
   ```json
   {
     "github.copilot.chat.mcp.servers": {
       "postgres-srs": {
         "type": "stdio",
         "command": "/mcp/mcp-pg-schema/scripts/mcp-postgres-srs",
         "args": []
       }
     }
   }
   ```

5. **Reload VS Code**: `Ctrl+Shift+P` → "Developer: Reload Window"

### How It Works

- The wrapper script (`scripts/mcp-postgres-srs`) reads credentials from environment variables
- VS Code launches the wrapper script, which inherits your shell environment
- The script validates that `PGPASSWORD` is set, then runs Docker with the appropriate flags
- Your `.vscode/mcp.json` stays clean and can be version-controlled
- The `.env` file is gitignored and never committed

### Security Benefits

✅ **Secrets stay out of version control** - `.env` is gitignored  
✅ **Clean configuration files** - No passwords in JSON  
✅ **Flexible secret management** - Can use shell, .env, or secret managers  
✅ **Easy to rotate credentials** - Just update `.env`

---

## Alternative Approaches

### Option 1: VS Code Input Variables

If you don't want to use a `.env` file, VS Code can prompt for secrets at startup:

```json
{
  "inputs": [
    {
      "id": "pg-password",
      "type": "promptString",
      "description": "PostgreSQL password for srs database",
      "password": true
    }
  ],
  "servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network=srs_default",
        "-e", "PGHOST=postgres",
        "-e", "PGPORT=5432",
        "-e", "PGDATABASE=srs",
        "-e", "PGUSER=srs_alpha",
        "-e", "PGPASSWORD=${input:pg-password}",
        "-e", "PGSSLMODE=disable",
        "mcp-pg-schema"
      ]
    }
  }
}
```

This prompts for the password each time the server starts.

### Option 2: Direct Docker Command (Not Recommended)

You can embed credentials directly in the args, but this is **not recommended** for security reasons:

```json
{
  "servers": {
    "postgres-srs": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network=srs_default",
        "-e", "PGHOST=postgres",
        "-e", "PGPORT=5432",
        "-e", "PGDATABASE=srs",
        "-e", "PGUSER=srs_alpha",
        "-e", "PGPASSWORD=your_password_here",
        "-e", "PGSSLMODE=disable",
        "mcp-pg-schema"
      ]
    }
  }
}
```

⚠️ **Warning**: Passwords in JSON files can be accidentally committed to version control.

---

## Troubleshooting

### Server fails with "PGPASSWORD not set"

Make sure you've sourced your `.env` file in your shell:
```bash
source /mcp/mcp-pg-schema/.env
```

Or launch VS Code from a shell that has the variables set:
```bash
cd /mcp/mcp-pg-schema
source .env
code .
```

### Check if environment variables are available

```bash
echo $PGPASSWORD  # Should print your password
scripts/mcp-postgres-srs  # Test the wrapper script directly
```

### Connection still fails

1. **Verify Docker network**: `docker network inspect srs_default`
2. **Verify PostgreSQL is running**: `docker ps | grep postgres`
3. **Test direct connection**:
   ```bash
   source .env
   docker run -i --rm \
     --network="${DOCKER_NETWORK}" \
     -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE \
     mcp-pg-schema
   ```

### Check VS Code logs

- Open Output panel: `View` → `Output`
- Select "GitHub Copilot Chat" from the dropdown
- Look for error messages related to "postgres-srs"

### Verify Docker Image

Ensure the Docker image is built:
```bash
cd /mcp/mcp-pg-schema
docker build -t mcp-pg-schema .
docker images | grep mcp-pg-schema
```

---

## Connection Examples for Different Setups

### Docker Network (Current Setup)
```bash
# .env
PGHOST=postgres
DOCKER_NETWORK=srs_default
```

### Localhost (Linux with --network=host)
```bash
# .env
PGHOST=localhost
DOCKER_NETWORK=host
```

Edit wrapper script to use:
```bash
--network="${DOCKER_NETWORK}"
```

### Localhost (macOS/Windows)
```bash
# .env
PGHOST=host.docker.internal
# DOCKER_NETWORK=  # Leave empty or set to "bridge"
```

### SSH Tunnel or Static File

For SSH tunnels or static SQL files, you'd need to modify the wrapper script or create a separate wrapper. See the main [README.md](README.md) for those connection modes.

---

## Security Best Practice

Create a dedicated read-only user for the MCP server:

```sql
-- Connect to PostgreSQL
psql -h postgres -U postgres -d srs

-- Create read-only user
CREATE USER mcp_reader WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE srs TO mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_reader;
```

Then update `.env`:
```bash
PGUSER=mcp_reader
PGPASSWORD=secure_password
```

---

## Quick Start Summary

1. `cp .env.example .env` and edit with your credentials
2. Add `source /mcp/mcp-pg-schema/.env` to your `~/.bashrc` or `~/.zshrc`
3. Verify: `.vscode/mcp.json` points to `/mcp/mcp-pg-schema/scripts/mcp-postgres-srs`
4. Reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
5. Test in Copilot Chat: "List all database schemas"

For more advanced configurations, see [AGENT-SETUP-GUIDE.md](AGENT-SETUP-GUIDE.md).

