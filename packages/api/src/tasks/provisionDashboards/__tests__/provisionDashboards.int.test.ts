/* eslint-disable security/detect-non-literal-fs-filename */
import {
  AlertThresholdType,
  BuilderSavedChartConfig,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import fs from 'fs';
import mongoose from 'mongoose';
import os from 'os';
import path from 'path';

import { createTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB, makeTile } from '@/fixtures';
import Alert, { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';
import Team from '@/models/team';
import Webhook from '@/models/webhook';
import {
  readDashboardFiles,
  syncDashboards,
} from '@/tasks/provisionDashboards';
import ProvisionDashboardsTask from '@/tasks/provisionDashboards';
import { TaskName } from '@/tasks/types';

describe('provisionDashboards', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdx-dash-test-'));
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  describe('readDashboardFiles', () => {
    it('returns empty array for non-existent directory', () => {
      const result = readDashboardFiles('/non/existent/path');
      expect(result).toEqual([]);
    });

    it('returns empty array for directory with no json files', () => {
      fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a dashboard');
      const result = readDashboardFiles(tmpDir);
      expect(result).toEqual([]);
    });

    it('skips invalid JSON files', () => {
      fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{invalid json');
      const result = readDashboardFiles(tmpDir);
      expect(result).toEqual([]);
    });

    it('skips files that fail schema validation', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'no-name.json'),
        JSON.stringify({ tiles: [] }),
      );
      const result = readDashboardFiles(tmpDir);
      expect(result).toEqual([]);
    });

    it('parses dashboard files without optional tags field', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'no-tags.json'),
        JSON.stringify({ name: 'No Tags', tiles: [makeTile()] }),
      );
      const result = readDashboardFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('No Tags');
      expect(result[0].tags).toEqual([]);
    });

    it('parses valid dashboard files', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify({ name: 'Test', tiles: [makeTile()], tags: [] }),
      );
      const result = readDashboardFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test');
    });

    it('parses a dashboard file carrying a static-list filter', () => {
      const filter = {
        id: 'filter-static',
        type: 'STATIC_LIST',
        name: 'Environment',
        options: ['prod', 'staging', 'dev'],
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        variableName: 'env',
      };
      fs.writeFileSync(
        path.join(tmpDir, 'static-filter.json'),
        JSON.stringify({
          name: 'Static Filter',
          tiles: [makeTile()],
          tags: [],
          filters: [filter],
        }),
      );

      const result = readDashboardFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].filters).toEqual([filter]);
    });

    // `expression` and `source` are optional at the field level so a
    // `STATIC_LIST` filter can exist, so the per-type refinement is what keeps
    // an unqueryable query-expression filter out of a provisioned file.
    it.each(['expression', 'source'])(
      'skips a file whose query-expression filter has no %s',
      field => {
        fs.writeFileSync(
          path.join(tmpDir, `no-${field}.json`),
          JSON.stringify({
            name: 'Bad Filter',
            tiles: [makeTile()],
            tags: [],
            filters: [
              {
                id: 'filter-1',
                type: 'QUERY_EXPRESSION',
                name: 'Service',
                ...(field === 'expression'
                  ? { source: 'source-1' }
                  : { expression: 'ServiceName' }),
              },
            ],
          }),
        );

        expect(readDashboardFiles(tmpDir)).toEqual([]);
      },
    );

    // Pins the inlined `migrateLegacyDashboardTileColorsRaw` walker
    // (which delegates to `walkRawDashboardTileColors` in common-utils).
    // Without the migration the strict `DashboardWithoutIdSchema`
    // rejects the legacy enum and `readDashboardFiles` skips the file
    // outright, so a provisioned dashboard authored against #2265
    // wouldn't ship at all.
    it('migrates legacy chart-N tile colors before schema validation', () => {
      const tile = makeTile();
      (tile.config as any).color = 'chart-1';
      fs.writeFileSync(
        path.join(tmpDir, 'legacy.json'),
        JSON.stringify({ name: 'Legacy', tiles: [tile], tags: [] }),
      );
      const result = readDashboardFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect((result[0].tiles[0].config as any).color).toBe('chart-green');
    });

    // Early-return for files whose `tiles` is non-array (or missing).
    // The walker leaves the payload untouched, so the file behaves
    // exactly like any other schema-invalid input: skipped, not
    // crashed.
    it('does not crash on a file whose tiles is not an array', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'tiles-string.json'),
        JSON.stringify({ name: 'Bad Tiles', tiles: 'not-an-array', tags: [] }),
      );
      expect(() => readDashboardFiles(tmpDir)).not.toThrow();
      expect(readDashboardFiles(tmpDir)).toEqual([]);
    });
  });

  describe('syncDashboards', () => {
    it('creates a new dashboard', async () => {
      const team = await createTeam({ name: 'My Team' });
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify({
          name: 'New Dashboard',
          tiles: [makeTile()],
          tags: [],
        }),
      );

      await syncDashboards(team._id.toString(), tmpDir);

      const count = await Dashboard.countDocuments({ team: team._id });
      expect(count).toBe(1);
    });

    it('updates an existing dashboard by name', async () => {
      const team = await createTeam({ name: 'My Team' });
      const tile = makeTile();
      await new Dashboard({
        name: 'Existing',
        tiles: [tile],
        tags: [],
        team: team._id,
        provisioned: true,
      }).save();

      const newTile = makeTile();
      fs.writeFileSync(
        path.join(tmpDir, 'existing.json'),
        JSON.stringify({
          name: 'Existing',
          tiles: [newTile],
          tags: ['updated'],
        }),
      );

      await syncDashboards(team._id.toString(), tmpDir);

      const dashboard = (await Dashboard.findOne({
        name: 'Existing',
        team: team._id,
      })) as any;
      expect(dashboard.tiles[0].id).toBe(newTile.id);
      expect(dashboard.tags).toEqual(['updated']);
    });

    it('does not create duplicates on repeated sync', async () => {
      const team = await createTeam({ name: 'My Team' });
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify({ name: 'Dashboard', tiles: [makeTile()], tags: [] }),
      );

      await syncDashboards(team._id.toString(), tmpDir);
      await syncDashboards(team._id.toString(), tmpDir);
      await syncDashboards(team._id.toString(), tmpDir);

      const count = await Dashboard.countDocuments({ team: team._id });
      expect(count).toBe(1);
    });

    it('provisions to multiple teams', async () => {
      const teamA = await createTeam({ name: 'Team A' });
      const teamB = await new Team({ name: 'Team B' }).save();
      fs.writeFileSync(
        path.join(tmpDir, 'shared.json'),
        JSON.stringify({
          name: 'Shared Dashboard',
          tiles: [makeTile()],
          tags: [],
        }),
      );

      await syncDashboards(teamA._id.toString(), tmpDir);
      await syncDashboards(teamB._id.toString(), tmpDir);

      expect(await Dashboard.countDocuments({ team: teamA._id })).toBe(1);
      expect(await Dashboard.countDocuments({ team: teamB._id })).toBe(1);
    });

    it('does not delete dashboard when file is removed', async () => {
      const team = await createTeam({ name: 'My Team' });
      const filePath = path.join(tmpDir, 'removable.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          name: 'Removable Dashboard',
          tiles: [makeTile()],
          tags: [],
        }),
      );

      await syncDashboards(team._id.toString(), tmpDir);
      expect(await Dashboard.countDocuments({ team: team._id })).toBe(1);

      // Remove the file and sync again
      fs.unlinkSync(filePath);
      await syncDashboards(team._id.toString(), tmpDir);

      // Dashboard should still exist
      expect(await Dashboard.countDocuments({ team: team._id })).toBe(1);
    });

    it('does not overwrite user-created dashboards', async () => {
      const team = await createTeam({ name: 'My Team' });
      const userTile = makeTile();
      await new Dashboard({
        name: 'My Dashboard',
        tiles: [userTile],
        tags: ['user-tag'],
        team: team._id,
      }).save();

      fs.writeFileSync(
        path.join(tmpDir, 'my-dashboard.json'),
        JSON.stringify({
          name: 'My Dashboard',
          tiles: [makeTile()],
          tags: ['provisioned-tag'],
        }),
      );

      await syncDashboards(team._id.toString(), tmpDir);

      const userDashboard = (await Dashboard.findOne({
        name: 'My Dashboard',
        team: team._id,
        provisioned: { $ne: true },
      })) as any;
      expect(userDashboard).toBeTruthy();
      expect(userDashboard.tiles[0].id).toBe(userTile.id);
      expect(userDashboard.tags).toEqual(['user-tag']);

      const provisionedDashboard = await Dashboard.findOne({
        name: 'My Dashboard',
        team: team._id,
        provisioned: true,
      });
      expect(provisionedDashboard).toBeTruthy();
    });
  });

  describe('syncDashboards tile alerts', () => {
    type TileAlert = NonNullable<BuilderSavedChartConfig['alert']>;

    const tileAlert = (webhookId: string, threshold = 10): TileAlert => ({
      interval: '5m',
      threshold,
      thresholdType: AlertThresholdType.ABOVE,
      channel: { type: 'webhook', webhookId },
    });

    const writeFile = (file: string, name: string, tiles: unknown[]) =>
      fs.writeFileSync(
        path.join(tmpDir, file),
        JSON.stringify({ name, tiles, tags: [] }),
      );

    const writeDashboard = (tiles: unknown[]) =>
      writeFile('alerting.json', 'Alerting', tiles);

    const setup = async (makeTeam = () => createTeam({ name: 'My Team' })) => {
      const team = await makeTeam();
      const webhook = await new Webhook({
        team: team._id,
        service: 'generic',
        url: 'https://example.com/hook',
        name: 'Hook',
      }).save();
      const source = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        from: { databaseName: 'default', tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
        connection: new mongoose.Types.ObjectId(),
        name: 'Logs',
      });
      const sourceId = source._id.toString();
      // A tile on this team's source; `alert` is raw JSON, as a file holds it.
      const tile = (id: string, alert?: unknown, where?: string) => {
        const base = makeTile({ id, sourceId, where });
        return alert == null
          ? base
          : { ...base, config: { ...base.config, alert } };
      };
      return { team, webhookId: webhook._id.toString(), sourceId, tile };
    };

    const provisionedDashboard = (teamId: unknown) =>
      Dashboard.findOne({ name: 'Alerting', team: teamId, provisioned: true });

    const appAlert = (teamId: unknown, dashboardId: unknown, tileId: string) =>
      new Alert({
        team: teamId,
        source: AlertSource.TILE,
        dashboard: dashboardId,
        tileId,
        interval: '5m',
        threshold: 1,
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookId: new mongoose.Types.ObjectId() },
        createdBy: new mongoose.Types.ObjectId(),
      }).save();

    it('creates a provisioned alert for a tile that declares one', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([
        tile('with-alert', tileAlert(webhookId)),
        tile('without-alert'),
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      const dashboard = await provisionedDashboard(team._id);
      const alerts = await Alert.find({ team: team._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].source).toBe(AlertSource.TILE);
      expect(alerts[0].dashboard?.toString()).toBe(dashboard?._id.toString());
      expect(alerts[0].tileId).toBe('with-alert');
      expect(alerts[0].threshold).toBe(10);
      expect(alerts[0].channel).toEqual({ type: 'webhook', webhookId });
      expect(alerts[0].provisioned).toBe(true);
    });

    it('updates the alert in place on later syncs', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([tile('tile', tileAlert(webhookId))]);
      await syncDashboards(team._id.toString(), tmpDir);
      const [created] = await Alert.find({ team: team._id });

      writeDashboard([tile('tile', tileAlert(webhookId, 50))]);
      await syncDashboards(team._id.toString(), tmpDir);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]._id.toString()).toBe(created._id.toString());
      expect(alerts[0].threshold).toBe(50);
    });

    it('removes a provisioned alert once its tile no longer declares one', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([
        tile('kept', tileAlert(webhookId)),
        tile('dropped', tileAlert(webhookId)),
        tile('removed', tileAlert(webhookId)),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);
      expect(await Alert.countDocuments({ team: team._id })).toBe(3);

      writeDashboard([tile('kept', tileAlert(webhookId)), tile('dropped')]);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts.map(a => a.tileId)).toEqual(['kept']);
    });

    it('skips an alert whose webhook does not exist', async () => {
      const { team, tile } = await setup();
      writeDashboard([
        tile('tile', tileAlert(new mongoose.Types.ObjectId().toString())),
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      const dashboard = await provisionedDashboard(team._id);
      expect(dashboard?.tiles[0].config.alert).toBeUndefined();
      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it('skips an alert on a display type the alert task cannot evaluate', async () => {
      const { team, webhookId, tile } = await setup();
      const table = tile('tile', tileAlert(webhookId));
      writeDashboard([
        { ...table, config: { ...table.config, displayType: 'table' } },
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it('skips an alert on a raw SQL tile whose display type does not support alerts', async () => {
      const { team, webhookId, tile } = await setup();
      const { config: _config, ...base } = tile('tile');
      writeDashboard([
        {
          ...base,
          config: {
            configType: 'sql',
            name: 'Raw',
            displayType: 'table',
            connection: new mongoose.Types.ObjectId().toString(),
            sqlTemplate: 'SELECT 1',
            alert: tileAlert(webhookId),
          },
        },
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await provisionedDashboard(team._id)).toBeTruthy();
      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it("skips an alert whose tile's source is not in the team", async () => {
      const { team, webhookId } = await setup();
      writeDashboard([
        makeTile({
          id: 'tile',
          sourceId: new mongoose.Types.ObjectId().toString(),
          alert: tileAlert(webhookId),
        }),
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it('applies the alerts API threshold rules', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([
        tile('tile', {
          ...tileAlert(webhookId),
          thresholdType: AlertThresholdType.BETWEEN,
        }),
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it('keeps the last synced tile, query and alert together, when a declared alert becomes invalid', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([
        tile('tile', tileAlert(webhookId), 'level:error'),
        tile('other'),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);

      writeDashboard([
        tile(
          'tile',
          tileAlert(new mongoose.Types.ObjectId().toString(), 99),
          'level:warn',
        ),
        tile('other', undefined, 'updated'),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].threshold).toBe(10);
      expect(alerts[0].channel).toEqual({ type: 'webhook', webhookId });
      const dashboard = await provisionedDashboard(team._id);
      const [kept, other] = dashboard?.tiles ?? [];
      expect(kept.config).toMatchObject({ where: 'level:error' });
      expect(other.config).toMatchObject({ where: 'updated' });
    });

    it('skips alerts on tiles whose id is not unique', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([
        tile('tile', tileAlert(webhookId)),
        tile('tile', tileAlert(webhookId, 20)),
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it('leaves alerts created in the app alone', async () => {
      const { team, tile } = await setup();
      writeDashboard([tile('tile')]);
      await syncDashboards(team._id.toString(), tmpDir);
      const dashboard = await provisionedDashboard(team._id);
      await appAlert(team._id, dashboard?._id, 'tile');

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await Alert.countDocuments({ team: team._id })).toBe(1);
    });

    it('does not take over an app-created alert on a tile the file declares one on', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([tile('tile')]);
      await syncDashboards(team._id.toString(), tmpDir);
      const dashboard = await provisionedDashboard(team._id);
      const userAlert = await appAlert(team._id, dashboard?._id, 'tile');

      writeDashboard([tile('tile', tileAlert(webhookId, 50))]);
      await syncDashboards(team._id.toString(), tmpDir);
      writeDashboard([tile('tile')]);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]._id.toString()).toBe(userAlert._id.toString());
      expect(alerts[0].threshold).toBe(1);
      expect(alerts[0].provisioned).toBe(false);
    });

    it('allows only one provisioned alert per tile', async () => {
      const { team, webhookId, tile } = await setup();
      writeDashboard([tile('tile', tileAlert(webhookId))]);
      await syncDashboards(team._id.toString(), tmpDir);
      await Alert.init();
      const [alert] = await Alert.find({ team: team._id }).lean();
      const { _id, ...duplicate } = alert;

      await expect(Alert.create(duplicate)).rejects.toThrow(/duplicate key/);
    });

    describe('webhooks by name', () => {
      const namedAlert = (webhookName: string, threshold = 10) => ({
        interval: '5m',
        threshold,
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookName },
      });

      it('resolves a webhook name to the team webhook', async () => {
        const { team, webhookId, tile } = await setup();
        writeDashboard([tile('tile', namedAlert('Hook'))]);

        await syncDashboards(team._id.toString(), tmpDir);

        const alerts = await Alert.find({ team: team._id });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].channel).toEqual({ type: 'webhook', webhookId });
        expect(alerts[0].channels).toEqual([{ type: 'webhook', webhookId }]);
        const dashboard = await provisionedDashboard(team._id);
        expect(dashboard?.tiles[0].config.alert?.channel).toEqual({
          type: 'webhook',
          webhookId,
        });
      });

      it('resolves names in `channels` too', async () => {
        const { team, webhookId, tile } = await setup();
        const other = await new Webhook({
          team: team._id,
          service: 'generic',
          url: 'https://example.com/other',
          name: 'Other',
        }).save();
        const { channel: _channel, ...alert } = namedAlert('Hook');
        writeDashboard([
          tile('tile', {
            ...alert,
            channels: [
              { type: 'webhook', webhookName: 'Hook' },
              { type: 'webhook', webhookName: 'Other' },
            ],
          }),
        ]);

        await syncDashboards(team._id.toString(), tmpDir);

        const [created] = await Alert.find({ team: team._id });
        expect(created.channels).toEqual([
          { type: 'webhook', webhookId },
          { type: 'webhook', webhookId: other._id.toString() },
        ]);
      });

      it('only creates the alert in the team that owns the tile source', async () => {
        const a = await setup();
        const b = await setup(() => new Team({ name: 'Team B' }).save());
        writeDashboard([a.tile('tile', namedAlert('Hook'))]);

        await syncDashboards(a.team._id.toString(), tmpDir);
        await syncDashboards(b.team._id.toString(), tmpDir);

        const [alertA] = await Alert.find({ team: a.team._id });
        expect(alertA.channel).toEqual({
          type: 'webhook',
          webhookId: a.webhookId,
        });
        expect(await Alert.countDocuments({ team: b.team._id })).toBe(0);
        expect(await provisionedDashboard(b.team._id)).toBeTruthy();
      });

      it('keeps the last valid version when the name matches no webhook', async () => {
        const { team, webhookId, tile } = await setup();
        writeDashboard([tile('tile', namedAlert('Hook'))]);
        await syncDashboards(team._id.toString(), tmpDir);

        writeDashboard([tile('tile', namedAlert('Missing', 99))]);
        await syncDashboards(team._id.toString(), tmpDir);

        const alerts = await Alert.find({ team: team._id });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].threshold).toBe(10);
        expect(alerts[0].channel).toEqual({ type: 'webhook', webhookId });
        const dashboard = await provisionedDashboard(team._id);
        expect(dashboard?.tiles[0].config.alert?.channel).toEqual({
          type: 'webhook',
          webhookId,
        });
      });

      it('skips a name that matches webhooks of several services', async () => {
        const { team, tile } = await setup();
        await new Webhook({
          team: team._id,
          service: 'slack',
          url: 'https://hooks.slack.com/services/x',
          name: 'Hook',
        }).save();
        writeDashboard([tile('tile', namedAlert('Hook'))]);

        await syncDashboards(team._id.toString(), tmpDir);

        expect(await Alert.countDocuments({ team: team._id })).toBe(0);
      });

      it('does not read webhooks when no file names one', async () => {
        const { team, webhookId, tile } = await setup();
        const find = jest.spyOn(Webhook, 'find');
        writeDashboard([tile('tile', tileAlert(webhookId))]);

        await syncDashboards(team._id.toString(), tmpDir);

        expect(find).not.toHaveBeenCalled();
        find.mockRestore();
      });
    });

    describe('orphaned alerts', () => {
      const setupTwoDashboards = async () => {
        const { team, webhookId, tile } = await setup();
        writeFile('a.json', 'A', [tile('tile', tileAlert(webhookId))]);
        writeFile('b.json', 'B', [tile('tile', tileAlert(webhookId))]);
        await syncDashboards(team._id.toString(), tmpDir);
        expect(await Alert.countDocuments({ team: team._id })).toBe(2);
        return { team, webhookId, tile };
      };

      const alertDashboardNames = async (teamId: unknown) => {
        const alerts = await Alert.find({ team: teamId }).populate<{
          dashboard: { name: string };
        }>('dashboard', 'name');
        return alerts.map(a => a.dashboard.name).sort();
      };

      it('deletes the alerts of a dashboard whose file was removed, and keeps the dashboard', async () => {
        const { team } = await setupTwoDashboards();

        fs.rmSync(path.join(tmpDir, 'b.json'));
        await syncDashboards(team._id.toString(), tmpDir);

        expect(await alertDashboardNames(team._id)).toEqual(['A']);
        expect(
          await Dashboard.countDocuments({ team: team._id, provisioned: true }),
        ).toBe(2);
      });

      it('moves the alerts along when a dashboard is renamed', async () => {
        const { team, webhookId, tile } = await setupTwoDashboards();

        writeFile('b.json', 'B renamed', [tile('tile', tileAlert(webhookId))]);
        await syncDashboards(team._id.toString(), tmpDir);

        expect(await alertDashboardNames(team._id)).toEqual(['A', 'B renamed']);
      });

      it('keeps the old alerts when the renamed dashboard fails to sync', async () => {
        const { team, webhookId, tile } = await setupTwoDashboards();
        const upsert = Dashboard.findOneAndUpdate.bind(Dashboard);
        const spy = jest
          .spyOn(Dashboard, 'findOneAndUpdate')
          .mockImplementation((filter, ...rest) => {
            if (filter?.name === 'B renamed') {
              throw new Error('write failed');
            }
            return upsert(filter, ...rest);
          });

        writeFile('b.json', 'B renamed', [tile('tile', tileAlert(webhookId))]);
        await syncDashboards(team._id.toString(), tmpDir);
        spy.mockRestore();

        expect(await alertDashboardNames(team._id)).toEqual(['A', 'B']);
      });

      it('keeps all alerts while any file is invalid', async () => {
        const { team } = await setupTwoDashboards();

        fs.writeFileSync(path.join(tmpDir, 'b.json'), '{ not json');
        await syncDashboards(team._id.toString(), tmpDir);

        expect(await alertDashboardNames(team._id)).toEqual(['A', 'B']);
      });

      it('keeps all alerts when the directory is empty', async () => {
        const { team } = await setupTwoDashboards();

        fs.rmSync(path.join(tmpDir, 'a.json'));
        fs.rmSync(path.join(tmpDir, 'b.json'));
        await syncDashboards(team._id.toString(), tmpDir);

        expect(await alertDashboardNames(team._id)).toEqual(['A', 'B']);
      });

      it('syncs only the first of two files with the same name, and keeps all alerts', async () => {
        const { team, webhookId, tile } = await setupTwoDashboards();
        const [created] = await Alert.find({ team: team._id, tileId: 'tile' })
          .populate<{ dashboard: { name: string } }>('dashboard', 'name')
          .then(alerts => alerts.filter(a => a.dashboard.name === 'A'));

        writeFile('c.json', 'A', [tile('tile', tileAlert(webhookId, 99))]);
        await syncDashboards(team._id.toString(), tmpDir);
        await syncDashboards(team._id.toString(), tmpDir);

        expect(await alertDashboardNames(team._id)).toEqual(['A', 'B']);
        const same = await Alert.findById(created._id);
        expect(same?.threshold).toBe(10);
      });

      it('leaves app-created alerts on an orphaned dashboard alone', async () => {
        const { team } = await setupTwoDashboards();
        const b = await Dashboard.findOne({ team: team._id, name: 'B' });
        await appAlert(team._id, b?._id, 'other');

        fs.rmSync(path.join(tmpDir, 'b.json'));
        await syncDashboards(team._id.toString(), tmpDir);

        const remaining = await Alert.find({
          team: team._id,
          dashboard: b?._id,
        });
        expect(remaining.map(a => a.tileId)).toEqual(['other']);
      });
    });

    it('creates alerts only in the team owning the webhook when provisioning all teams', async () => {
      const a = await setup();
      const b = await setup(() => new Team({ name: 'Team B' }).save());
      writeDashboard([a.tile('tile', tileAlert(a.webhookId))]);
      const env = process.env;
      process.env = {
        ...env,
        DASHBOARD_PROVISIONER_DIR: tmpDir,
        DASHBOARD_PROVISIONER_ALL_TEAMS: 'true',
        DASHBOARD_PROVISIONER_TEAM_ID: '',
      };

      try {
        await new ProvisionDashboardsTask({
          taskName: TaskName.PROVISION_DASHBOARDS,
        }).execute();
      } finally {
        process.env = env;
      }

      expect(await Alert.countDocuments({ team: a.team._id })).toBe(1);
      expect(await Alert.countDocuments({ team: b.team._id })).toBe(0);
      expect(await provisionedDashboard(b.team._id)).toBeTruthy();
    });
  });

  describe('ProvisionDashboardsTask', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('throws when DASHBOARD_PROVISIONER_DIR is not set', async () => {
      delete process.env.DASHBOARD_PROVISIONER_DIR;
      const task = new ProvisionDashboardsTask({
        taskName: TaskName.PROVISION_DASHBOARDS,
      });
      await expect(task.execute()).rejects.toThrow(
        'DASHBOARD_PROVISIONER_DIR environment variable is required',
      );
    });

    it('throws when neither team ID nor all-teams flag is set', async () => {
      process.env.DASHBOARD_PROVISIONER_DIR = tmpDir;
      delete process.env.DASHBOARD_PROVISIONER_TEAM_ID;
      delete process.env.DASHBOARD_PROVISIONER_ALL_TEAMS;
      const task = new ProvisionDashboardsTask({
        taskName: TaskName.PROVISION_DASHBOARDS,
      });
      await expect(task.execute()).rejects.toThrow(
        'DASHBOARD_PROVISIONER_TEAM_ID is required',
      );
    });

    it('throws when team ID is invalid', async () => {
      process.env.DASHBOARD_PROVISIONER_DIR = tmpDir;
      process.env.DASHBOARD_PROVISIONER_TEAM_ID = 'not-valid';
      const task = new ProvisionDashboardsTask({
        taskName: TaskName.PROVISION_DASHBOARDS,
      });
      await expect(task.execute()).rejects.toThrow('not a valid ObjectId');
    });

    it('skips provisioning when team ID is valid but does not exist', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toHexString();
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify({
          name: 'Ghost Team Dash',
          tiles: [makeTile()],
          tags: [],
        }),
      );
      process.env.DASHBOARD_PROVISIONER_DIR = tmpDir;
      process.env.DASHBOARD_PROVISIONER_TEAM_ID = nonExistentId;

      const task = new ProvisionDashboardsTask({
        taskName: TaskName.PROVISION_DASHBOARDS,
      });
      await task.execute();

      expect(await Dashboard.countDocuments({})).toBe(0);
    });

    it('provisions dashboards for all teams', async () => {
      const team = await createTeam({ name: 'My Team' });
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify({
          name: 'All Teams Dash',
          tiles: [makeTile()],
          tags: [],
        }),
      );
      process.env.DASHBOARD_PROVISIONER_DIR = tmpDir;
      process.env.DASHBOARD_PROVISIONER_ALL_TEAMS = 'true';

      const task = new ProvisionDashboardsTask({
        taskName: TaskName.PROVISION_DASHBOARDS,
      });
      await task.execute();

      expect(await Dashboard.countDocuments({ team: team._id })).toBe(1);
    });

    it('provisions dashboards for a specific team', async () => {
      const team = await createTeam({ name: 'My Team' });
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify({
          name: 'Team Specific Dash',
          tiles: [makeTile()],
          tags: [],
        }),
      );
      process.env.DASHBOARD_PROVISIONER_DIR = tmpDir;
      process.env.DASHBOARD_PROVISIONER_TEAM_ID = team._id.toString();

      const task = new ProvisionDashboardsTask({
        taskName: TaskName.PROVISION_DASHBOARDS,
      });
      await task.execute();

      expect(await Dashboard.countDocuments({ team: team._id })).toBe(1);
    });
  });
});
