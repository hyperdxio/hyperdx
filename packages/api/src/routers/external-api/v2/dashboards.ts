import express from 'express';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import { deleteDashboard } from '@/controllers/dashboard';
import { getSources } from '@/controllers/sources';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { validateRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import logger from '@/utils/logger';
import { ExternalDashboardTileWithId, objectIdSchema } from '@/utils/zod';

import {
  cleanupDashboardAlerts,
  collectTileContainerRefIssues,
  convertExternalFiltersToInternal,
  convertExternalTilesToInternal,
  convertToExternalDashboard,
  createDashboardBodySchema,
  getMissingConnections,
  getMissingSources,
  isConfigTile,
  isRawSqlExternalTileConfig,
  isSeriesTile,
  resolveSavedQueryLanguage,
  updateDashboardBodySchema,
} from './utils/dashboards';
