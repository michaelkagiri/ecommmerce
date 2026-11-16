import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config.js';
import { errorHandler } from './http.js';
import auth from './routes/auth.js';
import products from './routes/products.js';
import sales from './routes/sales.js';
import reports from './routes/reports.js';
import users from './routes/users.js';
import mpesa from './routes/mpesa.js';
import { seedIfEmpty } from './seed.js';

const app = express();
app.set('trust proxy', 1); // behind Nginx
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: mongoose.connection.readyState === 1 }));
app.use('/api/auth', auth);
app.use('/api/products', products);
app.use('/api/sales', sales);
app.use('/api/reports', reports);
app.use('/api/users', users);
app.use('/api/mpesa', mpesa);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

async function connect() {
  for (let i = 1; ; i++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
      return;
    } catch (e) {
      console.log(`Mongo not ready (attempt ${i}): ${e.message}`);
      if (i >= 30) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

await connect();
await mongoose.syncIndexes();
await seedIfEmpty();
app.listen(config.port, () => console.log(`POS API on :${config.port}`));
