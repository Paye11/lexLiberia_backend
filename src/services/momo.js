const crypto = require('crypto');

const SANDBOX_SUCCESS_PHONE = '56733123453';

let cachedToken = null;

function targetEnvironment() {
  return (process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox').trim();
}

function isSandbox() {
  return targetEnvironment() === 'sandbox';
}

function baseUrl() {
  const configured = (process.env.MOMO_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return isSandbox()
    ? 'https://sandbox.momodeveloper.mtn.com'
    : 'https://proxy.momoapi.mtn.com';
}

function credentials() {
  const subscriptionKey = (process.env.MOMO_SUBSCRIPTION_KEY || '').trim();
  const apiUser = (process.env.MOMO_API_USER || '').trim();
  const apiKey = (process.env.MOMO_API_KEY || '').trim();

  if (!subscriptionKey || !apiUser || !apiKey) {
    const error = new Error('Mobile money is not configured.');
    error.statusCode = 503;
    throw error;
  }

  return { subscriptionKey, apiUser, apiKey };
}

function callbackUrl() {
  const explicit = (process.env.MOMO_CALLBACK_URL || '').trim();
  if (explicit) return explicit;
  const host = (process.env.MOMO_CALLBACK_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!host) return '';
  return `https://${host}/api/payments/momo/callback`;
}

class MomoRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MomoRequestError';
    this.status = status;
  }
}

async function momoFetch(path, { method = 'GET', headers = {}, body, auth } = {}) {
  const { subscriptionKey } = credentials();
  const requestHeaders = {
    'Ocp-Apim-Subscription-Key': subscriptionKey,
    ...headers,
  };

  if (auth === 'basic') {
    const { apiUser, apiKey } = credentials();
    requestHeaders.Authorization = `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString('base64')}`;
  }

  if (auth === 'bearer') {
    requestHeaders.Authorization = `Bearer ${await getAccessToken()}`;
  }

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: requestHeaders,
    body,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 300) };
    }
  }

  if (!response.ok) {
    const message = payload?.message || payload?.raw || `MoMo request failed (${response.status})`;
    throw new MomoRequestError(message, response.status);
  }

  return { status: response.status, payload };
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const { payload } = await momoFetch('/collection/token/', {
    method: 'POST',
    auth: 'basic',
  });

  const token = payload?.access_token;
  if (!token) {
    throw new MomoRequestError('MoMo did not return an access token.', 502);
  }

  const expiresIn = Number(payload.expires_in || 3600);
  cachedToken = {
    value: token,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 30) * 1000,
  };

  return token;
}

function formatCharge(usdAmount) {
  const dollars = Number(usdAmount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    const error = new Error('This plan does not have a price to collect.');
    error.statusCode = 400;
    throw error;
  }

  if (isSandbox()) {
    return {
      amount: String(Math.round(dollars)),
      currency: 'EUR',
      mode: 'sandbox',
    };
  }

  const rate = Number(process.env.MOMO_LRD_PER_USD);
  if (!Number.isFinite(rate) || rate <= 0) {
    const error = new Error('Live Liberian dollar pricing is not configured yet.');
    error.statusCode = 503;
    throw error;
  }

  return {
    amount: String(Math.round(dollars * rate)),
    currency: 'LRD',
    mode: 'live',
  };
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');

  if (isSandbox() && /^\d{10,15}$/.test(digits)) {
    return digits;
  }

  let local = digits;
  if (local.startsWith('00')) local = local.slice(2);
  if (local.startsWith('231')) {
    // already international
  } else if (local.startsWith('0')) {
    local = `231${local.slice(1)}`;
  } else if (local) {
    local = `231${local}`;
  }

  if (!/^231\d{7,10}$/.test(local)) {
    const error = new Error('Enter a Lonestar number, for example 0886123456.');
    error.statusCode = 400;
    throw error;
  }

  return local;
}

async function postRequestToPay(referenceId, body, includeCallback) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Reference-Id': referenceId,
    'X-Target-Environment': targetEnvironment(),
  };

  const url = callbackUrl();
  if (includeCallback && url) {
    headers['X-Callback-Url'] = url;
  }

  return momoFetch('/collection/v1_0/requesttopay', {
    method: 'POST',
    auth: 'bearer',
    headers,
    body: JSON.stringify(body),
  });
}

async function requestToPay({ referenceId, externalId, amount, currency, phone, payerMessage }) {
  const body = {
    amount: String(amount),
    currency,
    externalId: String(externalId),
    payer: {
      partyIdType: 'MSISDN',
      partyId: phone,
    },
    payerMessage: String(payerMessage || 'LexLiberia subscription').slice(0, 140),
    payeeNote: 'LexLiberia subscription',
  };

  try {
    await postRequestToPay(referenceId, body, true);
  } catch (error) {
    if (error instanceof MomoRequestError && error.status === 400 && callbackUrl()) {
      await postRequestToPay(referenceId, body, false);
      return;
    }
    throw error;
  }
}

async function getRequestToPayStatus(referenceId) {
  const { payload } = await momoFetch(`/collection/v1_0/requesttopay/${referenceId}`, {
    method: 'GET',
    auth: 'bearer',
    headers: {
      'X-Target-Environment': targetEnvironment(),
    },
  });

  return payload || {};
}

function newReferenceId() {
  return crypto.randomUUID();
}

function publicConfig() {
  return {
    mode: isSandbox() ? 'sandbox' : 'live',
    currency: isSandbox() ? 'EUR' : 'LRD',
    testPhone: isSandbox() ? SANDBOX_SUCCESS_PHONE : null,
  };
}

module.exports = {
  SANDBOX_SUCCESS_PHONE,
  MomoRequestError,
  isSandbox,
  formatCharge,
  normalizePhone,
  requestToPay,
  getRequestToPayStatus,
  newReferenceId,
  publicConfig,
};
