import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getTeam, getTeamInviteUrl } from '@/controllers/team';
import {
  deleteTeamMember,
  deleteTeamMemberKeepingOne,
  findUserByEmail,
  findUsersByTeam,
} from '@/controllers/user';
import TeamInvite from '@/models/teamInvite';
import { requireAdminRequest } from '@/utils/orgApiKeyPolicy';
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
    if (!teamId) {
      return res.sendStatus(403);
    }

    const team = await getTeam(teamId.toString());
    if (!team) {
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
    if (!teamId) {
      return res.sendStatus(403);
    }

    const teamUsers = await findUsersByTeam(teamId.toString());
    return res.json({
      data: teamUsers.map(user => ({
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        isCurrentUser: !!userId && user._id.equals(userId),
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
 *       '403':
 *         description: The API key does not have admin scope
 */
router.post(
  '/invitation',
  requireAdminRequest,
  validateRequest({
    body: z.object({
      email: z.string().email(),
      name: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
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
        try {
          teamInvite = await new TeamInvite({
            teamId: teamId.toString(),
            name,
            email: normalizedEmail,
            token: crypto.randomBytes(32).toString('hex'),
          }).save();
        } catch (err: any) {
          // ponytail: concurrent insert lost the race on the {teamId, email}
          // unique index — re-fetch the winner's doc to stay idempotent.
          if (err?.code === 11000) {
            teamInvite = await TeamInvite.findOne({
              teamId: teamId.toString(),
              email: normalizedEmail,
            });
          }
          if (!teamInvite) {
            throw err;
          }
        }
      }

      return res.json({
        data: {
          email: normalizedEmail,
          invitationId: teamInvite._id.toString(),
          status: 'pending',
          url: getTeamInviteUrl(teamInvite.token),
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
 *       '403':
 *         description: The API key does not have admin scope
 */
// Admin-only because each invite URL lets its holder join the team.
router.get('/invitations', requireAdminRequest, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (!teamId) {
      return res.sendStatus(403);
    }

    const teamInvites = await TeamInvite.find(
      { teamId: teamId.toString() },
      { createdAt: 1, email: 1, name: 1, token: 1 },
    );

    return res.json({
      data: teamInvites.map(ti => ({
        id: ti._id.toString(),
        createdAt: ti.createdAt,
        email: ti.email,
        name: ti.name,
        url: getTeamInviteUrl(ti.token),
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
 *       '403':
 *         description: The API key does not have admin scope
 *       '404':
 *         description: Invitation not found
 */
router.delete(
  '/invitation/:id',
  requireAdminRequest,
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
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
 *       '400':
 *         description: Cannot remove yourself or the last team member
 *       '403':
 *         description: The API key does not have admin scope
 *       '404':
 *         description: Member not found
 */
router.delete(
  '/member/:id',
  requireAdminRequest,
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const requestingUserId = req.user?._id;
      if (!teamId || !requestingUserId) {
        return res.sendStatus(403);
      }

      if (req.params.id === requestingUserId.toString()) {
        return res.status(400).json({
          message: 'You cannot remove yourself from the team',
        });
      }

      // People can't remove themselves, so only a key can empty the team.
      if (req.user?.isServiceAccount) {
        const result = await deleteTeamMemberKeepingOne(
          teamId.toString(),
          req.params.id,
          requestingUserId,
        );
        if (result === 'not_found') {
          return res.sendStatus(404);
        }
        if (result === 'last_member') {
          return res
            .status(400)
            .json({ message: 'Cannot remove the last team member' });
        }
        return res.json({ data: { success: true } });
      }

      const deletedUser = await deleteTeamMember(
        teamId.toString(),
        req.params.id,
        requestingUserId,
      );

      if (!deletedUser) {
        return res.sendStatus(404);
      }

      return res.json({ data: { success: true } });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
