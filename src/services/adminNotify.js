const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let configured = false;

function cleanEnv(name) {
  return String(process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
}

function configurePush() {
  if (configured) return true;
  const publicKey = cleanEnv('VAPID_PUBLIC_KEY');
  const privateKey = cleanEnv('VAPID_PRIVATE_KEY');
  const subject = cleanEnv('VAPID_SUBJECT') || 'mailto:billadmin@lexliberia.com';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

async function notifyAdminsOfProof(proof) {
  if (!configurePush()) {
    console.error('Payment alert skipped: VAPID keys are missing on the server.');
    return;
  }

  const populated = await proof.populate([
    { path: 'user', select: 'name email' },
    { path: 'plan', select: 'name' },
  ]);
  const sender = populated.user?.name || 'A subscriber';
  const email = populated.user?.email || '';
  const planName = populated.plan?.name || 'a plan';
  const amount = populated.amount;
  const payload = JSON.stringify({
    title: `Payment from ${sender}`,
    body: email
      ? `${sender} (${email}) sent $${amount} for ${planName}. Tap to open the screenshot.`
      : `${sender} sent $${amount} for ${planName}. Tap to open the screenshot.`,
    url: '/admin/payments',
  });

  const subscriptions = await PushSubscription.find();
  if (!subscriptions.length) {
    console.error('Payment alert skipped: no admin phone is subscribed.');
    return;
  }

  await Promise.all(subscriptions.map(async (entry) => {
    const subscription = entry.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      await PushSubscription.deleteOne({ _id: entry._id });
      return;
    }

    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: 60 * 60 * 24,
        urgency: 'high',
      });
    } catch (error) {
      const status = error.statusCode;
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        await PushSubscription.deleteOne({ _id: entry._id });
      } else {
        console.error(`Payment alert failed (${status || 'unknown'})`);
      }
    }
  }));
}

async function sendTestAlert() {
  if (!configurePush()) {
    return {
      configured: false,
      targeted: 0,
      delivered: 0,
      detail: 'Render is not reading VAPID_PUBLIC_KEY.',
    };
  }

  const subscriptions = await PushSubscription.find();
  if (!subscriptions.length) {
    return {
      configured: true,
      targeted: 0,
      delivered: 0,
      detail: 'This phone is not subscribed yet.',
    };
  }

  const payload = JSON.stringify({
    title: 'LexLiberia alerts are on',
    body: 'This phone will show a payment alert when a subscriber sends a screenshot.',
    url: '/admin/payments',
  });
  let delivered = 0;

  for (const entry of subscriptions) {
    const subscription = entry.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      await PushSubscription.deleteOne({ _id: entry._id });
      continue;
    }
    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: 60 * 60,
        urgency: 'high',
      });
      delivered += 1;
    } catch (error) {
      const status = error.statusCode;
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        await PushSubscription.deleteOne({ _id: entry._id });
      }
    }
  }

  return {
    configured: true,
    targeted: subscriptions.length,
    delivered,
    detail: delivered > 0
      ? 'Test alert sent. Check the phone notification bar.'
      : 'The phone subscription was rejected. Allow alerts again from the installed app.',
  };
}

function publicKey() {
  return cleanEnv('VAPID_PUBLIC_KEY');
}

module.exports = {
  notifyAdminsOfProof,
  sendTestAlert,
  publicKey,
};
