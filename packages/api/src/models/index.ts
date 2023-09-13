import mongoose from 'mongoose';

import * as config from '../config';
import logger from '../utils/logger';

export type ObjectId = mongoose.Types.ObjectId;

// set flags
mongoose.set('strictQuery', true);

// Allow empty strings to be set to required fields
// https://github.com/Automattic/mongoose/issues/7150
// ex. query in logview can be empty
mongoose.Schema.Types.String.checkRequired(v => v != null);

// connection events handlers
mongoose.connection.on('connected', () => {
  logger.info('Connection established to MongoDB');
});

mongoose.connection.on('disconnected', () => {
  logger.info('Lost connection to MongoDB server');
});

mongoose.connection.on('error', () => {
  logger.error('Could not connect to MongoDB');
});

mongoose.connection.on('reconnected', () => {
  logger.error('Reconnected to MongoDB');
});

mongoose.connection.on('reconnectFailed', () => {
  logger.error('Failed to reconnect to MongoDB');
});

export const connectDB = async () => {
  await mongoose.connect(config.MONGO_URI, {
    heartbeatFrequencyMS: 10000, // retry failed heartbeats
    maxPoolSize: 100, // 5 nodes -> max 1000 connections
  });
};

export const mongooseConnection = mongoose.connection;
