const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let configured = false;

function configurePush() {
  if (configured) return true;
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:billadmin@lexliberia.com').trim();
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

function publicKey() {
  return (process.env.VAPID_PUBLIC_KEY || '').trim();
}

module.exports = {
  notifyAdminsOfProof,
  publicKey,
};
