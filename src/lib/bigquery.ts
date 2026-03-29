/**
 * BigQuery client wrapper that mimics Supabase's query builder API.
 *
 * Usage is identical to supabaseAdmin:
 *   const { data, error } = await bq.from('trades').select('wallet_address, side').eq('market_id', id).limit(100);
 *   const { error } = await bq.from('trades').upsert(rows, { onConflict: 'transaction_hash' });
 */

import { BigQuery } from '@google-cloud/bigquery';

// ---------------------------------------------------------------------------
// Client initialization
// ---------------------------------------------------------------------------

const projectId = process.env.GCP_PROJECT_ID!;
const dataset = process.env.BQ_DATASET || 'polymarket';

let _client: BigQuery | null = null;

function getClient(): BigQuery {
  if (!_client) {
    const credsEnv = process.env.GCP_CREDENTIALS;
    _client = credsEnv
      ? new BigQuery({ projectId, credentials: JSON.parse(credsEnv) })
      : new BigQuery({ projectId });
  }
  return _client;
}

function fqTable(table: string): string {
  return `\`${projectId}.${dataset}.${table}\``;
}

// ---------------------------------------------------------------------------
// Types matching Supabase's return shape
// ---------------------------------------------------------------------------

interface BqResult<T = any> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

interface BqSingleResult<T = any> {
  data: T | null;
  error: { message: string } | null;
  count: number | null;
}

// ---------------------------------------------------------------------------
// Filter conditions
// ---------------------------------------------------------------------------

type FilterOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_is_null';

interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Query Builder
// ---------------------------------------------------------------------------

class QueryBuilder<T = any> {
  private _table: string;
  private _selectCols: string = '*';
  private _filters: Filter[] = [];
  private _orderCol: string | null = null;
  private _orderAsc: boolean = true;
  private _limitVal: number | null = null;
  private _offsetVal: number | null = null;
  private _isSingle: boolean = false;

  // Write state
  private _insertRows: any[] | null = null;
  private _upsertRows: any[] | null = null;
  private _upsertOnConflict: string | null = null;
  private _upsertIgnoreDuplicates: boolean = false;
  private _upsertCount: boolean = false;
  private _updateData: any | null = null;
  private _deleteMode: boolean = false;
  private _deleteCount: boolean = false;

  constructor(table: string) {
    this._table = table;
  }

  // ---- Read methods ----

  select(columns: string = '*'): this {
    this._selectCols = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this._filters.push({ op: 'eq', column, value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this._filters.push({ op: 'gt', column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this._filters.push({ op: 'gte', column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this._filters.push({ op: 'lt', column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this._filters.push({ op: 'lte', column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this._filters.push({ op: 'in', column, value: values });
    return this;
  }

  not(column: string, _operator: string, _value: null): this {
    // Only pattern used: .not('col', 'is', null) → col IS NOT NULL
    this._filters.push({ op: 'not_is_null', column, value: null });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this._orderCol = column;
    this._orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number): this {
    this._limitVal = n;
    return this;
  }

  range(start: number, end: number): this {
    this._offsetVal = start;
    this._limitVal = end - start + 1;
    return this;
  }

  single(): Promise<BqSingleResult<T>> {
    this._isSingle = true;
    this._limitVal = 1;
    return this._execute() as Promise<BqSingleResult<T>>;
  }

  // ---- Write methods ----

  insert(rows: any | any[]): Promise<BqResult<T>> {
    this._insertRows = Array.isArray(rows) ? rows : [rows];
    return this._execute() as Promise<BqResult<T>>;
  }

  upsert(
    rows: any | any[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: 'exact' },
  ): Promise<BqResult<T> & { count: number | null }> {
    this._upsertRows = Array.isArray(rows) ? rows : [rows];
    this._upsertOnConflict = opts?.onConflict ?? null;
    this._upsertIgnoreDuplicates = opts?.ignoreDuplicates ?? false;
    this._upsertCount = opts?.count === 'exact';
    return this._execute() as Promise<BqResult<T> & { count: number | null }>;
  }

  update(data: any): this {
    this._updateData = data;
    return this;
  }

  delete(opts?: { count?: 'exact' }): this {
    this._deleteMode = true;
    this._deleteCount = opts?.count === 'exact';
    return this;
  }

  // ---- Execution ----

  // Make the builder thenable so `await bq.from('x').select('y').eq('z', v)` works
  then<TResult1 = BqResult<T>, TResult2 = never>(
    onfulfilled?: ((value: BqResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return (this._execute() as Promise<BqResult<T>>).then(onfulfilled, onrejected);
  }

  private async _execute(): Promise<BqResult<T> | BqSingleResult<T>> {
    try {
      if (this._insertRows) return await this._execInsert();
      if (this._upsertRows) return await this._execUpsert();
      if (this._updateData) return await this._execUpdate();
      if (this._deleteMode) return await this._execDelete();
      return await this._execSelect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message }, count: null };
    }
  }

  // ---- SELECT ----

  private async _execSelect(): Promise<BqResult<T> | BqSingleResult<T>> {
    const params: any = {};
    const whereClauses = this._buildWhere(params);
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const orderBy = this._orderCol
      ? `ORDER BY ${this._orderCol} ${this._orderAsc ? 'ASC' : 'DESC'}`
      : '';
    const limit = this._limitVal !== null ? `LIMIT ${this._limitVal}` : '';
    const offset = this._offsetVal !== null ? `OFFSET ${this._offsetVal}` : '';

    const sql = `SELECT ${this._selectCols} FROM ${fqTable(this._table)} ${where} ${orderBy} ${limit} ${offset}`.trim();

    const client = getClient();
    const [rows] = await client.query({ query: sql, params, types: {} });

    // Convert BigQuery row objects — BigQuery returns Date objects for TIMESTAMP,
    // convert them to ISO strings for compatibility with existing code
    const data = (rows as any[]).map((row) => {
      const out: any = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v instanceof Date ? v.toISOString() : (v as { value?: unknown })?.value !== undefined ? (v as { value: unknown }).value : v;
      }
      return out;
    }) as T[];

    if (this._isSingle) {
      if (data.length === 0) {
        return { data: null, error: { message: 'Row not found' }, count: null } as BqSingleResult<T>;
      }
      return { data: data[0], error: null, count: null } as BqSingleResult<T>;
    }

    return { data, error: null, count: data.length };
  }

  // ---- INSERT (streaming) ----

  private async _execInsert(): Promise<BqResult<T>> {
    const rows = this._insertRows!;
    if (rows.length === 0) return { data: null, error: null, count: 0 };

    const client = getClient();
    const fq = fqTable(this._table);
    const allCols = Object.keys(rows[0]);
    const INSERT_BATCH = 500;

    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);

      const valueRows = batch.map((row) => {
        const vals = allCols.map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return `${v}`;
          if (typeof v === 'boolean') return `${v}`;
          if (v instanceof Date) return `TIMESTAMP '${v.toISOString()}'`;
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return `TIMESTAMP '${v}'`;
          if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`;
          const escaped = String(v).replace(/'/g, "\\'");
          return `'${escaped}'`;
        });
        return `(${vals.join(', ')})`;
      });

      const sql = `INSERT INTO ${fq} (${allCols.join(', ')}) VALUES ${valueRows.join(',\n')}`;
      await client.query(sql);
    }

    return { data: null, error: null, count: rows.length };
  }

  // ---- UPSERT (MERGE) ----

  private async _execUpsert(): Promise<BqResult<T>> {
    const rows = this._upsertRows!;
    if (rows.length === 0) return { data: null, error: null, count: 0 };

    const conflictCols = this._upsertOnConflict?.split(',').map((c) => c.trim()) ?? [];
    if (conflictCols.length === 0) {
      // No conflict key — fall back to plain insert
      this._insertRows = rows;
      return this._execInsert();
    }

    const allCols = Object.keys(rows[0]);
    const nonKeyCols = allCols.filter((c) => !conflictCols.includes(c));

    // Build struct array for UNNEST source
    const client = getClient();
    const fq = fqTable(this._table);

    // Batch into chunks of 500 to stay under query size limits
    const MERGE_BATCH = 500;
    let totalAffected = 0;

    // Fetch the actual BigQuery table schema so NULL casts match column types
    const [tableMeta] = await client.dataset(dataset).table(this._table).getMetadata();
    const schemaFields: { name: string; type: string }[] = tableMeta.schema?.fields ?? [];
    const schemaTypes: Record<string, string> = {};
    const BQ_TYPE_MAP: Record<string, string> = {
      STRING: 'STRING', FLOAT: 'FLOAT64', FLOAT64: 'FLOAT64', INTEGER: 'INT64',
      INT64: 'INT64', BOOLEAN: 'BOOL', BOOL: 'BOOL', TIMESTAMP: 'TIMESTAMP',
      DATE: 'DATE', DATETIME: 'DATETIME', NUMERIC: 'NUMERIC',
    };
    for (const f of schemaFields) {
      schemaTypes[f.name] = BQ_TYPE_MAP[f.type] || 'STRING';
    }
    // Fallback: infer from data for columns not in schema
    const colTypes: Record<string, string> = { ...schemaTypes };
    for (const c of allCols) {
      if (colTypes[c]) continue;
      for (const row of rows) {
        const v = row[c];
        if (v === null || v === undefined) continue;
        if (typeof v === 'number') { colTypes[c] = 'FLOAT64'; break; }
        if (typeof v === 'boolean') { colTypes[c] = 'BOOL'; break; }
        if (v instanceof Date) { colTypes[c] = 'TIMESTAMP'; break; }
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { colTypes[c] = 'TIMESTAMP'; break; }
        colTypes[c] = 'STRING';
        break;
      }
    }

    for (let i = 0; i < rows.length; i += MERGE_BATCH) {
      const batch = rows.slice(i, i + MERGE_BATCH);

      // Build source rows as SELECT ... UNION ALL SELECT ...
      // Every value is explicitly CAST to ensure consistent types across all rows.
      const sourceRows = batch.map((row) => {
        const fields = allCols.map((c) => {
          const v = row[c];
          const bqType = colTypes[c] || 'STRING';
          if (v === null || v === undefined) return `CAST(NULL AS ${bqType}) AS ${c}`;
          if (typeof v === 'number') return `CAST(${v} AS ${bqType === 'INT64' ? 'INT64' : 'FLOAT64'}) AS ${c}`;
          if (typeof v === 'boolean') return `CAST(${v} AS BOOL) AS ${c}`;
          if (v instanceof Date) return `CAST('${v.toISOString()}' AS TIMESTAMP) AS ${c}`;
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return `CAST('${v}' AS TIMESTAMP) AS ${c}`;
          // Handle arrays/objects as JSON strings
          if (typeof v === 'object') return `CAST('${JSON.stringify(v).replace(/'/g, "\\'")}' AS STRING) AS ${c}`;
          // String — escape single quotes
          const escaped = String(v).replace(/'/g, "\\'");
          return `CAST('${escaped}' AS STRING) AS ${c}`;
        });
        return `SELECT ${fields.join(', ')}`;
      });

      const sourceSQL = sourceRows.join('\nUNION ALL\n');

      const onClause = conflictCols.map((c) => `target.${c} = source.${c}`).join(' AND ');

      let mergeSQL: string;
      if (this._upsertIgnoreDuplicates) {
        // INSERT only, skip existing
        mergeSQL = `
          MERGE ${fq} AS target
          USING (${sourceSQL}) AS source
          ON ${onClause}
          WHEN NOT MATCHED THEN
            INSERT (${allCols.join(', ')})
            VALUES (${allCols.map((c) => `source.${c}`).join(', ')})
        `;
      } else {
        // Full upsert: update existing, insert new
        const updateSet = nonKeyCols.length > 0
          ? nonKeyCols.map((c) => `${c} = source.${c}`).join(', ')
          : conflictCols.map((c) => `${c} = source.${c}`).join(', '); // no-op update if only key cols

        mergeSQL = `
          MERGE ${fq} AS target
          USING (${sourceSQL}) AS source
          ON ${onClause}
          WHEN MATCHED THEN
            UPDATE SET ${updateSet}
          WHEN NOT MATCHED THEN
            INSERT (${allCols.join(', ')})
            VALUES (${allCols.map((c) => `source.${c}`).join(', ')})
        `;
      }

      const [, metadata] = await client.query(mergeSQL);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const affected = (metadata as any)?.numDmlAffectedRows;
      if (affected) totalAffected += parseInt(affected, 10);
    }

    return { data: null, error: null, count: this._upsertCount ? totalAffected : null };
  }

  // ---- UPDATE ----

  private async _execUpdate(): Promise<BqResult<T>> {
    const data = this._updateData!;
    const params: any = {};
    const whereClauses = this._buildWhere(params);

    if (whereClauses.length === 0) {
      return { data: null, error: { message: 'UPDATE without WHERE clause is not allowed' }, count: null };
    }

    const setClauses: string[] = [];
    let paramIdx = this._filters.length;
    for (const [col, val] of Object.entries(data)) {
      const pName = `p${paramIdx++}`;
      setClauses.push(`${col} = @${pName}`);
      params[pName] = val;
    }

    const sql = `UPDATE ${fqTable(this._table)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;

    const client = getClient();
    const [, metadata] = await client.query({ query: sql, params });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const affected = (metadata as any)?.numDmlAffectedRows;

    return { data: null, error: null, count: affected ? parseInt(affected, 10) : null };
  }

  // ---- DELETE ----

  private async _execDelete(): Promise<BqResult<T>> {
    const params: any = {};
    const whereClauses = this._buildWhere(params);

    if (whereClauses.length === 0) {
      return { data: null, error: { message: 'DELETE without WHERE clause is not allowed' }, count: null };
    }

    const sql = `DELETE FROM ${fqTable(this._table)} WHERE ${whereClauses.join(' AND ')}`;

    const client = getClient();
    const [, metadata] = await client.query({ query: sql, params });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const affected = (metadata as any)?.numDmlAffectedRows;

    return { data: null, error: null, count: this._deleteCount ? (affected ? parseInt(affected, 10) : 0) : null };
  }

  // ---- WHERE clause builder ----

  private _buildWhere(params: any): string[] {
    const clauses: string[] = [];

    for (let i = 0; i < this._filters.length; i++) {
      const f = this._filters[i];
      const pName = `p${i}`;

      switch (f.op) {
        case 'eq':
          clauses.push(`${f.column} = @${pName}`);
          params[pName] = f.value;
          break;
        case 'gt':
          clauses.push(`${f.column} > @${pName}`);
          params[pName] = f.value;
          break;
        case 'gte':
          clauses.push(`${f.column} >= @${pName}`);
          params[pName] = f.value;
          break;
        case 'lt':
          clauses.push(`${f.column} < @${pName}`);
          params[pName] = f.value;
          break;
        case 'lte':
          clauses.push(`${f.column} <= @${pName}`);
          params[pName] = f.value;
          break;
        case 'in': {
          const arr = f.value as unknown[];
          clauses.push(`${f.column} IN UNNEST(@${pName})`);
          params[pName] = arr;
          break;
        }
        case 'not_is_null':
          clauses.push(`${f.column} IS NOT NULL`);
          break;
      }
    }

    return clauses;
  }
}

// ---------------------------------------------------------------------------
// RPC stub — only used for compute_wallet_stats, which has a JS fallback
// ---------------------------------------------------------------------------

async function rpc(functionName: string): Promise<BqResult> {
  // No stored procedures in BigQuery — callers should use the JS fallback
  return {
    data: null,
    error: { message: `RPC '${functionName}' not available in BigQuery — use JS fallback` },
    count: null,
  };
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacement for supabaseAdmin
// ---------------------------------------------------------------------------

export const bq = {
  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  },
  rpc,
  /** Run a raw SQL query and return rows with Date→ISO and BigQueryInt→number coercion. */
  async rawQuery<T = any>(sql: string, params: Record<string, unknown> = {}): Promise<{ data: T[] | null; error: { message: string } | null }> {
    try {
      const client = getClient();
      const [rows] = await client.query({ query: sql, params, types: {} });
      const data = (rows as any[]).map((row) => {
        const out: any = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] = v instanceof Date ? v.toISOString() : (v as { value?: unknown })?.value !== undefined ? (v as { value: unknown }).value : v;
        }
        return out;
      }) as T[];
      return { data, error: null };
    } catch (err: unknown) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
};
