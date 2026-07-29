import { ConnectionSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';

import {
  createConnection,
  deleteConnection,
  getConnectionById,
  getConnectionsByTeam,
  updateConnection,
} from '@/controllers/connection';
import { ConnectionDocument } from '@/models/connection';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

// External representation of a connection. The password is intentionally
// excluded so that it is never returned by the API.
const externalConnectionSchema = ConnectionSchema.omit({
  password: true,
}).extend({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const createConnectionBodySchema = ConnectionSchema.omit({ id: true });

// On update, hyperdxSettingPrefix additionally accepts '' meaning "clear the
// existing value". The base ConnectionSchema rejects '' because the prefix
// regex requires 1+ chars.
const updateConnectionBodySchema = ConnectionSchema.omit({ id: true }).extend({
  hyperdxSettingPrefix: z
    .string()
    .regex(/^[a-z0-9_]+$/i)
    .or(z.literal(''))
    .optional()
    .nullable(),
});

function formatExternalConnection(connection: ConnectionDocument) {
  // Convert to JSON so that any ObjectIds and Dates are converted to strings
  const json = JSON.stringify(connection.toJSON({ virtuals: true }));

  // Parse using the externalConnectionSchema to strip out any fields not
  // defined in the schema (e.g. password, team, _id, __v)
  const parseResult = externalConnectionSchema.safeParse(JSON.parse(json));
  if (parseResult.success) {
    return parseResult.data;
  }

  // If parsing fails, log and throw so handlers return an explicit 500
  // instead of silently responding with `{}` or a partial list.
  logger.error(
    { connectionId: connection._id, error: parseResult.error },
    'Failed to parse connection using externalConnectionSchema:',
  );

  throw new Error(
    `Failed to serialize connection ${connection._id} for external API`,
  );
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Connection:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - host
 *         - username
 *       properties:
 *         id:
 *           type: string
 *           description: Unique connection ID.
 *           example: 507f1f77bcf86cd799439012
 *         name:
 *           type: string
 *           description: Display name for the connection.
 *           example: Production ClickHouse
 *         host:
 *           type: string
 *           description: ClickHouse HTTP endpoint URL.
 *           example: https://clickhouse.example.com:8443
 *         username:
 *           type: string
 *           description: ClickHouse username.
 *           example: default
 *         hyperdxSettingPrefix:
 *           type: string
 *           description: Optional prefix for HyperDX-specific ClickHouse settings. Must only contain alphanumeric characters and underscores.
 *           nullable: true
 *           example: hyperdx_
 *         isPrometheusEndpoint:
 *           type: boolean
 *           description: Optional. When true, `host` is treated as a Prometheus-compatible API endpoint (e.g. Prometheus or Thanos) and PromQL queries are proxied to it. When false or omitted, `host` is a ClickHouse HTTP endpoint.
 *           example: false
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *           example: "2025-01-01T00:00:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2025-06-15T10:30:00.000Z"
 *     CreateConnectionRequest:
 *       type: object
 *       required:
 *         - name
 *         - host
 *         - username
 *       properties:
 *         name:
 *           type: string
 *           description: Display name for the connection.
 *           example: Production ClickHouse
 *         host:
 *           type: string
 *           description: ClickHouse HTTP endpoint URL.
 *           example: https://clickhouse.example.com:8443
 *         username:
 *           type: string
 *           description: ClickHouse username.
 *           example: default
 *         password:
 *           type: string
 *           writeOnly: true
 *           description: ClickHouse password. Never returned by the API.
 *           example: my-secret-password
 *         hyperdxSettingPrefix:
 *           type: string
 *           description: Optional prefix for HyperDX-specific ClickHouse settings. Must only contain alphanumeric characters and underscores.
 *           nullable: true
 *           example: hyperdx_
 *         isPrometheusEndpoint:
 *           type: boolean
 *           description: Optional. When true, `host` is treated as a Prometheus-compatible API endpoint (e.g. Prometheus or Thanos) and PromQL queries are proxied to it. When false or omitted, `host` is a ClickHouse HTTP endpoint.
 *           example: false
 *     UpdateConnectionRequest:
 *       type: object
 *       required:
 *         - name
 *         - host
 *         - username
 *       properties:
 *         name:
 *           type: string
 *           description: Display name for the connection.
 *           example: Production ClickHouse
 *         host:
 *           type: string
 *           description: ClickHouse HTTP endpoint URL.
 *           example: https://clickhouse.example.com:8443
 *         username:
 *           type: string
 *           description: ClickHouse username.
 *           example: default
 *         password:
 *           type: string
 *           writeOnly: true
 *           description: ClickHouse password. If omitted or empty, the existing password is kept.
 *           example: my-new-secret-password
 *         hyperdxSettingPrefix:
 *           type: string
 *           description: Optional prefix for HyperDX-specific ClickHouse settings. Set to null or an empty string to clear the existing value. If omitted, the existing value is kept.
 *           nullable: true
 *           example: hyperdx_
 *         isPrometheusEndpoint:
 *           type: boolean
 *           description: Optional. When true, `host` is treated as a Prometheus-compatible API endpoint. When false or omitted, `host` is a ClickHouse HTTP endpoint. Omit to keep the existing value unchanged.
 *           example: false
 *     ConnectionResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/Connection'
 *           description: The connection object.
 *     ConnectionsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           description: List of connection objects.
 *           items:
 *             $ref: '#/components/schemas/Connection'
 *         meta:
 *           type: object
 *           description: Present only when one or more stored connections could not be serialized and were omitted from `data`.
 *           properties:
 *             skipped:
 *               type: integer
 *               description: Number of connections omitted from the response because they failed serialization.
 *               example: 1
 *             skippedIds:
 *               type: array
 *               description: IDs of the connections that were omitted.
 *               items:
 *                 type: string
 *               example: ["507f1f77bcf86cd799439012"]
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/connections:
 *   get:
 *     summary: List Connections
 *     description: Retrieves a list of all ClickHouse connections for the authenticated team. Passwords are never returned.
 *     operationId: listConnections
 *     tags: [Connections]
 *     responses:
 *       '200':
 *         description: Successfully retrieved connections
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConnectionsListResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const connections = await getConnectionsByTeam(teamId.toString());

    // Format each connection individually so that a single record which fails
    // to serialize (e.g. a legacy document that doesn't satisfy the current
    // schema) is skipped rather than failing the entire list response for
    // every caller in the team. Skipped records are surfaced both in the logs
    // and to the client (see `meta.skipped`) so the failure is never silent.
    const data: ReturnType<typeof formatExternalConnection>[] = [];
    const skippedIds: string[] = [];
    for (const connection of connections) {
      try {
        data.push(formatExternalConnection(connection));
      } catch {
        // formatExternalConnection already logs the per-record Zod error.
        skippedIds.push(connection._id.toString());
      }
    }

    if (skippedIds.length > 0) {
      logger.warn(
        { teamId: teamId.toString(), skippedIds },
        `Skipped ${skippedIds.length} connection(s) that could not be serialized for external API`,
      );
    }

    res.json({
      data,
      ...(skippedIds.length > 0 && {
        meta: { skipped: skippedIds.length, skippedIds },
      }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/connections/{id}:
 *   get:
 *     summary: Get Connection
 *     description: Retrieves a specific ClickHouse connection by ID. Passwords are never returned.
 *     operationId: getConnection
 *     tags: [Connections]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Connection ID
 *         example: "507f1f77bcf86cd799439012"
 *     responses:
 *       '200':
 *         description: Successfully retrieved connection
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConnectionResponseEnvelope'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Connection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Connection not found"
 */
router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const connection = await getConnectionById(
        teamId.toString(),
        req.params.id,
      );

      if (connection == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: formatExternalConnection(connection),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/connections:
 *   post:
 *     summary: Create Connection
 *     description: Creates a new ClickHouse connection
 *     operationId: createConnection
 *     tags: [Connections]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateConnectionRequest'
 *     responses:
 *       '200':
 *         description: Successfully created connection
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConnectionResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Body validation failed: name: Required"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 */
router.post(
  '/',
  validateRequest({
    body: createConnectionBodySchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const connection = await createConnection(teamId.toString(), {
        ...req.body,
        password: req.body.password ?? '',
        team: teamId,
        hyperdxSettingPrefix: req.body.hyperdxSettingPrefix ?? undefined,
      });

      res.json({
        data: formatExternalConnection(connection),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/connections/{id}:
 *   put:
 *     summary: Update Connection
 *     description: |
 *       Updates an existing ClickHouse connection.
 *
 *       Field semantics: if `password` is omitted or empty the existing
 *       password is kept. `hyperdxSettingPrefix` is cleared when set to null
 *       or an empty string, and `prometheusEndpoint` is cleared when set to
 *       null; both are kept unchanged when omitted.
 *     operationId: updateConnection
 *     tags: [Connections]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Connection ID
 *         example: "507f1f77bcf86cd799439012"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateConnectionRequest'
 *     responses:
 *       '200':
 *         description: Successfully updated connection
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConnectionResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Body validation failed: host: Required"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Connection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Connection not found"
 */
router.put(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: updateConnectionBodySchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const existingConnection = await getConnectionById(
        teamId.toString(),
        req.params.id,
        true,
      );

      if (existingConnection == null) {
        return res.sendStatus(404);
      }

      const { hyperdxSettingPrefix, ...restBody } = req.body;

      const unsetFields: string[] = [];
      if (hyperdxSettingPrefix === null || hyperdxSettingPrefix === '') {
        unsetFields.push('hyperdxSettingPrefix');
      }

      const updatedConnection = await updateConnection(
        teamId.toString(),
        req.params.id,
        {
          ...restBody,
          team: teamId,
          // Keep the existing password when none is provided
          password: req.body.password
            ? req.body.password
            : existingConnection.password,
          ...(hyperdxSettingPrefix ? { hyperdxSettingPrefix } : {}),
        },
        unsetFields,
      );

      if (updatedConnection == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: formatExternalConnection(updatedConnection),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/connections/{id}:
 *   delete:
 *     summary: Delete Connection
 *     description: Deletes a ClickHouse connection
 *     operationId: deleteConnection
 *     tags: [Connections]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Connection ID
 *         example: "507f1f77bcf86cd799439012"
 *     responses:
 *       '200':
 *         description: Successfully deleted connection
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmptyResponse'
 *             example: {}
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Connection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Connection not found"
 */
router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const deletedConnection = await deleteConnection(
        teamId.toString(),
        req.params.id,
      );

      if (deletedConnection == null) {
        return res.sendStatus(404);
      }

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
