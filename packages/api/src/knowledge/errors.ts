export type KnowledgeErrorCode =
  | 'not_found'
  | 'already_resolved'
  | 'not_resolved'
  | 'unknown_seq'
  | 'invalid';

// Errors the caller can fix by changing its input. REST and MCP map them by code.
export class KnowledgeError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// The team's knowledge graph setup is wrong: no usable trace source, or missing grants.
export class KnowledgeTargetError extends Error {}

const PERMISSION_ERRORS = new Set(['ACCESS_DENIED', 'READONLY', '497', '164']);

const isPermissionError = (e: unknown) =>
  e instanceof Error &&
  (('type' in e && PERMISSION_ERRORS.has(String(e.type))) ||
    ('code' in e && PERMISSION_ERRORS.has(String(e.code))));

export async function withWriteGrants<T>(
  database: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isPermissionError(e)) {
      throw new KnowledgeTargetError(
        `The ClickHouse user of the trace source connection cannot write the knowledge graph tables. Grant CREATE TABLE, INSERT, ALTER ADD COLUMN and ALTER DELETE on database ${database}.`,
      );
    }
    throw e;
  }
}
