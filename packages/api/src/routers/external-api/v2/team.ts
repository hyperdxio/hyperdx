import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import { getTeam } from '@/controllers/team';
import {
  deleteTeamMember,
  findUserByEmail,
  findUsersByTeam,
} from '@/controllers/user';
import TeamInvite from '@/models/teamInvite';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

/**
 * @openapi
 * /api/v2/team:
 *   get:
 *     summary: Get Team
 *     description: Retrieves the authenticated team's basic settings.
 *     operationId: getTeam
 *     tags: [Team]
 *     responses:
 *       '200':
 *         description: Successfully retrieved team
 *       '403':
 *         description: Forbidden
 */
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const team = await getTeam(teamId.toString());
    if (team == null) {
      return res.sendStatus(404);
    }

    return res.json({
      data: {
        id: team._id.toString(),
        name: team.name,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/team/members:
 *   get:
 *     summary: List Team Members
 *     description: Retrieves the team's members.
 *     operationId: listTeamMembers
 *     tags: [Team]
 *     responses:
 *       '200':
 *         description: Successfully retrieved members
 */
router.get('/members', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const userId = req.user?._id;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const teamUsers = await findUsersByTeam(teamId.toString());
    return res.json({
      data: teamUsers.map(user => ({
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        isCurrentUser: userId != null && user._id.equals(userId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/team/invitation:
 *   post:
 *     summary: Invite Team Member
 *     description: Creates a pending invitation for a new email address.
 *     operationId: inviteTeamMember
 *     tags: [Team]
 *     responses:
 *       '200':
 *         description: Successfully created the invitation
 *       '400':
 *         description: User already exists
 */
router.post(
  '/invitation',
  validateRequest({
    body: z.object({
      email: z.string().email(),
      name: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { email, name } = req.body;
      const normalizedEmail = email.toLowerCase();

      const existingUser = await findUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({
          message:
            'User already exists. Please contact HyperDX team for support',
        });
      }

      let teamInvite = await TeamInvite.findOne({
        teamId: teamId.toString(),
        email: normalizedEmail,
      });

      if (!teamInvite) {
        teamInvite = await new TeamInvite({
          teamId: teamId.toString(),
          name,
          email: normalizedEmail,
          token: crypto.randomBytes(32).toString('hex'),
        }).save();
      }

      return res.json({
        data: {
          email: normalizedEmail,
          invitationId: teamInvite._id.toString(),
          status: 'pending',
          url: `${config.FRONTEND_URL}/join-team?token=${teamInvite.token}`,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/team/invitations:
 *   get:
 *     summary: List Team Invitations
 *     description: Retrieves the team's pending invitations.
 *     operationId: listTeamInvitations
 *     tags: [Team]
 *     responses:
 *       '200':
 *         description: Successfully retrieved invitations
 */
router.get('/invitations', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const teamInvites = await TeamInvite.find(
      { teamId: teamId.toString() },
      { createdAt: 1, email: 1, name: 1 },
    );

    return res.json({
      data: teamInvites.map(ti => ({
        id: ti._id.toString(),
        createdAt: ti.createdAt,
        email: ti.email,
        name: ti.name,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/team/invitation/{id}:
 *   delete:
 *     summary: Delete Team Invitation
 *     description: Deletes a pending team invitation.
 *     operationId: deleteTeamInvitation
 *     tags: [Team]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successfully deleted the invitation
 *       '404':
 *         description: Invitation not found
 */
router.delete(
  '/invitation/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const teamInvite = await TeamInvite.findOneAndDelete({
        _id: req.params.id,
        teamId: teamId.toString(),
      });

      if (!teamInvite) {
        return res.sendStatus(404);
      }

      return res.json({ data: { success: true } });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/team/member/{id}:
 *   delete:
 *     summary: Remove Team Member
 *     description: Removes a member from the team.
 *     operationId: removeTeamMember
 *     tags: [Team]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successfully removed the member
 */
router.delete(
  '/member/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const requestingUserId = req.user?._id;
      if (teamId == null || requestingUserId == null) {
        return res.sendStatus(403);
      }

      await deleteTeamMember(
        teamId.toString(),
        req.params.id,
        requestingUserId,
      );

      return res.json({ data: { success: true } });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
