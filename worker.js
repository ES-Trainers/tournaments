/**
 * ES TRAINERS — Razorpay webhook receiver (Cloudflare Worker, plain JavaScript, no dependencies)
 *
 * Flow:  Razorpay  --(POST, X-Razorpay-Signature)-->  this Worker  --(POST, HMAC-signed)-->  Google Apps Script (Code.gs)
 *
 * What it does
 *   1. Accepts only POST. Reads the RAW body (required for the signature).
 *   2. Verifies X-Razorpay-Signature = HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET), constant-time. Invalid -> 401.
 *   3. Acts only on "payment.captured". Every other event is acknowledged (200) and ignored.
 *   4. Takes ONLY the payment id and event id from the payload and forwards them to Apps Script, signed with a SEPARATE
 *      secret (WORKER_SHARED_SECRET). Apps Script never trusts the payload: it re-reads the payment from Razorpay's API.
 *   5. Duplicate deliveries: optional KV de-duplication here, and Apps Script is idempotent on its own, so a repeated
 *      delivery can never create a second registration, refund or email.
 *   6. Replies inside Razorpay's response window: if Apps Script answers within FORWARD_BUDGET_MS the Worker returns 200
 *      (processed) or, on a definite failure, 502 so Razorpay retries. If Apps Script is slow, the Worker answers 200
 *      "accepted" and keeps forwarding in the background (ctx.waitUntil, with two retries).
 *
 * Secrets / variables (Workers > Settings > Variables and Secrets, or `wrangler secret put`):
 *   RAZORPAY_WEBHOOK_SECRET  (secret)  the secret you typed when creating the webhook in the Razorpay dashboard
 *   WORKER_SHARED_SECRET     (secret)  random string; ALSO stored as Script property WORKER_SHARED_SECRET in Apps Script
 *   APPS_SCRIPT_URL          (variable) the deployed web app URL ending in /exec
 *   EVENT_KV                 (optional KV namespace binding) for duplicate-delivery suppression
 *
 * Logs contain event id, payment id and outcome only. Never secrets, never payer e-mail / phone / names.
 */

const FORWARD_BUDGET_MS = 4000;       // Razorpay waits only a few seconds for an answer
const FORWARD_TIMEOUT_MS = 28000;     // hard stop for one forward attempt (background)
const MAX_BODY_BYTES = 256 * 1024;
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const log = (obj) => console.log(JSON.stringify(obj));

async function forwardOnce(env, payload) {
  const ts = Date.now();
  const sig = await hmacHex(env.WORKER_SHARED_SECRET, `${ts}.${payload.eventId}.${payload.paymentId}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    // Apps Script answers a POST with a redirect to the response; fetch follows it.
    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'razorpayWebhook', event: payload.event, eventId: payload.eventId, paymentId: payload.paymentId, ts, sig }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!res.ok || !json) return { ok: false, retry: true, why: `apps_script_http_${res.status}` };
    if (json.ok === true) return { ok: true, result: String(json.result || 'ok') };
    return { ok: false, retry: json.retry === true, why: String(json.code || 'apps_script_rejected') };
  } catch (e) {
    return { ok: false, retry: true, why: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });
    if (!env.RAZORPAY_WEBHOOK_SECRET || !env.WORKER_SHARED_SECRET || !env.APPS_SCRIPT_URL) {
      log({ at: 'config', error: 'missing_configuration' });
      return reply(500, { ok: false, error: 'not_configured' });
    }

    const signature = request.headers.get('x-razorpay-signature');
    if (!signature) return reply(400, { ok: false, error: 'missing_signature' });
    const raw = await request.text();                       // RAW body: never re-serialize before verifying
    if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'too_large' });

    const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
    if (!safeEqual(expected, signature.trim().toLowerCase())) {
      log({ at: 'verify', error: 'invalid_signature' });
      return reply(401, { ok: false, error: 'invalid_signature' });
    }

    let event;
    try { event = JSON.parse(raw); } catch (e) { return reply(400, { ok: false, error: 'invalid_json' }); }
    const eventName = String(event && event.event || '');
    if (eventName !== 'payment.captured') {
      log({ at: 'ignored', event: eventName });
      return reply(200, { ok: true, status: 'ignored' });
    }
    const payment = event && event.payload && event.payload.payment && event.payload.payment.entity;
    const paymentId = payment && payment.id;
    if (!/^pay_[A-Za-z0-9]{6,40}$/.test(String(paymentId || ''))) return reply(400, { ok: false, error: 'invalid_payment' });
    // Razorpay's per-delivery id; fall back to the payment id so a missing header still de-duplicates.
    const eventId = (request.headers.get('x-razorpay-event-id') || `evt_${paymentId}`).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80);

    if (env.EVENT_KV) {
      const seen = await env.EVENT_KV.get(`done:${paymentId}`);
      if (seen) { log({ at: 'duplicate', eventId, paymentId }); return reply(200, { ok: true, status: 'duplicate' }); }
    }

    const payload = { event: eventName, eventId, paymentId };
    const markDone = async (r) => { if (r && r.ok && env.EVENT_KV) await env.EVENT_KV.put(`done:${paymentId}`, '1', { expirationTtl: DEDUPE_TTL_SECONDS }); };
    const attempt = forwardOnce(env, payload);
    log({ at: 'forwarding', eventId, paymentId });

    const quick = await Promise.race([attempt, new Promise((r) => setTimeout(() => r('pending'), FORWARD_BUDGET_MS))]);
    if (quick !== 'pending') {                                    // finished inside Razorpay's window
      log({ at: 'forwarded', eventId, paymentId, ok: quick.ok, result: quick.result, why: quick.why });
      if (quick.ok) { ctx.waitUntil(markDone(quick)); return reply(200, { ok: true, status: 'processed', result: quick.result }); }
      return reply(502, { ok: false, error: 'forward_failed' });  // definite failure: Razorpay retries this delivery
    }
    // Slow Apps Script (cold start / busy lock): answer now, keep going in the background, retry a couple of times if needed.
    ctx.waitUntil((async () => {
      let r = await attempt;
      for (let n = 1; n <= 2 && !r.ok && r.retry; n++) { await new Promise((x) => setTimeout(x, n * 2000)); r = await forwardOnce(env, payload); }
      log({ at: 'forwarded_background', eventId, paymentId, ok: r.ok, result: r.result, why: r.why });
      await markDone(r);
    })());
    return reply(200, { ok: true, status: 'accepted' });
  },
};
