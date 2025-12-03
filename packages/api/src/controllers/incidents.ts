import mongoose from 'mongoose';

import type { ObjectId } from '@/models';
import Incident, {
  IIncident,
  IncidentSeverity,
  IncidentStatus,
  IncidentSource,
} from '@/models/incident';
import { IUser } from '@/models/user';

export type IncidentInput = {
  title: string;
  description?: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  alertId?: string;
  ownerId?: string;
  resolutionNotes?: string;
};

export const createIncident = async (
  teamId: ObjectId,
  input: IncidentInput,
  user: IUser,
) => {
  return new Incident({
    title: input.title,
    description: input.description,
    status: input.status || IncidentStatus.OPEN,
    severity: input.severity || IncidentSeverity.LOW,
    source: input.alertId ? IncidentSource.ALERT : IncidentSource.MANUAL,
    alert: input.alertId ? (input.alertId as unknown as ObjectId) : undefined,
    owner: input.ownerId ? (input.ownerId as unknown as ObjectId) : undefined,
    resolutionNotes: input.resolutionNotes,
    team: teamId,
    events: [
      {
        type: 'status_change',
        author: user._id,
        message: `Incident created with status ${input.status || IncidentStatus.OPEN}`,
      },
    ],
  }).save();
};

export const getIncidents = async (teamId: ObjectId) => {
  return Incident.find({ team: teamId })
    .populate('owner', 'name email')
    .populate('alert', 'name')
    .sort({ createdAt: -1 });
};

export const getIncidentById = async (id: string, teamId: ObjectId) => {
  return Incident.findOne({ _id: id, team: teamId })
    .populate('owner', 'name email')
    .populate('alert', 'name')
    .populate('events.author', 'name email');
};

export const updateIncident = async (
  id: string,
  teamId: ObjectId,
  input: Partial<IncidentInput>,
  user: IUser,
) => {
  const incident = await Incident.findOne({ _id: id, team: teamId });
  if (!incident) {
    throw new Error('Incident not found');
  }

  if (input.title) incident.title = input.title;
  if (input.description !== undefined) incident.description = input.description;
  if (input.resolutionNotes !== undefined) incident.resolutionNotes = input.resolutionNotes;
  
  if (input.status && input.status !== incident.status) {
    incident.events.push({
      type: 'status_change',
      author: user._id,
      message: `Status changed from ${incident.status} to ${input.status}`,
      createdAt: new Date(),
    });
    incident.status = input.status;
  }

  if (input.severity && input.severity !== incident.severity) {
    incident.events.push({
      type: 'comment',
      author: user._id,
      message: `Severity changed from ${incident.severity} to ${input.severity}`,
      createdAt: new Date(),
    });
    incident.severity = input.severity;
  }

  if (input.ownerId !== undefined) {
    const newOwnerId = input.ownerId as unknown as ObjectId;
    if (newOwnerId?.toString() !== incident.owner?.toString()) {
        incident.events.push({
            type: 'assignment',
            author: user._id,
            message: `Assigned to ${input.ownerId || 'unassigned'}`,
            createdAt: new Date(),
        });
        incident.owner = newOwnerId || undefined;
    }
  }

  return incident.save();
};

export const addIncidentComment = async (
  id: string,
  teamId: ObjectId,
  message: string,
  user: IUser,
) => {
  const incident = await Incident.findOne({ _id: id, team: teamId });
  if (!incident) {
    throw new Error('Incident not found');
  }

  incident.events.push({
    type: 'comment',
    author: user._id,
    message,
    createdAt: new Date(),
  });

  return incident.save();
};
