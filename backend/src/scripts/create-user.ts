// Usage: npm run create-user -- <identifiant> <mot_de_passe>
// Crée l'utilisateur, ou remplace son mot de passe s'il existe déjà.
import { hashPassword } from '../auth';
import { C, closeDb, initDb, newId } from '../db';

const [rawName, password] = process.argv.slice(2);
const username = rawName?.trim().toLowerCase();

if (!username || !password) {
  console.error('Usage: npm run create-user -- <identifiant> <mot_de_passe>');
  process.exit(1);
}
if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
  console.error('Identifiant invalide: 3 à 50 caractères (lettres, chiffres, . _ -).');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Mot de passe trop court (6 caractères minimum).');
  process.exit(1);
}
if (password.length < 10) {
  console.warn('Attention: mot de passe court. Avant d’exposer le dashboard sur Internet, choisissez-en un de 12 caractères ou plus.');
}

await initDb();
const hash = await hashPassword(password);
const r = await C.users.updateOne(
  { username },
  { $set: { password_hash: hash }, $setOnInsert: { id: newId(), username, created_at: new Date() } },
  { upsert: true },
);
console.log(r.upsertedCount ? `Utilisateur « ${username} » créé.` : `Mot de passe de « ${username} » mis à jour.`);
await closeDb();
