import { C, NO_ID } from '../db';
import { claimPost, recomputeStatus, reconcileProcessing, runPost } from './publisher';
import { syncAll } from './sync';

let running = false;

/** Publie les posts programmés arrivés à échéance. Exécuté par le serveur, indépendamment du navigateur. */
async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await C.posts.find({ status: 'scheduled', scheduled_at: { $lte: new Date() } }, { projection: { id: 1, _id: 0 } }).limit(20).toArray();
    for (const row of due) {
      const post = await claimPost(row.id, ['scheduled']); // un seul worker gagne la course
      if (post) await runPost(post);
    }
    await reconcileProcessing();
  } catch (e) {
    console.error('scheduler:', (e as Error).message);
  } finally {
    running = false;
  }
}

/** Au redémarrage, un post resté « publishing » sans activité est remis en échec pour ne pas rester bloqué. */
async function recoverStuck() {
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const stuck = await C.posts.find({ status: 'publishing', updated_at: { $lt: cutoff } }, NO_ID).toArray();
  for (const p of stuck) {
    await C.targets.updateMany(
      { post_id: p.id, status: { $in: ['pending', 'publishing'] } },
      { $set: { status: 'failed', error: 'Interrompu (redémarrage du serveur). Réessayez.' } },
    );
    await recomputeStatus(p.id);
  }
}

export function startScheduler() {
  recoverStuck().catch((e) => console.error('recoverStuck:', e.message));
  setInterval(tick, 30_000);
  setInterval(() => syncAll().catch((e) => console.error('syncAll:', e.message)), 15 * 60_000);
  console.log('Planificateur démarré (publications: 30 s, synchronisation: 15 min).');
}
