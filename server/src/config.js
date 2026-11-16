const env = process.env;
export const config = {
  port: Number(env.PORT) || 4000,
  mongoUri: env.MONGO_URI || 'mongodb://localhost:27017/pos?replicaSet=rs0',
  jwtSecret: env.JWT_SECRET || '',
  jwtExpires: env.JWT_EXPIRES || '7d', // long enough for a till that is offline for days
  mpesa: {
    enabled: env.MPESA_ENABLED === '1',
    baseUrl: env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
    consumerKey: env.MPESA_CONSUMER_KEY || '',
    consumerSecret: env.MPESA_CONSUMER_SECRET || '',
    shortcode: env.MPESA_SHORTCODE || '174379',
    passkey: env.MPESA_PASSKEY || '',
    callbackBase: env.MPESA_CALLBACK_BASE || '', // e.g. https://pos.example.com
    callbackSecret: env.MPESA_CALLBACK_SECRET || '', // random string used in the callback URL path
  },
};
if (config.jwtSecret.length < 24) {
  throw new Error('JWT_SECRET must be set to a random string of at least 24 characters');
}
