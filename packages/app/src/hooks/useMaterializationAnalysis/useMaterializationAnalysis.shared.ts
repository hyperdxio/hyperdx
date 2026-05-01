import {
  findNodes,
  type FunctionCall,
  parse,
  type Statement,
} from 'clickhouse-node-parser';

export type MapKeyReference = {
  column: string;
  key: string;
};

export function mapReferenceToKey(k: MapKeyReference): string {
  return `${k.column}[${k.key}]`;
}

export type MapReferenceGroup = {
  refs: MapKeyReference[];
  queryCount: number;
  sumDurationMs: number;
};

// Canonicalize a set of map-key references: returns the refs in deterministic
// sort order plus a signature string suitable for use as a Map key. The two
// outputs are paired — `sig` is derived from `refs` in their canonical order,
// so different input orderings of the same set produce the same sig and refs.
export function canonicalizeRefs(refs: MapKeyReference[]): {
  refs: MapKeyReference[];
  sig: string;
} {
  const sorted = refs.slice().sort((a, b) => {
    const sa = mapReferenceToKey(a);
    const sb = mapReferenceToKey(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return { refs: sorted, sig: sorted.map(mapReferenceToKey).join(',') };
}

export type MapKeyExtractionResult = {
  ok: boolean;
  keys: MapKeyReference[];
};

// Worker message protocol.
export type ParseRequest = {
  batchId: number;
  startIndex: number;
  sqls: string[];
  columns: string[];
};

export type ParseResponse = {
  batchId: number;
  startIndex: number;
  results: MapKeyExtractionResult[];
};

export class MapReferenceExtractor {
  constructor(private readonly columns: string[]) {}

  private getMapKeyFromArrayElement(
    fc: FunctionCall,
  ): MapKeyReference | undefined {
    if (fc.name !== 'arrayElement' || fc.args.length !== 2) return undefined;

    const [columnArg, key] = fc.args;
    if (columnArg.kind !== 'columnRef' || columnArg.parts.length === 0)
      return undefined;

    const column = columnArg.parts.at(-1);
    if (typeof column !== 'string') return undefined;

    if (key.kind !== 'literal' || key.type !== 'String') return undefined;

    return { column, key: key.value };
  }

  private parseMapKeyReferences(root: Statement[]): MapKeyReference[] {
    const references: MapKeyReference[] = [];

    // Map references are parsed as arrayElement(map, key) function calls
    const functionCallNodes = findNodes(root, 'functionCall');
    for (const call of functionCallNodes) {
      const ref = this.getMapKeyFromArrayElement(call);
      if (ref) references.push(ref);
    }

    return references;
  }

  extractMapKeysFromQuery(sql: string): MapKeyExtractionResult {
    let stmts: Statement[];
    const keys = new Map<string, MapKeyReference>();
    try {
      stmts = parse(sql);
      const mapKeyReferences = this.parseMapKeyReferences(stmts);
      for (const ref of mapKeyReferences) {
        keys.set(mapReferenceToKey(ref), ref);
      }
    } catch {
      return { ok: false, keys: [] };
    }

    return { ok: true, keys: Array.from(keys.values()) };
  }

  extractMaterializedReferencesFromDDL(ddl: string): MapKeyReference[] {
    const refs: MapKeyReference[] = [];
    try {
      const stmts = parse(ddl);
      const cols = findNodes(stmts, 'columnDef');
      for (const col of cols) {
        if (col.defaultKind !== 'MATERIALIZED' || !col.defaultExpr) continue;
        if (
          col.defaultExpr.kind === 'functionCall' &&
          col.defaultExpr.name === 'arrayElement'
        ) {
          const ref = this.getMapKeyFromArrayElement(col.defaultExpr);
          if (ref) refs.push(ref);
        }
      }
    } catch (e) {
      console.error('Failed to parse source DDL for materialized columns', e);
    }
    return refs;
  }
}
