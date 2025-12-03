import mongoose from 'mongoose';

import Service, { IService, ServiceTier } from '@/models/service';
import ServiceCheck, { IServiceCheck } from '@/models/serviceCheck';
import { ObjectId } from '@/models';

export async function getServices(teamId: string): Promise<IService[]> {
  return Service.find({ team: teamId }).sort({ name: 1 });
}

export async function getService(teamId: string, name: string): Promise<IService | null> {
  return Service.findOne({ team: teamId, name });
}

export async function getServiceChecks(teamId: string, name: string): Promise<IServiceCheck[]> {
  const service = await Service.findOne({ team: teamId, name });
  if (!service) {
    return [];
  }
  return ServiceCheck.find({ service: service._id });
}

export async function updateService(
  teamId: string,
  name: string,
  updates: Partial<Pick<IService, 'description' | 'owner' | 'tier' | 'runbookUrl' | 'repoUrl'>>
): Promise<IService | null> {
  return Service.findOneAndUpdate(
    { team: teamId, name },
    { $set: updates },
    { new: true }
  );
}
