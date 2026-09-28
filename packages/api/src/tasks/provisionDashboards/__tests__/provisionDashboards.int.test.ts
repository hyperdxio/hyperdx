/* eslint-disable security/detect-non-literal-fs-filename */
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import fs from 'fs';
import mongoose from 'mongoose';
import os from 'os';
import path from 'path';

import { createTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB, makeTile } from '@/fixtures';
import Alert, { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';
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
    const tileAlert = (webhookId: string, threshold = 10) =>
      ({
        interval: '5m',
        threshold,
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookId },
      }) as any;

    const writeDashboard = (tiles: ReturnType<typeof makeTile>[]) =>
      fs.writeFileSync(
        path.join(tmpDir, 'alerting.json'),
        JSON.stringify({ name: 'Alerting', tiles, tags: [] }),
      );

    const setup = async (makeTeam = () => createTeam({ name: 'My Team' })) => {
      const team = await makeTeam();
      const webhook = await new Webhook({
        team: team._id,
        service: 'generic',
        url: 'https://example.com/hook',
        name: 'Hook',
      }).save();
      return { team, webhookId: webhook._id.toString() };
    };

    const provisionedDashboard = (teamId: unknown) =>
      Dashboard.findOne({ name: 'Alerting', team: teamId, provisioned: true });

    it('creates a provisioned alert for a tile that declares one', async () => {
      const { team, webhookId } = await setup();
      writeDashboard([
        makeTile({ id: 'with-alert', alert: tileAlert(webhookId) }),
        makeTile({ id: 'without-alert' }),
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
      const { team, webhookId } = await setup();
      writeDashboard([makeTile({ id: 'tile', alert: tileAlert(webhookId) })]);
      await syncDashboards(team._id.toString(), tmpDir);
      const [created] = await Alert.find({ team: team._id });

      writeDashboard([
        makeTile({ id: 'tile', alert: tileAlert(webhookId, 50) }),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]._id.toString()).toBe(created._id.toString());
      expect(alerts[0].threshold).toBe(50);
    });

    it('removes a provisioned alert once its tile no longer declares one', async () => {
      const { team, webhookId } = await setup();
      writeDashboard([
        makeTile({ id: 'kept', alert: tileAlert(webhookId) }),
        makeTile({ id: 'dropped', alert: tileAlert(webhookId) }),
        makeTile({ id: 'removed', alert: tileAlert(webhookId) }),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);
      expect(await Alert.countDocuments({ team: team._id })).toBe(3);

      writeDashboard([
        makeTile({ id: 'kept', alert: tileAlert(webhookId) }),
        makeTile({ id: 'dropped' }),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts.map(a => a.tileId)).toEqual(['kept']);
    });

    it('skips an alert whose webhook does not exist', async () => {
      const { team } = await setup();
      writeDashboard([
        makeTile({
          id: 'tile',
          alert: tileAlert(new mongoose.Types.ObjectId().toString()),
        }),
      ]);

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await provisionedDashboard(team._id)).toBeTruthy();
      expect(await Alert.countDocuments({ team: team._id })).toBe(0);
    });

    it('keeps the last valid version when a declared alert becomes invalid', async () => {
      const { team, webhookId } = await setup();
      writeDashboard([makeTile({ id: 'tile', alert: tileAlert(webhookId) })]);
      await syncDashboards(team._id.toString(), tmpDir);

      writeDashboard([
        makeTile({
          id: 'tile',
          alert: tileAlert(new mongoose.Types.ObjectId().toString(), 99),
        }),
      ]);
      await syncDashboards(team._id.toString(), tmpDir);

      const alerts = await Alert.find({ team: team._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].threshold).toBe(10);
      expect(alerts[0].channel).toEqual({ type: 'webhook', webhookId });
    });

    it('leaves alerts created in the app alone', async () => {
      const { team, webhookId } = await setup();
      writeDashboard([makeTile({ id: 'tile' })]);
      await syncDashboards(team._id.toString(), tmpDir);
      const dashboard = await provisionedDashboard(team._id);
      await new Alert({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard?._id,
        tileId: 'tile',
        interval: '5m',
        threshold: 1,
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookId },
        createdBy: new mongoose.Types.ObjectId(),
      }).save();

      await syncDashboards(team._id.toString(), tmpDir);

      expect(await Alert.countDocuments({ team: team._id })).toBe(1);
    });

    describe('webhooks by name', () => {
      const namedAlert = (webhookName: string, threshold = 10) =>
        ({
          interval: '5m',
          threshold,
          thresholdType: AlertThresholdType.ABOVE,
          channel: { type: 'webhook', webhookName },
        }) as any;

      it('resolves a webhook name to the team webhook', async () => {
        const { team, webhookId } = await setup();
        writeDashboard([makeTile({ id: 'tile', alert: namedAlert('Hook') })]);

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
        const { team, webhookId } = await setup();
        const other = await new Webhook({
          team: team._id,
          service: 'generic',
          url: 'https://example.com/other',
          name: 'Other',
        }).save();
        writeDashboard([
          makeTile({
            id: 'tile',
            alert: {
              ...namedAlert('Hook'),
              channel: undefined,
              channels: [
                { type: 'webhook', webhookName: 'Hook' },
                { type: 'webhook', webhookName: 'Other' },
              ],
            },
          }),
        ]);

        await syncDashboards(team._id.toString(), tmpDir);

        const [alert] = await Alert.find({ team: team._id });
        expect(alert.channels).toEqual([
          { type: 'webhook', webhookId },
          { type: 'webhook', webhookId: other._id.toString() },
        ]);
      });

      it('resolves the name separately for each team', async () => {
        const a = await setup();
        const b = await setup(() => new Team({ name: 'Team B' }).save());
        writeDashboard([makeTile({ id: 'tile', alert: namedAlert('Hook') })]);

        await syncDashboards(a.team._id.toString(), tmpDir);
        await syncDashboards(b.team._id.toString(), tmpDir);

        const [alertA] = await Alert.find({ team: a.team._id });
        const [alertB] = await Alert.find({ team: b.team._id });
        expect(alertA.channel).toEqual({
          type: 'webhook',
          webhookId: a.webhookId,
        });
        expect(alertB.channel).toEqual({
          type: 'webhook',
          webhookId: b.webhookId,
        });
      });

      it('keeps the last valid version when the name matches no webhook', async () => {
        const { team, webhookId } = await setup();
        writeDashboard([makeTile({ id: 'tile', alert: namedAlert('Hook') })]);
        await syncDashboards(team._id.toString(), tmpDir);

        writeDashboard([
          makeTile({ id: 'tile', alert: namedAlert('Missing', 99) }),
        ]);
        await syncDashboards(team._id.toString(), tmpDir);

        const alerts = await Alert.find({ team: team._id });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].threshold).toBe(10);
        expect(alerts[0].channel).toEqual({ type: 'webhook', webhookId });
        // The unresolved reference is not stored on the tile.
        const dashboard = await provisionedDashboard(team._id);
        expect(dashboard?.tiles[0].config.alert).toBeUndefined();
      });

      it('skips a name that matches webhooks of several services', async () => {
        const { team } = await setup();
        await new Webhook({
          team: team._id,
          service: 'slack',
          url: 'https://hooks.slack.com/services/x',
          name: 'Hook',
        }).save();
        writeDashboard([makeTile({ id: 'tile', alert: namedAlert('Hook') })]);

        await syncDashboards(team._id.toString(), tmpDir);

        expect(await Alert.countDocuments({ team: team._id })).toBe(0);
      });
    });

    describe('orphaned alerts', () => {
      const writeFile = (file: string, name: string, tiles: unknown[]) =>
        fs.writeFileSync(
          path.join(tmpDir, file),
          JSON.stringify({ name, tiles, tags: [] }),
        );

      const setupTwoDashboards = async () => {
        const { team, webhookId } = await setup();
        writeFile('a.json', 'A', [
          makeTile({ id: 'tile', alert: tileAlert(webhookId) }),
        ]);
        writeFile('b.json', 'B', [
          makeTile({ id: 'tile', alert: tileAlert(webhookId) }),
        ]);
        await syncDashboards(team._id.toString(), tmpDir);
        expect(await Alert.countDocuments({ team: team._id })).toBe(2);
        return { team, webhookId };
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
        const { team, webhookId } = await setupTwoDashboards();

        writeFile('b.json', 'B renamed', [
          makeTile({ id: 'tile', alert: tileAlert(webhookId) }),
        ]);
        await syncDashboards(team._id.toString(), tmpDir);

        expect(await alertDashboardNames(team._id)).toEqual(['A', 'B renamed']);
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

      it('leaves app-created alerts on an orphaned dashboard alone', async () => {
        const { team, webhookId } = await setupTwoDashboards();
        const b = await Dashboard.findOne({ team: team._id, name: 'B' });
        await new Alert({
          team: team._id,
          source: AlertSource.TILE,
          dashboard: b?._id,
          tileId: 'other',
          interval: '5m',
          threshold: 1,
          thresholdType: AlertThresholdType.ABOVE,
          channel: { type: 'webhook', webhookId },
          createdBy: new mongoose.Types.ObjectId(),
        }).save();

        fs.rmSync(path.join(tmpDir, 'b.json'));
        await syncDashboards(team._id.toString(), tmpDir);

        const remaining = await Alert.find({
          team: team._id,
          dashboard: b?._id,
        });
        expect(remaining.map(a => a.tileId)).toEqual(['other']);
      });
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
