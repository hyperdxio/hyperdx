# HyperDX MongoDB Usage Analysis

## Summary

HyperDX uses MongoDB exclusively for **application metadata and configuration** -- not for telemetry data (logs, metrics, traces, session replays), which is stored in ClickHouse. MongoDB holds user accounts, team configuration, dashboard layouts, saved queries, alert definitions, webhook integrations, data source mappings, and Express sessions. The data model is multi-tenant with `Team` as the root entity; every query includes a `team` filter enforced at the controller layer.

There are **11 Mongoose models** across 11 collections, **2 TTL indexes** (AlertHistory and TeamInvite, both 30 days), and **1 migration script**. Session storage uses `connect-mongo` with a 30-day rolling TTL. The connection pool is configured for 100 max connections with 10-second heartbeat retries.

---

## 1. Connection Setup

**File:** `packages/api/src/models/index.ts`

| Detail | Value | Line |
|--------|-------|------|
| Connection function | `connectDB()` | 37 |
| Connection options | `maxPoolSize: 100`, `heartbeatFrequencyMS: 10000` | 44-46 |
| `strictQuery` | `false` | 9 |
| Custom String validator | Allows empty strings on required fields | 14 |
| Connection export | `mongooseConnection` (raw mongoose.connection) | 50 |
| AWS auth support | Via `aws4` dependency for MONGODB-AWS auth mechanism | 38-40 |

**Event handlers** (lines 17-35): `connected`, `disconnected`, `error`, `reconnected`, `reconnectFailed`

**Initialization:** `connectDB()` is called in `packages/api/src/server.ts:88` after HTTP servers start. Graceful shutdown calls `mongooseConnection.close(false)` at `server.ts:30-32`.

**Docker:** MongoDB 5.0.32-focal in `docker-compose.yml:18-20` (production) and `docker-compose.dev.yml:10-19` (dev, exposes port 27017). Volume-mounted at `.volumes/db` / `.volumes/db_dev`.

**Environment:** `MONGO_URI` configured in `packages/api/.env.development:14` as `mongodb://localhost:27017/hyperdx`.

---

## 2. Session Storage

**File:** `packages/api/src/api-app.ts:23-34`

```
store: new MongoStore({ mongoUrl: config.MONGO_URI })
```

| Setting | Value | Line |
|---------|-------|------|
| Store | `connect-mongo` MongoStore | 33 |
| Session TTL | 30 days (`maxAge: 1000 * 60 * 60 * 24 * 30`) | 30 |
| Rolling | `true` (refreshed on each request) | 32 |
| Cookie secure | Dynamic based on `FRONTEND_URL` protocol | 40-42 |
| Cookie sameSite | `lax` | 29 |
| resave | `false` | 24 |
| saveUninitialized | `false` | 25 |

Sessions are stored in a `sessions` collection managed automatically by `connect-mongo`. The collection is **not** defined as a Mongoose model.

---

## 3. Model Definitions

All models are in `packages/api/src/models/`.

### 3.1 User (`user.ts`)

**Lines 19-51** | Collection: `users`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | String | No | |
| `email` | String | Yes | Unique index (line 49) |
| `team` | ObjectId ref Team | No | |
| `accessKey` | String | No | Default: `uuidv4()` (line 29-31) |
| `salt` | String | -- | Added by passport plugin |
| `hash` | String | -- | Added by passport plugin |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:**
- `{ email: 1 }` UNIQUE (line 49)

**Plugin:** `passport-local-mongoose` (lines 43-47) with `usernameField: 'email'`, `usernameLowerCase: true`, `usernameCaseInsensitive: true`. Adds password hashing (`salt`/`hash` fields) and authentication methods.

**Virtual:** `hasPasswordAuth` getter returns `true` (line 39-41).

**Controller:** `packages/api/src/controllers/user.ts`
| Function | Line | Query |
|----------|------|-------|
| `findUserByAccessKey(accessKey)` | 6-8 | `User.findOne({ accessKey })` |
| `findUserById(id)` | 10-12 | `User.findById(id)` |
| `findUserByEmail(email)` | 14-17 | `User.findOne({ email: email.toLowerCase() })` |
| `findUserByEmailInTeam(email, team)` | 19-25 | `User.findOne({ email: email.toLowerCase(), team })` |
| `findUsersByTeam(team)` | 27-29 | `User.find({ team }).sort({ createdAt: 1 })` |
| `deleteTeamMember(teamId, userIdToDelete, userIdRequestingDelete)` | 31-52 | `Alert.updateMany(...)` + `User.findOneAndDelete(...)` |

---

### 3.2 Team (`team.ts`)

**Lines 13-49** | Collection: `teams`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | String | No | |
| `allowedAuthMethods` | [String] | No | |
| `hookId` | String | No | Default: `uuidv4()` (line 21-23) |
| `apiKey` | String | No | Default: `uuidv4()` (line 27-29) |
| `collectorAuthenticationEnforced` | Boolean | No | Default: `false` (line 33) |
| `metadataMaxRowsToRead` | Number | No | ClickHouse setting |
| `searchRowLimit` | Number | No | ClickHouse setting |
| `queryTimeout` | Number | No | ClickHouse setting |
| `fieldMetadataDisabled` | Boolean | No | ClickHouse setting |
| `parallelizeWhenPossible` | Boolean | No | ClickHouse setting |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined (default `_id` only).

**Options:** `toJSON: { virtuals: true }`, `toObject: { virtuals: true }` (lines 45-46).

**Controller:** `packages/api/src/controllers/team.ts`
| Function | Line | Query |
|----------|------|-------|
| `isTeamExisting()` | 25-32 | `Team.countDocuments({})` |
| `createTeam({ name, collectorAuthenticationEnforced })` | 34-50 | `new Team(...).save()` |
| `getAllTeams(fields?)` | 52-58 | `Team.find({}, fields)` |
| `getTeam(id?, fields?)` | 60-66 | `Team.findOne({}, fields)` |
| `getTeamByApiKey(apiKey)` | 68-74 | `Team.findOne({ apiKey })` |
| `rotateTeamApiKey(teamId)` | 76-78 | `Team.findByIdAndUpdate(teamId, { apiKey: uuidv4() })` |
| `setTeamName(teamId, name)` | 80-82 | `Team.findByIdAndUpdate(teamId, { name })` |
| `updateTeamClickhouseSettings(teamId, settings)` | 84-89 | `Team.findByIdAndUpdate(teamId, settings)` |
| `getTags(teamId)` | 91-111 | Aggregation pipelines on Dashboard + SavedSearch |

**Local app mode:** When `IS_LOCAL_APP_MODE=true`, a static `LOCAL_APP_TEAM` object is used instead of querying MongoDB (lines 11-23).

---

### 3.3 Alert (`alert.ts`)

**Lines 76-169** | Collection: `alerts`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `threshold` | Number | Yes | |
| `thresholdType` | String enum (`above`, `below`) | No | |
| `interval` | String | Yes | `1m`, `5m`, `15m`, `30m`, `1h`, `6h`, `12h`, `1d` |
| `channel` | Mixed | No | `{ type: 'webhook', webhookId }` or `{ type: null }` |
| `state` | String enum | No | Default: `OK`. Values: `OK`, `ALERT`, `INSUFFICIENT_DATA`, `DISABLED` |
| `source` | String | No | Default: `saved_search`. Enum: `saved_search`, `tile` |
| `team` | ObjectId ref Team | No | |
| `createdBy` | ObjectId ref User | No | |
| `name` | String | No | Alert title |
| `message` | String | No | Alert message template |
| `savedSearch` | ObjectId ref SavedSearch | No | For saved_search alerts |
| `groupBy` | String | No | Group-by clause |
| `dashboard` | ObjectId ref Dashboard | No | For tile alerts |
| `tileId` | String | No | Tile ID within dashboard |
| `silenced.by` | ObjectId ref User | No | |
| `silenced.at` | Date | Yes (if silenced) | |
| `silenced.until` | Date | Yes (if silenced) | |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined.

**Controller:** `packages/api/src/controllers/alerts.ts`
| Function | Line | Operation |
|----------|------|-----------|
| `createAlert(teamId, alertInput, userId)` | 73-94 | `new Alert({...}).save()` |
| `updateAlert(id, teamId, alertInput)` | 97-113 | `Alert.findOneAndUpdate({ _id, team }, ...)` |
| `getAlerts(teamId)` | 115-117 | `Alert.find({ team: teamId })` |
| `getAlertById(alertId, teamId)` | 119-127 | `Alert.findOne({ _id, team })` |
| `getTeamDashboardAlertsByTile(teamId)` | 129-135 | `Alert.find({ source: TILE, team }).populate('createdBy')` |
| `getDashboardAlertsByTile(teamId, dashboardId)` | 137-147 | `Alert.find({ dashboard, source: TILE, team }).populate(...)` |
| `createOrUpdateDashboardAlerts(dashboardId, teamId, alertsByTile, userId?)` | 149-175 | Upsert per tile: `Alert.findOneAndUpdate(..., { upsert: true })` |
| `deleteDashboardAlerts(dashboardId, teamId, tileIds?)` | 177-188 | `Alert.deleteMany({ dashboard, team, source: TILE, ... })` |
| `deleteSavedSearchAlerts(savedSearchId, teamId)` | 190-198 | `Alert.deleteMany({ savedSearch, team })` |
| `getAlertsEnhanced(teamId)` | 200-209 | `Alert.find({ team }).populate([...])` |
| `deleteAlert(id, teamId)` | 211-216 | `Alert.deleteOne({ _id, team })` |
| `generateAlertSilenceToken(alertId, teamId)` | 218-250 | JWT generation for silent link |
| `silenceAlertByToken(token)` | 252-278 | JWT verification + `alert.save()` with silenced field |

---

### 3.4 AlertHistory (`alertHistory.ts`)

**Lines 17-63** | Collection: `alerthistories`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `counts` | Number | No | Default: `0` |
| `createdAt` | Date | Yes | Used as TTL key |
| `alert` | ObjectId ref Alert | No | |
| `state` | String enum | Yes | AlertState values |
| `lastValues[].startTime` | Date | Yes | |
| `lastValues[].count` | Number | Yes | |
| `group` | String | No | Group identifier for group-by alerts |

**Indexes:**
- `{ createdAt: 1 }` with **TTL: 30 days** (`expireAfterSeconds: 2592000`) (lines 50-53)
- `{ alert: 1, createdAt: -1 }` compound index (line 58)

**Controller:** `packages/api/src/controllers/alertHistory.ts`
| Function | Line | Operation |
|----------|------|-----------|
| `getRecentAlertHistories({ alertId, limit })` | 17-67 | Aggregation: `$match` -> `$group` by createdAt -> `$sort` -> `$limit` |

The aggregation pipeline groups histories by `createdAt`, sums counts, collects states, and determines if any group has `ALERT` state. Returns flattened/sorted `lastValues`.

---

### 3.5 Dashboard (`dashboard.ts`)

**Lines 14-35** | Collection: `dashboards`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | String | Yes | |
| `tiles` | Mixed | Yes | Complex tile configuration objects |
| `team` | ObjectId ref Team | No | |
| `tags` | [String] | No | Default: `[]` |
| `filters` | Array | No | Default: `[]` |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined.

**Options:** `toJSON: { getters: true }` (line 32).

**Controller:** `packages/api/src/controllers/dashboard.ts`
| Function | Line | Operation |
|----------|------|-----------|
| `getDashboards(teamId)` | 85-102 | `Dashboard.find({ team })` + merge alerts per tile |
| `getDashboard(dashboardId, teamId)` | 104-117 | `Dashboard.findOne({ _id, team })` + merge alerts |
| `createDashboard(teamId, dashboard, userId?)` | 119-137 | `new Dashboard({...}).save()` + create tile alerts |
| `deleteDashboard(dashboardId, teamId)` | 139-147 | `Dashboard.findOneAndDelete({ _id, team })` + delete alerts |
| `updateDashboard(dashboardId, teamId, updates, userId?)` | 149-187 | `Dashboard.findOneAndUpdate(...)` + `syncDashboardAlerts()` |

Dashboard updates trigger alert synchronization (`syncDashboardAlerts`, lines 42-83): creates/updates alerts for tiles with alert configs and deletes alerts for removed tiles or cleared configs.

---

### 3.6 SavedSearch (`savedSearch.ts`)

**Lines 15-43** | Collection: `savedsearches`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `team` | ObjectId ref Team | Yes | |
| `name` | String | No | |
| `select` | String | No | ClickHouse SELECT clause |
| `where` | String | No | ClickHouse WHERE clause |
| `whereLanguage` | String | No | Query language |
| `orderBy` | String | No | ClickHouse ORDER BY |
| `source` | ObjectId ref Source | Yes | |
| `tags` | [String] | No | |
| `filters` | [Mixed] | No | |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined.

**Controller:** `packages/api/src/controllers/savedSearch.ts`
| Function | Line | Operation |
|----------|------|-----------|
| `getSavedSearches(teamId)` | 12-27 | `SavedSearch.find({ team })` + attach grouped alerts |
| `getSavedSearch(teamId, savedSearchId)` | 29-31 | `SavedSearch.findOne({ _id, team })` |
| `createSavedSearch(teamId, savedSearch)` | 33-38 | `SavedSearch.create({ ...savedSearch, team })` |
| `updateSavedSearch(teamId, savedSearchId, savedSearch)` | 40-53 | `SavedSearch.findOneAndUpdate({ _id, team }, ...)` |
| `deleteSavedSearch(teamId, savedSearchId)` | 55-63 | `SavedSearch.findOneAndDelete({ _id, team })` + delete related alerts |

---

### 3.7 Source (`source.ts`)

**Lines 17-105** | Collection: `sources`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `kind` | String enum (SourceKind) | Yes | |
| `team` | ObjectId ref Team | Yes | |
| `connection` | ObjectId ref Connection | Yes | |
| `from.databaseName` | String | No | ClickHouse database |
| `from.tableName` | String | No | ClickHouse table |
| `timestampValueExpression` | String | No | |
| `name` | String | No | |
| `displayedTimestampValueExpression` | String | No | |
| `implicitColumnExpression` | String | No | |
| `serviceNameExpression` | String | No | |
| `bodyExpression` | String | No | |
| `tableFilterExpression` | String | No | |
| `eventAttributesExpression` | String | No | |
| `resourceAttributesExpression` | String | No | |
| `defaultTableSelectExpression` | String | No | |
| `uniqueRowIdExpression` | String | No | |
| `severityTextExpression` | String | No | |
| `traceIdExpression` | String | No | |
| `spanIdExpression` | String | No | |
| `traceSourceId` | String | No | Cross-reference to trace source |
| `sessionSourceId` | String | No | Cross-reference to session source |
| `metricSourceId` | String | No | Cross-reference to metric source |
| `durationExpression` | String | No | |
| `durationPrecision` | Number | No | |
| `parentSpanIdExpression` | String | No | |
| `spanNameExpression` | String | No | |
| `logSourceId` | String | No | Cross-reference to log source |
| `spanKindExpression` | String | No | |
| `statusCodeExpression` | String | No | |
| `statusMessageExpression` | String | No | |
| `spanEventsValueExpression` | String | No | |
| `highlightedTraceAttributeExpressions` | Array | No | |
| `highlightedRowAttributeExpressions` | Array | No | |
| `materializedViews` | Array | No | |
| `metricTables` | Object | No | Keys: Gauge, Histogram, Sum, Summary, ExponentialHistogram |
| `querySettings` | Array (max 10) | No | `[{ setting, value }]` |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined.

**Controller:** `packages/api/src/controllers/sources.ts`
| Function | Line | Operation |
|----------|------|-----------|
| `getSources(team)` | 21-23 | `Source.find({ team })` |
| `getSource(team, sourceId)` | 25-27 | `Source.findOne({ _id, team })` |
| `createSource(team, source)` | 29-31 | `Source.create({ ...source, team })` |
| `updateSource(team, sourceId, source)` | 33-42 | `cleanSourceData()` + `Source.findOneAndUpdate(...)` |
| `deleteSource(team, sourceId)` | 44-46 | `Source.findOneAndDelete({ _id, team })` |

Note: `cleanSourceData()` (lines 10-19) explicitly nulls `metricTables` when kind is not Metric to prevent stale config persistence.

---

### 3.8 Connection (`connection.ts`)

**Lines 17-40** | Collection: `connections`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `team` | ObjectId ref Team | Yes | |
| `name` | String | No | |
| `host` | String | No | |
| `username` | String | No | |
| `password` | String | No | **`select: false`** -- excluded from queries by default (line 31) |
| `hyperdxSettingPrefix` | String | No | |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined.

**Security:** The `password` field uses `select: false` so it is never returned unless explicitly requested with `.select('+password')`.

**Controller:** `packages/api/src/controllers/connection.ts`
| Function | Line | Operation |
|----------|------|-----------|
| `getConnections()` | 3-7 | `Connection.find({})` (password excluded) |
| `getConnectionById(team, connectionId, selectPassword?)` | 9-17 | `Connection.findOne({ _id, team }).select(...)` |
| `createConnection(team, connection)` | 19-24 | `Connection.create({ ...connection, team })` |
| `updateConnection(team, connectionId, connection, unsetFields?)` | 26-51 | `Connection.findOneAndUpdate(...)` with `$set`/`$unset` |
| `deleteConnection(team, connectionId)` | 53-55 | `Connection.findOneAndDelete({ _id, team })` |

---

### 3.9 Webhook (`webhook.ts`)

**Lines 33-73** | Collection: `webhooks`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `team` | ObjectId ref Team | No | |
| `service` | String enum (WebhookService) | Yes | e.g. `slack`, `generic` |
| `name` | String | Yes | |
| `url` | String | No | Webhook endpoint URL |
| `description` | String | No | |
| `queryParams` | Map<String, String> | No | Mongoose Map type |
| `headers` | Map<String, String> | No | Mongoose Map type |
| `body` | String | No | Custom payload template |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:**
- `{ team: 1, service: 1, name: 1 }` UNIQUE (line 71)

---

### 3.10 TeamInvite (`teamInvite.ts`)

**Lines 13-42** | Collection: `teaminvites`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `teamId` | ObjectId ref Team | Yes | |
| `name` | String | No | |
| `email` | String | Yes | |
| `token` | String | Yes | Invitation token |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:**
- `{ createdAt: 1 }` with **TTL: 30 days** (`expireAfterSeconds: 2592000`) (lines 35-38)
- `{ teamId: 1, email: 1 }` UNIQUE (line 40)

---

### 3.11 PresetDashboardFilter (`presetDashboardFilter.ts`)

**Lines 17-55** | Collection: `presetdashboardfilters`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | String | Yes | |
| `team` | ObjectId ref Team | Yes | |
| `source` | ObjectId ref Source | Yes | |
| `sourceMetricType` | String enum (MetricsDataType) | No | |
| `presetDashboard` | String enum (PresetDashboard) | Yes | |
| `type` | String | Yes | Filter type |
| `expression` | String | Yes | Filter expression |
| `createdAt` | Date | Auto | timestamps: true |
| `updatedAt` | Date | Auto | timestamps: true |

**Indexes:** None explicitly defined.

---

## 4. TTL (Time-To-Live) Behavior

Two Mongoose models use MongoDB's native TTL index feature, plus Express sessions have their own TTL:

| Collection | TTL Duration | Index Field | Mechanism | File:Line |
|------------|-------------|-------------|-----------|-----------|
| `alerthistories` | 30 days | `createdAt` | MongoDB TTL index (`expireAfterSeconds: 2592000`) | `alertHistory.ts:50-53` |
| `teaminvites` | 30 days | `createdAt` | MongoDB TTL index (`expireAfterSeconds: 2592000`) | `teamInvite.ts:35-38` |
| `sessions` | 30 days | Managed by `connect-mongo` | Based on session cookie `maxAge` | `api-app.ts:30,33` |

**How it works:** MongoDB runs a background thread every 60 seconds that checks TTL-indexed fields. Documents where `createdAt + expireAfterSeconds < now` are automatically deleted. No application code is needed for cleanup.

**AlertHistory TTL rationale:** Alert state history is only needed for recent display. The 30-day window provides enough history for alert investigation while preventing unbounded growth.

**TeamInvite TTL rationale:** Invitation tokens should expire for security. After 30 days, unclaimed invitations are automatically purged.

---

## 5. Data Relationships

```
Team (root tenant)
 |
 +-- User (team member)
 |
 +-- Connection (ClickHouse credentials)
 |    |
 |    +-- Source (data source mapping)
 |         |
 |         +-- SavedSearch (saved query)
 |         |    |
 |         |    +-- Alert (saved search alert)
 |         |         |
 |         |         +-- AlertHistory (state history, TTL 30d)
 |         |
 |         +-- PresetDashboardFilter
 |
 +-- Dashboard (layout + tiles)
 |    |
 |    +-- Alert (tile alert)
 |         |
 |         +-- AlertHistory (state history, TTL 30d)
 |
 +-- Webhook (notification endpoint)
 |
 +-- TeamInvite (invitation token, TTL 30d)
```

**Key relationships:**
- `Alert` can reference either `SavedSearch` or `Dashboard` (determined by `source` field: `saved_search` vs `tile`)
- `Alert.channel.webhookId` references `Webhook._id` for notifications
- `Source` has cross-reference string fields (`traceSourceId`, `logSourceId`, `sessionSourceId`, `metricSourceId`) linking related sources together
- Cascading deletes: deleting a Dashboard deletes its tile alerts; deleting a SavedSearch deletes its alerts

---

## 6. Multi-Tenancy

All data is scoped to a `Team`. The pattern is enforced at the **application/controller layer** -- every query includes `{ team: teamId }`.

Examples:
- `Alert.find({ team: teamId })` -- `controllers/alerts.ts:116`
- `Dashboard.find({ team: teamId })` -- `controllers/dashboard.ts:87`
- `SavedSearch.find({ team: teamId })` -- `controllers/savedSearch.ts:13`
- `Source.find({ team })` -- `controllers/sources.ts:22`
- `Connection.findOne({ _id: connectionId, team })` -- `controllers/connection.ts:14`

There are no database-level tenant isolation constraints (no per-tenant databases or MongoDB row-level security). Authentication middleware (`isUserAuthenticated` at `api-app.ts:88-97`) must execute before any data access.

---

## 7. MongoDB vs ClickHouse Division

| MongoDB (metadata/config) | ClickHouse (telemetry) |
|---------------------------|----------------------|
| Teams, Users | Log events |
| Dashboards (layout, tile config) | Metric time-series data |
| Saved Searches (query definitions) | Trace spans |
| Alerts (thresholds, schedules) | Session replays |
| Alert History (state changes) | |
| Webhooks (notification config) | |
| Sources (column mappings to CH tables) | |
| Connections (CH credentials) | |
| Sessions (auth state) | |
| Team Invites | |
| Preset Dashboard Filters | |

The `Source` model is the bridge: it stores the mapping between logical concepts (timestamp, service name, body, trace ID) and physical ClickHouse column expressions. When a query is executed, the Source config is read from MongoDB and used to construct the ClickHouse SQL.

---

## 8. Aggregation Pipelines

### AlertHistory Aggregation (`controllers/alertHistory.ts:24-55`)
```
$match { alert: alertId }
  -> $group { _id: '$createdAt', states: $push, counts: $sum, lastValues: $push }
    -> $sort { _id: -1 }
      -> $limit
```
Groups alert histories by timestamp, sums counts, collects states. Returns whether any group has ALERT state.

### Tags Aggregation (`controllers/team.ts:91-111`)
Two parallel pipelines on Dashboard and SavedSearch:
```
$match { team: teamId } -> $unwind '$tags' -> $group { _id: '$tags' }
```
Extracts unique tags across dashboards and saved searches per team. Results are de-duplicated with a `Set`.

---

## 9. Indexes Summary

| Collection | Index | Type | File:Line |
|------------|-------|------|-----------|
| `users` | `{ email: 1 }` | Unique | `user.ts:49` |
| `alerthistories` | `{ createdAt: 1 }` | TTL (30d) | `alertHistory.ts:50-53` |
| `alerthistories` | `{ alert: 1, createdAt: -1 }` | Compound | `alertHistory.ts:58` |
| `teaminvites` | `{ createdAt: 1 }` | TTL (30d) | `teamInvite.ts:35-38` |
| `teaminvites` | `{ teamId: 1, email: 1 }` | Unique compound | `teamInvite.ts:40` |
| `webhooks` | `{ team: 1, service: 1, name: 1 }` | Unique compound | `webhook.ts:71` |

All collections also have the default `{ _id: 1 }` index.

---

## 10. Migration Scripts

**Location:** `packages/api/migrations/mongo/`

Only one migration exists:

**`20231130053610-add_accessKey_field_to_user_collection.ts`**
- **Up:** `db.collection('users').updateMany({}, { $set: { accessKey: uuidv4() } })` -- adds UUID accessKey to all existing users
- **Down:** `db.collection('users').updateMany({}, { $unset: { accessKey: '' } })` -- removes the field
- Uses raw MongoDB driver (not Mongoose)
- Migration config: `packages/api/migrate-mongo-config.ts` (database: "hyperdx")

---

## 11. Authentication Patterns

Two authentication methods, both backed by MongoDB:

1. **Session-based (Passport.js):** User logs in with email/password, passport-local-mongoose handles hashing, session stored in MongoDB via connect-mongo. Used by the web UI.

2. **Access key (Bearer token):** Each user has a UUID `accessKey`. Validated by `validateUserAccessKey` middleware at `packages/api/src/middleware/auth.ts`. Used for programmatic API access.

3. **Local app mode:** When `IS_LOCAL_APP_MODE=true`, authentication is bypassed entirely. A static mock user/team is used without any MongoDB queries.
