/**
 * Seeds this worktree's dev-slot Mongo with N alerts, for exercising the alerts
 * page at scale.
 *
 * Half the alerts reference saved searches (up to 2 per search), half reference
 * dashboard tiles (up to 4 tiles per dashboard, at most one alert per tile).
 * Every seeded dashboard and saved search carries a tag (default `seeded`) so
 * the whole batch can be removed again with `--purge`.
 *
 *   yarn seed:alerts --count 2000
 *   yarn seed:alerts --purge
 *
 * The Mongo URI defaults to the dev slot of the current git worktree, derived
 * the same way scripts/dev-env.sh derives it. Override with --mongo-uri or
 * MONGO_URI. The dev stack must be up (`yarn dev`) and registered once, since
 * the script attaches everything to the existing team and log source.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { execFileSync } from 'child_process';
import mongoose from 'mongoose';
import path from 'path';

import Alert, { AlertSource, AlertState } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import Team from '@/models/team';
import Webhook, { WebhookService } from '@/models/webhook';

// Several schemas rely on empty strings satisfying `required` (an empty
// `where` is a valid search). src/models/index.ts installs this for the API;
// this script deliberately does not import it, to stay clear of config and
// telemetry bootstrapping.
mongoose.Schema.Types.String.checkRequired(v => v != null);
mongoose.set('strictQuery', false);

const DEFAULT_COUNT = 1000;
const DEFAULT_TAG = 'seeded';
const MAX_ALERTS_PER_SAVED_SEARCH = 2;
const MAX_TILES_PER_DASHBOARD = 4;
const INSERT_CHUNK_SIZE = 500;

/** Roughly what a real team looks like: mostly quiet, a few firing. */
const STATE_WEIGHTS: [AlertState, number][] = [
  [AlertState.OK, 74],
  [AlertState.ALERT, 12],
  [AlertState.PENDING, 9],
  [AlertState.DISABLED, 5],
];

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'] as const;

/** Extra tags beyond the seed tag, so the tag filter has something to filter. */
const FLAVOR_TAGS = ['production', 'staging', 'team-alpha', 'team-beta'];

const NOTE_TEXT = [
  'Runbook: check the upstream queue depth first.',
  'Known noisy during deploys — see #incidents.',
  'Owned by the platform team. Escalate after 15m.',
].map(text => `${text}\n\n- [Runbook](https://example.com/runbook)`);

type Args = {
  count: number;
  tag: string;
  mongoUri: string | null;
  purge: boolean;
  help: boolean;
};

const USAGE = [
  'Usage: yarn seed:alerts [options]',
  '',
  '  -n, --count N       number of alerts to create (default 1000)',
  '      --tag TAG       tag applied to seeded dashboards and saved searches',
  '                      (default "seeded")',
  '      --mongo-uri URI override the dev-slot Mongo URI',
  '      --purge         delete everything carrying --tag instead of seeding',
].join('\n');

function parseArgs(argv: string[]): Args {
  const args: Args = {
    count: DEFAULT_COUNT,
    tag: DEFAULT_TAG,
    mongoUri: null,
    purge: false,
    help: false,
  };

  const rest = [...argv];
  for (let arg = rest.shift(); arg != null; arg = rest.shift()) {
    const next = () => {
      const value = rest.shift();
      if (value == null) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '-n':
      case '--count':
        args.count = Number(next());
        if (!Number.isInteger(args.count) || args.count < 1) {
          throw new Error('--count must be a positive integer');
        }
        break;
      case '--tag':
        args.tag = next();
        break;
      case '--mongo-uri':
        args.mongoUri = next();
        break;
      case '--purge':
        args.purge = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

/**
 * Mongo URI of the dev slot for the worktree this script lives in, matching
 * the slot derivation in scripts/dev-env.sh (cksum of the directory name).
 */
function devSlotMongoUri(): string {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const slot =
    process.env.HDX_DEV_SLOT ??
    execFileSync(
      'sh',
      ['-c', `printf '%s' "$DIR" | cksum | awk '{print $1 % 100}'`],
      {
        encoding: 'utf8',
        env: { ...process.env, DIR: path.basename(repoRoot) },
      },
    ).trim();
  return `mongodb://localhost:${30400 + Number(slot)}/hyperdx`;
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  return (
    minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1))
  );
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

const weightedStates: AlertState[] = STATE_WEIGHTS.flatMap(([state, weight]) =>
  Array.from({ length: weight }, () => state),
);

/** Pairs each plan with the id of the document it was inserted as. */
function* zip<A, B>(as: A[], bs: B[]): Generator<[A, B]> {
  const bIterator = bs[Symbol.iterator]();
  for (const a of as) {
    const b = bIterator.next();
    if (b.done === true) return;
    yield [a, b.value];
  }
}

/** Returns the inserted ids as strings; Mongoose casts them back on write. */
async function insertInChunks<T extends { _id?: unknown }>(
  insertMany: (docs: Record<string, unknown>[]) => Promise<T[]>,
  docs: Record<string, unknown>[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < docs.length; i += INSERT_CHUNK_SIZE) {
    const inserted = await insertMany(docs.slice(i, i + INSERT_CHUNK_SIZE));
    ids.push(...inserted.map(doc => String(doc._id)));
  }
  return ids;
}

function makeAlertDoc({
  teamId,
  channel,
  index,
  savedSearchId,
  dashboardId,
  tileId,
}: {
  teamId: unknown;
  channel: { type: 'webhook'; webhookId: string };
  index: number;
  savedSearchId?: string;
  dashboardId?: string;
  tileId?: string;
}) {
  return {
    team: teamId,
    source: savedSearchId ? AlertSource.SAVED_SEARCH : AlertSource.TILE,
    savedSearch: savedSearchId ?? null,
    groupBy: null,
    dashboard: dashboardId ?? null,
    tileId: tileId ?? null,
    interval: pick(INTERVALS),
    threshold: randomInt(1, 500),
    thresholdType: 'above',
    channel,
    channels: [channel],
    state: pick(weightedStates),
    // Notes make rows taller and collapsible, which is what the virtualized
    // list has to measure rather than assume.
    note: index % 5 === 0 ? pick(NOTE_TEXT) : null,
  };
}

function makeTile(dashboardIndex: number, tileIndex: number, sourceId: string) {
  return {
    id: `seeded-tile-${dashboardIndex}-${tileIndex}`,
    x: (tileIndex % 2) * 6,
    y: Math.floor(tileIndex / 2) * 3,
    w: 6,
    h: 3,
    config: {
      name: `Seeded tile ${tileIndex + 1}`,
      source: sourceId,
      displayType: DisplayType.Line,
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: '',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      granularity: 'auto',
      implicitColumnExpression: 'Body',
      numberFormat: { output: 'number' },
      filters: [],
    },
  };
}

function seededWebhookName(tag: string): string {
  return `Seeded webhook (${tag})`;
}

async function purge(tag: string) {
  const [dashboards, savedSearches] = await Promise.all([
    Dashboard.find({ tags: tag }, { _id: 1 }).lean(),
    SavedSearch.find({ tags: tag }, { _id: 1 }).lean(),
  ]);
  const dashboardIds = dashboards.map(d => d._id);
  const savedSearchIds = savedSearches.map(s => s._id);

  // Alerts first: an alert whose dashboard or saved search is gone renders as
  // a nameless row rather than disappearing.
  const { deletedCount: alertsDeleted } = await Alert.deleteMany({
    $or: [
      { dashboard: { $in: dashboardIds } },
      { savedSearch: { $in: savedSearchIds } },
    ],
  });
  await Dashboard.deleteMany({ _id: { $in: dashboardIds } });
  await SavedSearch.deleteMany({ _id: { $in: savedSearchIds } });
  const { deletedCount: webhooksDeleted } = await Webhook.deleteMany({
    service: WebhookService.Generic,
    name: seededWebhookName(tag),
  });

  console.log(
    `Purged ${alertsDeleted} alerts, ${dashboardIds.length} dashboards, ` +
      `${savedSearchIds.length} saved searches and ${webhooksDeleted} ` +
      `webhooks tagged "${tag}".`,
  );
}

async function seed(count: number, tag: string) {
  const team = await Team.findOne({}).lean();
  if (team == null) {
    throw new Error(
      'No team found — register an account in the dev app first, then re-run.',
    );
  }
  const teamId = team._id;

  const source = await mongoose.connection
    .collection('sources')
    .findOne({ team: teamId, kind: 'log' });
  if (source == null) {
    throw new Error(`No log source found for team ${String(teamId)}.`);
  }
  const sourceId = source._id as mongoose.Types.ObjectId;

  const webhookName = seededWebhookName(tag);
  const webhook = await Webhook.findOneAndUpdate(
    { team: teamId, service: WebhookService.Generic, name: webhookName },
    {
      $setOnInsert: {
        team: teamId,
        service: WebhookService.Generic,
        name: webhookName,
        url: 'https://example.com/seeded-webhook',
      },
    },
    { new: true, upsert: true },
  );
  const channel = {
    type: 'webhook' as const,
    webhookId: String(webhook._id),
  };

  const savedSearchAlertTotal = Math.ceil(count / 2);
  const tileAlertTotal = count - savedSearchAlertTotal;
  const stamp = Date.now();
  const tagsFor = (index: number) => [
    tag,
    FLAVOR_TAGS[index % FLAVOR_TAGS.length],
  ];

  // --- Saved searches: up to MAX_ALERTS_PER_SAVED_SEARCH alerts each --------
  const savedSearchPlans: { doc: Record<string, unknown>; alerts: number }[] =
    [];
  for (let remaining = savedSearchAlertTotal; remaining > 0; ) {
    const alerts = Math.min(
      remaining,
      randomInt(1, MAX_ALERTS_PER_SAVED_SEARCH),
    );
    const index = savedSearchPlans.length;
    savedSearchPlans.push({
      alerts,
      doc: {
        team: teamId,
        name: `Seeded search ${stamp}-${index}`,
        select: '',
        where: '',
        whereLanguage: 'lucene',
        source: sourceId,
        tags: tagsFor(index),
      },
    });
    remaining -= alerts;
  }
  const savedSearchIds = await insertInChunks(
    chunk => SavedSearch.insertMany(chunk),
    savedSearchPlans.map(plan => plan.doc),
  );

  const alertDocs: Record<string, unknown>[] = [];
  for (const [plan, savedSearchId] of zip(savedSearchPlans, savedSearchIds)) {
    for (let i = 0; i < plan.alerts; i++) {
      alertDocs.push(
        makeAlertDoc({
          teamId,
          channel,
          index: alertDocs.length,
          savedSearchId,
        }),
      );
    }
  }

  // --- Dashboards: up to MAX_TILES_PER_DASHBOARD tiles, <=1 alert per tile --
  const dashboardPlans: {
    doc: Record<string, unknown>;
    alertedTileIds: string[];
  }[] = [];
  for (let remaining = tileAlertTotal; remaining > 0; ) {
    const index = dashboardPlans.length;
    const tileCount = randomInt(1, MAX_TILES_PER_DASHBOARD);
    const tiles = Array.from({ length: tileCount }, (_, tileIndex) =>
      makeTile(index, tileIndex, String(sourceId)),
    );
    // Some tiles are left un-alerted, which is the normal case on a dashboard.
    const alertedCount = Math.min(remaining, randomInt(1, tileCount));
    dashboardPlans.push({
      alertedTileIds: tiles.slice(0, alertedCount).map(tile => tile.id),
      doc: {
        team: teamId,
        name: `Seeded dashboard ${stamp}-${index}`,
        tiles,
        tags: tagsFor(index),
        filters: [],
      },
    });
    remaining -= alertedCount;
  }
  const dashboardIds = await insertInChunks(
    chunk => Dashboard.insertMany(chunk),
    dashboardPlans.map(plan => plan.doc),
  );

  for (const [plan, dashboardId] of zip(dashboardPlans, dashboardIds)) {
    for (const tileId of plan.alertedTileIds) {
      alertDocs.push(
        makeAlertDoc({
          teamId,
          channel,
          index: alertDocs.length,
          dashboardId,
          tileId,
        }),
      );
    }
  }

  await insertInChunks(chunk => Alert.insertMany(chunk), alertDocs);

  const byState = new Map<string, number>();
  for (const alert of alertDocs) {
    const state = String(alert.state);
    byState.set(state, (byState.get(state) ?? 0) + 1);
  }
  const disabledCount = byState.get(AlertState.DISABLED) ?? 0;

  console.log(
    [
      `Seeded ${alertDocs.length} alerts for team ${String(teamId)}:`,
      `  ${savedSearchAlertTotal} on ${savedSearchIds.length} saved searches ` +
        `(<=${MAX_ALERTS_PER_SAVED_SEARCH} each)`,
      `  ${tileAlertTotal} on tiles across ${dashboardIds.length} dashboards ` +
        `(<=${MAX_TILES_PER_DASHBOARD} tiles each, <=1 alert per tile)`,
      `  states: ${[...byState]
        .map(([state, n]) => `${state}=${n}`)
        .join(', ')}`,
      `Tagged "${tag}" — remove with: yarn seed:alerts --purge --tag ${tag}`,
    ].join('\n'),
  );
  if (disabledCount > 0) {
    console.log(
      `Note: the ${disabledCount} disabled alerts are not listed on the alerts ` +
        'page, which only renders the triggered, pending and OK sections.',
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const mongoUri = args.mongoUri ?? process.env.MONGO_URI ?? devSlotMongoUri();

  console.log(`Connecting to ${mongoUri}`);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    if (args.purge) {
      await purge(args.tag);
    } else {
      await seed(args.count, args.tag);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
