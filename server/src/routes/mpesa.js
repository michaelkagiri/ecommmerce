import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { MpesaPaymentM } from '../models.js';
import { asyncH, HttpError, requireAuth } from '../http.js';

const r = Router();
const m = config.mpesa;

let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const basic = Buffer.from(`${m.consumerKey}:${m.consumerSecret}`).toString('base64');
  const res = await fetch(`${m.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new HttpError(502, 'M-Pesa auth failed');
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) - 60) * 1000 };
  return cached.token;
}

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14); // YYYYMMDDHHmmss

// Normalise 07xx / 01xx / +254... to 2547xxxxxxxx
const msisdn = (p) => {
  const d = p.replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1);
  if (/^254[17]\d{8}$/.test(d)) return d;
  throw new HttpError(400, 'Enter a Safaricom number like 0712345678');
};

// Cashier asks for an STK push. Needs internet, so the till disables M-Pesa while offline.
r.post('/stkpush', requireAuth, asyncH(async (req, res) => {
  if (!m.enabled) throw new HttpError(503, 'M-Pesa is not enabled');
  const b = z.object({ phone: z.string(), amountCents: z.number().int().positive() }).parse(req.body);
  if (b.amountCents % 100 !== 0) throw new HttpError(400, 'M-Pesa amounts must be whole shillings');
  const ts = stamp();
  const body = {
    BusinessShortCode: m.shortcode,
    Password: Buffer.from(m.shortcode + m.passkey + ts).toString('base64'),
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: b.amountCents / 100,
    PartyA: msisdn(b.phone),
    PartyB: m.shortcode,
    PhoneNumber: msisdn(b.phone),
    CallBackURL: `${m.callbackBase}/api/mpesa/callback/${m.callbackSecret}`,
    AccountReference: 'POS',
    TransactionDesc: 'Shop purchase',
  };
  const resp = await fetch(`${m.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await resp.json();
  if (!resp.ok || j.ResponseCode !== '0') throw new HttpError(502, j.errorMessage || j.ResponseDescription || 'STK push failed');
  await MpesaPaymentM.create({ checkoutRequestId: j.CheckoutRequestID, merchantRequestId: j.MerchantRequestID, phone: body.PhoneNumber, amountCents: b.amountCents });
  res.json({ checkoutRequestId: j.CheckoutRequestID });
}));

// Daraja calls this. The secret in the path keeps strangers from faking payments.
// Callbacks can be late or repeated, so only a `pending` row is ever updated.
r.post('/callback/:secret', asyncH(async (req, res) => {
  if (!m.callbackSecret || req.params.secret !== m.callbackSecret) return res.sendStatus(404);
  const cb = req.body?.Body?.stkCallback;
  if (cb?.CheckoutRequestID) {
    const meta = Object.fromEntries((cb.CallbackMetadata?.Item || []).map((i) => [i.Name, i.Value]));
    await MpesaPaymentM.findOneAndUpdate(
      { checkoutRequestId: cb.CheckoutRequestID, status: 'pending' },
      cb.ResultCode === 0
        ? { status: 'success', mpesaReceipt: meta.MpesaReceiptNumber, resultDesc: cb.ResultDesc }
        : { status: 'failed', resultDesc: cb.ResultDesc }
    );
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

r.get('/status/:id', requireAuth, asyncH(async (req, res) => {
  const p = await MpesaPaymentM.findOne({ checkoutRequestId: req.params.id }).lean();
  if (!p) throw new HttpError(404, 'Unknown payment');
  res.json({ status: p.status, receipt: p.mpesaReceipt, message: p.resultDesc, amountCents: p.amountCents });
}));

export default r;
