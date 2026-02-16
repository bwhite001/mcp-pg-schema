#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";
import { Client as SSHClient } from "ssh2";
import { readFile } from "fs/promises";

// Schema provider interface
interface SchemaProvider {
  listSchemas(): Promise<Array<{ schema_name: string }>>;
  listTables(): Promise<Array<{ table_schema: string; table_name: string }>>;
  getColumns(
    schemaName: string,
    tableName: string
  ): Promise<Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>>;
  getSchemaInfo(schemaName: string): Promise<any[]>;
  getTableDetails(schemaName: string, tableName: string): Promise<any>;
  getCompositeTypes(schemaName: string, typeName?: string): Promise<any>;
  getFunctions(schemaName: string, functionName?: string, includeInternal?: boolean): Promise<any>;
  close(): Promise<void>;
}

// PostgreSQL provider (direct connection)
class PostgresProvider implements SchemaProvider {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async listSchemas() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name"
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async listTables() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getColumns(schemaName: string, tableName: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [schemaName, tableName]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getSchemaInfo(schemaName: string) {
    const query = `
SELECT
    t.table_schema,
    t.table_name,

    -- JSON array of columns with relevant info
    (
      SELECT json_agg(
               json_build_object(
                 'column_name', c.column_name,
                 'data_type', c.data_type,
                 'is_nullable', c.is_nullable,
                 'column_default', c.column_default
               ) ORDER BY c.ordinal_position
             )
      FROM information_schema.columns c
      WHERE c.table_name = t.table_name
        AND c.table_schema = t.table_schema
    ) AS columns,

    -- JSON array of constraints with basic references
    (
      SELECT json_agg(
               json_build_object(
                 'constraint_name', tc.constraint_name,
                 'constraint_type', tc.constraint_type,
                 'columns', (
                   SELECT json_agg(kcu.column_name ORDER BY kcu.ordinal_position)
                   FROM information_schema.key_column_usage kcu
                   WHERE kcu.constraint_name = tc.constraint_name
                     AND kcu.table_schema = tc.table_schema
                 ),
                 'foreign_table', ccu.table_name,
                 'foreign_column', ccu.column_name
               )
             )
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.constraint_column_usage ccu
             ON tc.constraint_name = ccu.constraint_name
            AND tc.table_schema = ccu.table_schema
      WHERE tc.table_name = t.table_name
        AND tc.table_schema = t.table_schema
    ) AS constraints

FROM information_schema.tables t
WHERE t.table_schema = $1
ORDER BY t.table_schema, t.table_name;
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(query, [schemaName]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getTableDetails(schemaName: string, tableName: string) {
    const query = `
WITH table_info AS (
  SELECT
    t.table_schema,
    t.table_name,
    obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass, 'pg_class') as table_comment
  FROM information_schema.tables t
  WHERE t.table_schema = $1 AND t.table_name = $2
),
columns AS (
  SELECT json_agg(
    json_build_object(
      'column_name', c.column_name,
      'data_type', c.data_type,
      'is_nullable', c.is_nullable,
      'column_default', c.column_default,
      'ordinal_position', c.ordinal_position,
      'udt_name', c.udt_name,
      'character_maximum_length', c.character_maximum_length,
      'numeric_precision', c.numeric_precision,
      'numeric_scale', c.numeric_scale
    ) ORDER BY c.ordinal_position
  ) as columns
  FROM information_schema.columns c
  WHERE c.table_schema = $1 AND c.table_name = $2
),
constraints AS (
  SELECT json_agg(
    json_build_object(
      'constraint_name', tc.constraint_name,
      'constraint_type', tc.constraint_type,
      'columns', (
        SELECT json_agg(kcu.column_name ORDER BY kcu.ordinal_position)
        FROM information_schema.key_column_usage kcu
        WHERE kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
      ),
      'foreign_table_schema', ccu.table_schema,
      'foreign_table', ccu.table_name,
      'foreign_columns', (
        SELECT json_agg(ccu2.column_name)
        FROM information_schema.constraint_column_usage ccu2
        WHERE ccu2.constraint_name = tc.constraint_name
          AND ccu2.table_schema != tc.table_schema OR ccu2.table_name != tc.table_name
      ),
      'check_clause', cc.check_clause
    )
  ) as constraints
  FROM information_schema.table_constraints tc
  LEFT JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.constraint_schema
  LEFT JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
    AND tc.constraint_schema = cc.constraint_schema
  WHERE tc.table_schema = $1 AND tc.table_name = $2
),
indexes AS (
  SELECT json_agg(
    json_build_object(
      'index_name', i.indexname,
      'index_definition', i.indexdef,
      'is_unique', idx.indisunique,
      'is_primary', idx.indisprimary,
      'columns', (
        SELECT json_agg(a.attname ORDER BY array_position(idx.indkey, a.attnum))
        FROM pg_attribute a
        WHERE a.attrelid = idx.indrelid
          AND a.attnum = ANY(idx.indkey)
      )
    )
  ) as indexes
  FROM pg_indexes i
  JOIN pg_class c ON c.relname = i.indexname
  JOIN pg_index idx ON idx.indexrelid = c.oid
  WHERE i.schemaname = $1 AND i.tablename = $2
)
SELECT
  ti.*,
  col.columns,
  con.constraints,
  idx.indexes
FROM table_info ti
CROSS JOIN columns col
CROSS JOIN constraints con
CROSS JOIN indexes idx;
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(query, [schemaName, tableName]);
      if (result.rows.length === 0) {
        throw new Error(`Table "${schemaName}.${tableName}" not found`);
      }
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async getCompositeTypes(schemaName: string, typeName?: string) {
    const query = `
      SELECT
        n.nspname as schema,
        t.typname as name,
        'composite' as kind,
        obj_description(t.oid, 'pg_type') as description,
        (
          SELECT json_agg(
            json_build_object(
              'name', a.attname,
              'data_type', format_type(a.atttypid, a.atttypmod),
              'is_nullable', NOT a.attnotnull,
              'default', pg_get_expr(ad.adbin, ad.adrelid),
              'ordinal_position', a.attnum
            ) ORDER BY a.attnum
          )
          FROM pg_attribute a
          LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
          WHERE a.attrelid = t.typrelid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ) as attributes
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = $1
        AND t.typtype = 'c'
        AND ($2::text IS NULL OR t.typname = $2)
      ORDER BY t.typname
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(query, [schemaName, typeName || null]);
      return {
        schema: schemaName,
        types: result.rows
      };
    } finally {
      client.release();
    }
  }

  async getFunctions(schemaName: string, functionName?: string, includeInternal = false) {
    const query = `
      SELECT
        n.nspname as schema,
        p.proname as name,
        (
          SELECT json_agg(
            json_build_object(
              'name', COALESCE(pn.parameter_name, ''),
              'data_type', format_type(pt.parameter_type, NULL)
            )
          )
          FROM (
            SELECT
              unnest(p.proargnames) as parameter_name,
              unnest(p.proargtypes) as parameter_type,
              generate_series(1, array_length(p.proargtypes, 1)) as param_position
          ) pn
          JOIN pg_type pt ON pn.parameter_type = pt.oid
        ) as argument_types,
        json_build_object(
          'schema', ret_ns.nspname,
          'name', ret_type.typname,
          'kind', CASE
            WHEN ret_type.typtype = 'c' THEN 'composite'
            WHEN ret_type.typtype = 'e' THEN 'enum'
            WHEN ret_type.typtype = 'd' THEN 'domain'
            ELSE 'scalar'
          END
        ) as return_type,
        l.lanname as language,
        CASE p.provolatile
          WHEN 'i' THEN 'immutable'
          WHEN 's' THEN 'stable'
          WHEN 'v' THEN 'volatile'
        END as volatility,
        p.proretset as returns_set,
        obj_description(p.oid, 'pg_proc') as description
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_language l ON p.prolang = l.oid
      JOIN pg_type ret_type ON p.prorettype = ret_type.oid
      JOIN pg_namespace ret_ns ON ret_type.typnamespace = ret_ns.oid
      WHERE n.nspname = $1
        AND ($2::text IS NULL OR p.proname = $2)
        AND ($3::boolean OR p.proname !~ '^_')
        AND l.lanname != 'internal'
      ORDER BY p.proname, p.pronargs
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(query, [schemaName, functionName || null, includeInternal]);
      return {
        schema: schemaName,
        functions: result.rows
      };
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

// SSH Tunnel provider
class SSHTunnelProvider implements SchemaProvider {
  private sshClient: SSHClient;
  private pool: pg.Pool | null = null;
  private connected = false;

  constructor(
    private sshConfig: {
      host: string;
      port: number;
      username: string;
      password?: string;
      privateKey?: Buffer;
    },
    private dbConfig: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    }
  ) {
    this.sshClient = new SSHClient();
  }

  private async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      this.sshClient
        .on("ready", () => {
          this.sshClient.forwardOut(
            "127.0.0.1",
            0,
            this.dbConfig.host,
            this.dbConfig.port,
            (err, stream) => {
              if (err) {
                reject(err);
                return;
              }

              // Create a PostgreSQL pool using the SSH tunnel
              this.pool = new pg.Pool({
                host: this.dbConfig.host,
                port: this.dbConfig.port,
                database: this.dbConfig.database,
                user: this.dbConfig.user,
                password: this.dbConfig.password,
                stream: stream as any,
              });

              this.connected = true;
              resolve();
            }
          );
        })
        .on("error", reject)
        .connect(this.sshConfig);
    });
  }

  async listSchemas() {
    await this.connect();
    const client = await this.pool!.connect();
    try {
      const result = await client.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name"
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async listTables() {
    await this.connect();
    const client = await this.pool!.connect();
    try {
      const result = await client.query(
        "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getColumns(schemaName: string, tableName: string) {
    await this.connect();
    const client = await this.pool!.connect();
    try {
      const result = await client.query(
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [schemaName, tableName]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getSchemaInfo(schemaName: string) {
    await this.connect();
    const query = `
SELECT
    t.table_schema,
    t.table_name,

    -- JSON array of columns with relevant info
    (
      SELECT json_agg(
               json_build_object(
                 'column_name', c.column_name,
                 'data_type', c.data_type,
                 'is_nullable', c.is_nullable,
                 'column_default', c.column_default
               ) ORDER BY c.ordinal_position
             )
      FROM information_schema.columns c
      WHERE c.table_name = t.table_name
        AND c.table_schema = t.table_schema
    ) AS columns,

    -- JSON array of constraints with basic references
    (
      SELECT json_agg(
               json_build_object(
                 'constraint_name', tc.constraint_name,
                 'constraint_type', tc.constraint_type,
                 'columns', (
                   SELECT json_agg(kcu.column_name ORDER BY kcu.ordinal_position)
                   FROM information_schema.key_column_usage kcu
                   WHERE kcu.constraint_name = tc.constraint_name
                     AND kcu.table_schema = tc.table_schema
                 ),
                 'foreign_table', ccu.table_name,
                 'foreign_column', ccu.column_name
               )
             )
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.constraint_column_usage ccu
             ON tc.constraint_name = ccu.constraint_name
            AND tc.table_schema = ccu.table_schema
      WHERE tc.table_name = t.table_name
        AND tc.table_schema = t.table_schema
    ) AS constraints

FROM information_schema.tables t
WHERE t.table_schema = $1
ORDER BY t.table_schema, t.table_name;
    `;

    const client = await this.pool!.connect();
    try {
      const result = await client.query(query, [schemaName]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getTableDetails(schemaName: string, tableName: string) {
    await this.connect();
    const query = `
WITH table_info AS (
  SELECT
    t.table_schema,
    t.table_name,
    obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass, 'pg_class') as table_comment
  FROM information_schema.tables t
  WHERE t.table_schema = $1 AND t.table_name = $2
),
columns AS (
  SELECT json_agg(
    json_build_object(
      'column_name', c.column_name,
      'data_type', c.data_type,
      'is_nullable', c.is_nullable,
      'column_default', c.column_default,
      'ordinal_position', c.ordinal_position,
      'udt_name', c.udt_name,
      'character_maximum_length', c.character_maximum_length,
      'numeric_precision', c.numeric_precision,
      'numeric_scale', c.numeric_scale
    ) ORDER BY c.ordinal_position
  ) as columns
  FROM information_schema.columns c
  WHERE c.table_schema = $1 AND c.table_name = $2
),
constraints AS (
  SELECT json_agg(
    json_build_object(
      'constraint_name', tc.constraint_name,
      'constraint_type', tc.constraint_type,
      'columns', (
        SELECT json_agg(kcu.column_name ORDER BY kcu.ordinal_position)
        FROM information_schema.key_column_usage kcu
        WHERE kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
      ),
      'foreign_table_schema', ccu.table_schema,
      'foreign_table', ccu.table_name,
      'foreign_columns', (
        SELECT json_agg(ccu2.column_name)
        FROM information_schema.constraint_column_usage ccu2
        WHERE ccu2.constraint_name = tc.constraint_name
          AND ccu2.table_schema != tc.table_schema OR ccu2.table_name != tc.table_name
      ),
      'check_clause', cc.check_clause
    )
  ) as constraints
  FROM information_schema.table_constraints tc
  LEFT JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.constraint_schema
  LEFT JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
    AND tc.constraint_schema = cc.constraint_schema
  WHERE tc.table_schema = $1 AND tc.table_name = $2
),
indexes AS (
  SELECT json_agg(
    json_build_object(
      'index_name', i.indexname,
      'index_definition', i.indexdef,
      'is_unique', idx.indisunique,
      'is_primary', idx.indisprimary,
      'columns', (
        SELECT json_agg(a.attname ORDER BY array_position(idx.indkey, a.attnum))
        FROM pg_attribute a
        WHERE a.attrelid = idx.indrelid
          AND a.attnum = ANY(idx.indkey)
      )
    )
  ) as indexes
  FROM pg_indexes i
  JOIN pg_class c ON c.relname = i.indexname
  JOIN pg_index idx ON idx.indexrelid = c.oid
  WHERE i.schemaname = $1 AND i.tablename = $2
)
SELECT
  ti.*,
  col.columns,
  con.constraints,
  idx.indexes
FROM table_info ti
CROSS JOIN columns col
CROSS JOIN constraints con
CROSS JOIN indexes idx;
    `;

    const client = await this.pool!.connect();
    try {
      const result = await client.query(query, [schemaName, tableName]);
      if (result.rows.length === 0) {
        throw new Error(`Table "${schemaName}.${tableName}" not found`);
      }
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async getCompositeTypes(schemaName: string, typeName?: string) {
    await this.connect();
    const query = `
      SELECT
        n.nspname as schema,
        t.typname as name,
        'composite' as kind,
        obj_description(t.oid, 'pg_type') as description,
        (
          SELECT json_agg(
            json_build_object(
              'name', a.attname,
              'data_type', format_type(a.atttypid, a.atttypmod),
              'is_nullable', NOT a.attnotnull,
              'default', pg_get_expr(ad.adbin, ad.adrelid),
              'ordinal_position', a.attnum
            ) ORDER BY a.attnum
          )
          FROM pg_attribute a
          LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
          WHERE a.attrelid = t.typrelid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ) as attributes
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = $1
        AND t.typtype = 'c'
        AND ($2::text IS NULL OR t.typname = $2)
      ORDER BY t.typname
    `;

    const client = await this.pool!.connect();
    try {
      const result = await client.query(query, [schemaName, typeName || null]);
      return {
        schema: schemaName,
        types: result.rows
      };
    } finally {
      client.release();
    }
  }

  async getFunctions(schemaName: string, functionName?: string, includeInternal = false) {
    await this.connect();
    const query = `
      SELECT
        n.nspname as schema,
        p.proname as name,
        (
          SELECT json_agg(
            json_build_object(
              'name', COALESCE(pn.parameter_name, ''),
              'data_type', format_type(pt.parameter_type, NULL)
            )
          )
          FROM (
            SELECT
              unnest(p.proargnames) as parameter_name,
              unnest(p.proargtypes) as parameter_type,
              generate_series(1, array_length(p.proargtypes, 1)) as param_position
          ) pn
          JOIN pg_type pt ON pn.parameter_type = pt.oid
        ) as argument_types,
        json_build_object(
          'schema', ret_ns.nspname,
          'name', ret_type.typname,
          'kind', CASE
            WHEN ret_type.typtype = 'c' THEN 'composite'
            WHEN ret_type.typtype = 'e' THEN 'enum'
            WHEN ret_type.typtype = 'd' THEN 'domain'
            ELSE 'scalar'
          END
        ) as return_type,
        l.lanname as language,
        CASE p.provolatile
          WHEN 'i' THEN 'immutable'
          WHEN 's' THEN 'stable'
          WHEN 'v' THEN 'volatile'
        END as volatility,
        p.proretset as returns_set,
        obj_description(p.oid, 'pg_proc') as description
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_language l ON p.prolang = l.oid
      JOIN pg_type ret_type ON p.prorettype = ret_type.oid
      JOIN pg_namespace ret_ns ON ret_type.typnamespace = ret_ns.oid
      WHERE n.nspname = $1
        AND ($2::text IS NULL OR p.proname = $2)
        AND ($3::boolean OR p.proname !~ '^_')
        AND l.lanname != 'internal'
      ORDER BY p.proname, p.pronargs
    `;

    const client = await this.pool!.connect();
    try {
      const result = await client.query(query, [schemaName, functionName || null, includeInternal]);
      return {
        schema: schemaName,
        functions: result.rows
      };
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
    this.sshClient.end();
  }
}

// Static SQL file provider
class StaticSQLProvider implements SchemaProvider {
  private schemas: Map<
    string,
    Map<
      string,
      {
        columns: Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>;
        constraints?: any[];
      }
    >
  > = new Map();

  constructor(private sqlContent: string) {
    this.parseSQLContent();
  }

  private parseSQLContent() {
    // Parse CREATE TABLE statements from SQL dump
    const createTableRegex = /CREATE TABLE (?:(\w+)\.)?(\w+)\s*\(([\s\S]*?)\);/gi;
    let match;

    while ((match = createTableRegex.exec(this.sqlContent)) !== null) {
      const schemaName = match[1] || "public";
      const tableName = match[2];
      const columnsBlock = match[3];

      if (!this.schemas.has(schemaName)) {
        this.schemas.set(schemaName, new Map());
      }

      const schema = this.schemas.get(schemaName)!;
      const columns = this.parseColumnsFromBlock(columnsBlock);

      schema.set(tableName, { columns, constraints: [] });
    }
  }

  private parseColumnsFromBlock(columnsBlock: string) {
    const columns: Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }> = [];
    const lines = columnsBlock.split(",").map((l) => l.trim());

    for (const line of lines) {
      // Skip constraints
      if (
        line.toUpperCase().startsWith("CONSTRAINT") ||
        line.toUpperCase().startsWith("PRIMARY KEY") ||
        line.toUpperCase().startsWith("FOREIGN KEY") ||
        line.toUpperCase().startsWith("UNIQUE") ||
        line.toUpperCase().startsWith("CHECK")
      ) {
        continue;
      }

      // Parse column definition
      const parts = line.match(/^(\w+)\s+([^\s,]+)(?:\s+(.*))?$/);
      if (parts) {
        const columnName = parts[1];
        const dataType = parts[2];
        const modifiers = parts[3] || "";

        const isNullable = !modifiers.toUpperCase().includes("NOT NULL");
        const defaultMatch = modifiers.match(/DEFAULT\s+([^\s,]+)/i);
        const columnDefault = defaultMatch ? defaultMatch[1] : null;

        columns.push({
          column_name: columnName,
          data_type: dataType,
          is_nullable: isNullable ? "YES" : "NO",
          column_default: columnDefault,
        });
      }
    }

    return columns;
  }

  async listSchemas() {
    const schemas: Array<{ schema_name: string }> = [];
    for (const schemaName of this.schemas.keys()) {
      schemas.push({ schema_name: schemaName });
    }
    return schemas.sort((a, b) => a.schema_name.localeCompare(b.schema_name));
  }

  async listTables() {
    const tables: Array<{ table_schema: string; table_name: string }> = [];
    for (const [schemaName, schema] of this.schemas) {
      for (const tableName of schema.keys()) {
        tables.push({ table_schema: schemaName, table_name: tableName });
      }
    }
    return tables.sort((a, b) => {
      const schemaCompare = a.table_schema.localeCompare(b.table_schema);
      return schemaCompare !== 0 ? schemaCompare : a.table_name.localeCompare(b.table_name);
    });
  }

  async getColumns(schemaName: string, tableName: string) {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      return [];
    }
    const table = schema.get(tableName);
    return table ? table.columns : [];
  }

  async getSchemaInfo(schemaName: string) {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      return [];
    }

    const tables = [];
    for (const [tableName, tableInfo] of schema) {
      tables.push({
        table_schema: schemaName,
        table_name: tableName,
        columns: tableInfo.columns,
        constraints: tableInfo.constraints,
      });
    }

    return tables;
  }

  async getTableDetails(schemaName: string, tableName: string) {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      throw new Error(`Schema "${schemaName}" not found`);
    }
    const table = schema.get(tableName);
    if (!table) {
      throw new Error(`Table "${schemaName}.${tableName}" not found`);
    }
    
    // Return limited information from static SQL file
    return {
      table_schema: schemaName,
      table_name: tableName,
      table_comment: null,
      columns: table.columns,
      constraints: table.constraints,
      indexes: null, // Not available from static SQL parsing
    };
  }

  async getCompositeTypes(schemaName: string, typeName?: string) {
    // Static SQL file parsing does not support composite type extraction
    return {
      schema: schemaName,
      types: [],
      note: "Composite type information is not available when using static SQL file mode. Use a direct database connection for full type introspection."
    };
  }

  async getFunctions(schemaName: string, functionName?: string, includeInternal = false) {
    // Static SQL file parsing does not support function extraction
    return {
      schema: schemaName,
      functions: [],
      note: "Function information is not available when using static SQL file mode. Use a direct database connection for full function introspection."
    };
  }

  async close() {
    // No-op for static provider
  }
}

// Build connection string from environment variables
function buildConnectionStringFromEnv(): string | null {
  const host = process.env.PGHOST;
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE || process.env.PGDB;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const sslmode = process.env.PGSSLMODE;

  // Need at least host and database to build a connection string
  if (!host || !database) {
    return null;
  }

  let connectionString = `postgresql://`;
  
  if (user) {
    connectionString += user;
    if (password) {
      connectionString += `:${password}`;
    }
    connectionString += `@`;
  }
  
  connectionString += `${host}:${port}/${database}`;
  
  if (sslmode) {
    connectionString += `?sslmode=${sslmode}`;
  }
  
  return connectionString;
}

// Parse command-line arguments
function parseArgs(): { mode: string; config: any } {
  const args = process.argv.slice(2);

  // Check for environment variables first
  const envConnectionString = buildConnectionStringFromEnv();

  if (args.length === 0) {
    // If no args but env vars are set, use them
    if (envConnectionString) {
      return { mode: "direct", config: { connectionString: envConnectionString } };
    }
    
    console.error(`Usage:
  Direct connection:
    mcp-pg-schema postgresql://user:pass@host:port/database
    OR set environment variables: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE
    
  SSH tunnel:
    mcp-pg-schema --ssh ssh://user@host:port --db postgresql://user:pass@dbhost:port/database [--ssh-password PASSWORD | --ssh-key /path/to/key]
    
  Static SQL file:
    mcp-pg-schema --file /path/to/schema.sql`);
    process.exit(1);
  }

  // Check for file mode
  if (args[0] === "--file" || args[0] === "-f") {
    if (args.length < 2) {
      console.error("Error: --file requires a path argument");
      process.exit(1);
    }
    return { mode: "file", config: { path: args[1] } };
  }

  // Check for SSH tunnel mode
  if (args[0] === "--ssh") {
    const sshUrlIndex = 1;
    const dbUrlIndex = args.indexOf("--db");

    if (dbUrlIndex === -1) {
      console.error("Error: SSH mode requires --db argument");
      process.exit(1);
    }

    const sshUrl = new URL(args[sshUrlIndex]);
    const dbUrl = new URL(args[dbUrlIndex + 1]);

    const sshPasswordIndex = args.indexOf("--ssh-password");
    const sshKeyIndex = args.indexOf("--ssh-key");

    let sshPassword: string | undefined;
    let sshKey: string | undefined;

    if (sshPasswordIndex !== -1) {
      sshPassword = args[sshPasswordIndex + 1];
    }
    if (sshKeyIndex !== -1) {
      sshKey = args[sshKeyIndex + 1];
    }

    return {
      mode: "ssh",
      config: {
        ssh: {
          host: sshUrl.hostname,
          port: parseInt(sshUrl.port || "22"),
          username: sshUrl.username,
          password: sshPassword,
          keyPath: sshKey,
        },
        db: {
          host: dbUrl.hostname,
          port: parseInt(dbUrl.port || "5432"),
          database: dbUrl.pathname.slice(1),
          user: dbUrl.username,
          password: dbUrl.password,
        },
      },
    };
  }

  // Default to direct connection
  return { mode: "direct", config: { connectionString: args[0] } };
}

// Initialize provider based on mode
async function createProvider(mode: string, config: any): Promise<SchemaProvider> {
  switch (mode) {
    case "direct":
      return new PostgresProvider(config.connectionString);

    case "ssh": {
      const sshConfig: any = {
        host: config.ssh.host,
        port: config.ssh.port,
        username: config.ssh.username,
      };

      if (config.ssh.password) {
        sshConfig.password = config.ssh.password;
      } else if (config.ssh.keyPath) {
        sshConfig.privateKey = await readFile(config.ssh.keyPath);
      } else {
        throw new Error("SSH mode requires either --ssh-password or --ssh-key");
      }

      return new SSHTunnelProvider(sshConfig, config.db);
    }

    case "file": {
      const sqlContent = await readFile(config.path, "utf-8");
      return new StaticSQLProvider(sqlContent);
    }

    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

const { mode, config } = parseArgs();
const provider = await createProvider(mode, config);

// Build resource base URL
let resourceBaseUrl: URL;
if (mode === "direct") {
  resourceBaseUrl = new URL(config.connectionString);
  resourceBaseUrl.protocol = "postgres:";
  resourceBaseUrl.password = "";
} else if (mode === "ssh") {
  resourceBaseUrl = new URL(
    `postgres://${config.ssh.host}/${config.db.database}`
  );
} else {
  resourceBaseUrl = new URL(`file://${config.path}`);
}

const server = new Server(
  {
    name: "@bwhite001/mcp-pg-schema",
    version: "0.4.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

const SCHEMA_PATH = "schema";


server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const tables = await provider.listTables();
  return {
    resources: tables.map((row) => ({
      uri: new URL(`${row.table_schema}/${row.table_name}/${SCHEMA_PATH}`, resourceBaseUrl).href,
      mimeType: "application/json",
      name: `"${row.table_schema}.${row.table_name}" schema`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUrl = new URL(request.params.uri);

  const pathComponents = resourceUrl.pathname.split("/").filter(Boolean);
  const schemaPath = pathComponents.pop();
  const tableName = pathComponents.pop();
  const schemaName = pathComponents.pop();

  if (schemaPath !== SCHEMA_PATH) {
    throw new Error("Invalid resource URI - must end with /schema");
  }

  if (!schemaName || !tableName) {
    throw new Error("Invalid resource URI - must include schema and table name");
  }

  const columns = await provider.getColumns(schemaName, tableName);

  if (columns.length === 0) {
    throw new Error(`Table "${schemaName}.${tableName}" not found`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(columns, null, 2),
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_schemas",
        description: "List all available schemas in the database (excludes system schemas)",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "list_tables",
        description: "List all tables across all schemas (optionally filter by schema)",
        inputSchema: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: "Optional: filter tables by schema name",
            },
          },
        },
      },
      {
        name: "table_schema",
        description: "Get detailed schema for a specific table including columns, constraints, and indexes",
        inputSchema: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: "The schema name (e.g., 'public')",
            },
            table: {
              type: "string",
              description: "The table name",
            },
          },
          required: ["schema", "table"],
        },
      },
      {
        name: "schema",
        description: "Get comprehensive schema information for all tables in a database schema",
        inputSchema: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: "The schema name to query (e.g., 'public', 'myschema')",
            },
          },
          required: ["schema"],
        },
      },
      {
        name: "composite_types",
        description: "List composite types and their fields for a schema, optionally filtered by type name. Useful for understanding reporting structures and BI types that encapsulate business domain logic.",
        inputSchema: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: "PostgreSQL schema name (e.g., 'public')",
            },
            type_name: {
              type: "string",
              description: "Optional: filter to a specific composite type name (e.g., 'client_report')",
            },
          },
          required: ["schema"],
        },
      },
      {
        name: "functions",
        description: "List functions and their signatures including return types. This helps LLMs understand reporting contracts and business logic without executing functions. Returns function metadata for documentation purposes only - the MCP server does not execute functions.",
        inputSchema: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: "PostgreSQL schema name (e.g., 'public')",
            },
            name: {
              type: "string",
              description: "Optional: filter to a specific function name (e.g., 'age_range')",
            },
            include_internal: {
              type: "boolean",
              description: "If true, include internal/helper functions (names starting with '_'); otherwise only application-facing functions",
              default: false,
            },
          },
          required: ["schema"],
        },
      },
    ],
  };
});


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "list_schemas": {
        const schemas = await provider.listSchemas();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(schemas, null, 2)
          }],
          isError: false,
        };
      }

      case "list_tables": {
        const schemaFilter = request.params.arguments?.schema as string | undefined;
        let tables = await provider.listTables();
        
        if (schemaFilter) {
          tables = tables.filter(t => t.table_schema === schemaFilter);
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(tables, null, 2)
          }],
          isError: false,
        };
      }

      case "table_schema": {
        const schema = request.params.arguments?.schema as string;
        const table = request.params.arguments?.table as string;
        
        if (!schema || !table) {
          return {
            content: [{
              type: "text",
              text: "Error: Both 'schema' and 'table' parameters are required"
            }],
            isError: true,
          };
        }

        const tableDetails = await provider.getTableDetails(schema, table);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(tableDetails, null, 2)
          }],
          isError: false,
        };
      }

      case "schema": {
        const schema = request.params.arguments?.schema as string;
        
        if (!schema) {
          return {
            content: [{
              type: "text",
              text: "Error: schema parameter is required"
            }],
            isError: true,
          };
        }

        const result = await provider.getSchemaInfo(schema);
        
        if (result.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No tables found in schema "${schema}"`
            }],
            isError: false,
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          isError: false,
        };
      }

      case "composite_types": {
        const schema = request.params.arguments?.schema as string;
        const typeName = request.params.arguments?.type_name as string | undefined;
        
        if (!schema) {
          return {
            content: [{
              type: "text",
              text: "Error: schema parameter is required"
            }],
            isError: true,
          };
        }

        const result = await provider.getCompositeTypes(schema, typeName);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          isError: false,
        };
      }

      case "functions": {
        const schema = request.params.arguments?.schema as string;
        const functionName = request.params.arguments?.name as string | undefined;
        const includeInternal = request.params.arguments?.include_internal as boolean | undefined;
        
        if (!schema) {
          return {
            content: [{
              type: "text",
              text: "Error: schema parameter is required"
            }],
            isError: true,
          };
        }

        const result = await provider.getFunctions(schema, functionName, includeInternal);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          isError: false,
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `Error: ${errorMessage}`
      }],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Cleanup on exit
  process.on("SIGINT", async () => {
    await provider.close();
    process.exit(0);
  });
  
  process.on("SIGTERM", async () => {
    await provider.close();
    process.exit(0);
  });
}

runServer().catch(console.error);
