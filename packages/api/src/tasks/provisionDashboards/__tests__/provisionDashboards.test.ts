import fs from 'fs';
import mongoose from 'mongoose';
import os from 'os';
import path from 'path';

import { createTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB, makeTile } from '@/fixtures';
import Dashboard from '@/models/dashboard';
import Team from '@/models/team';
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
