import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { ProductM, UserM } from './models.js';

// Creates the first manager from ADMIN_USERNAME / ADMIN_PASSWORD if there are no users.
// SEED_DEMO=1 also adds a few sample products.
export async function seedIfEmpty() {
  if ((await UserM.countDocuments()) === 0) {
    const { ADMIN_USERNAME: u, ADMIN_PASSWORD: p } = process.env;
    if (u && p && p.length >= 8) {
      await UserM.create({ username: u, role: 'manager', passwordHash: await bcrypt.hash(p, 10) });
      console.log(`Created first manager "${u}"`);
    } else {
      console.log('No users yet. Set ADMIN_USERNAME and ADMIN_PASSWORD (8+ chars) and restart to create the first manager.');
    }
  }
  if (process.env.SEED_DEMO === '1' && (await ProductM.countDocuments()) === 0) {
    await ProductM.insertMany([
      { barcode: '6001000000011', name: 'Bread 400g', priceCents: 6500, stock: 40 },
      { barcode: '6001000000028', name: 'Milk 500ml', priceCents: 6000, stock: 60 },
      { barcode: '6001000000035', name: 'Sugar 1kg', priceCents: 18000, stock: 25 },
      { barcode: '6001000000042', name: 'Cooking oil 1L', priceCents: 32000, stock: 18 },
      { barcode: '6001000000059', name: 'Soap bar', priceCents: 7500, stock: 3 },
    ]);
    console.log('Seeded demo products');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { config } = await import('./config.js');
  await mongoose.connect(config.mongoUri);
  await seedIfEmpty();
  await mongoose.disconnect();
}
