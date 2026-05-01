/// <reference lib="webworker" />
import {
  MapReferenceExtractor,
  type ParseRequest,
  type ParseResponse,
} from './useMaterializationAnalysis.shared';

const ctx: DedicatedWorkerGlobalScope =
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { batchId, startIndex, sqls, columns } = event.data;
  const parser = new MapReferenceExtractor(columns);
  const results = sqls.map(sql => parser.extractMapKeysFromQuery(sql));
  const response: ParseResponse = {
    batchId,
    startIndex,
    results,
  };
  ctx.postMessage(response);
};
