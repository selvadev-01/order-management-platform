/**
 * MongoDB connection.
 *
 * Indexes are built explicitly at startup rather than relying on Mongoose's
 * autoIndex, which is disabled in production. The unique index on `email` is
 * what makes concurrent registration fail safely (US-AUTH-1 edge case), so it
 * must exist before the service accepts traffic.
 */
import mongoose from 'mongoose';

export async function connectDb(uri, logger) {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongodb error'));
  mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongodb reconnected'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
  });

  logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  return mongoose.connection;
}

export async function syncIndexes(models, logger) {
  for (const model of models) {
    await model.syncIndexes();
    logger.debug({ model: model.modelName }, 'indexes synced');
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
