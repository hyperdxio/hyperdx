import { z } from 'zod';
import { SourceKind, WithClauseSchema } from '@hyperdx/common-utils/dist/types';

export enum Tab {
  Overview = 'overview',
  Parsed = 'parsed',
  Debug = 'debug',
  Trace = 'trace',
  ServiceMap = 'serviceMap',
  Context = 'context',
  Replay = 'replay',
  Infrastructure = 'infrastructure',
}

const NavEntrySchema = z.object({
  rowId: z.string(),
  aliasWith: z.array(WithClauseSchema),
  label: z.string(),
  sourceKind: z.nativeEnum(SourceKind).optional(),
  originTab: z.nativeEnum(Tab).optional(),
});

export type NavEntry = z.infer<typeof NavEntrySchema>;

const SourceFrameSchema = z.object({
  sourceId: z.string(),
  rowId: z.string(),
  aliasWith: z.array(WithClauseSchema),
  label: z.string(),
  sourceKind: z.nativeEnum(SourceKind).optional(),
  originTab: z.nativeEnum(Tab).optional(),
  /**
   * ISO timestamp of the row the push originated from, when the pushing panel
   * knows the destination row sits at roughly the same point in time (e.g.
   * "View Trace" jumps to the span the current log belongs to). Lets the
   * destination bound its row lookup to a window. Optional — frames pushed
   * without a trustworthy anchor (eg. span links, which may point at a distant
   * trace) leave it unset.
   */
  focusTimestamp: z.string().optional(),
});

export type SourceFrame = z.infer<typeof SourceFrameSchema>;

export const parseSourceStack = z.array(SourceFrameSchema).parse;

export const parseNavStack = z.array(NavEntrySchema).parse;
