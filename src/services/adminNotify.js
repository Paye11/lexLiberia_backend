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
  if (!configurePush()) return;

  const populated = await proof.populate([
    { path: 'user', select: 'name email' },
    { path: 'plan', select: 'name' },
  ]);
  const sender = populated.user?.name || 'A subscriber';
  const planName = populated.plan?.name || 'a plan';
  const payload = JSON.stringify({
    title: 'Lonestar payment to confirm',
    body: `${sender} sent $${populated.amount} for ${planName}. Open the screenshot and compare it with your phone.`,
    url: '/admin/payments',
  });

  const subscriptions = await PushSubscription.find();
  await Promise.all(subscriptions.map(async (entry) => {
    try {
      await webpush.sendNotification(entry.subscription, payload);
    } catch (error) {
      const status = error.statusCode;
      if (status === 404 || status === 410) {
        await PushSubscription.deleteOne({ _id: entry._id });
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
