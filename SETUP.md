# Boussole — mise en route

Stack: React + Vite + Tailwind (`frontend/`), Node.js + Express (`backend/`), MongoDB Atlas.

## 1. MongoDB Atlas
1. Database Access: utilisateur dédié avec un mot de passe fort (jamais partagé dans un chat ou un dépôt).
2. Network Access: autorisez l'IP de votre serveur (`0.0.0.0/0` seulement pour des tests).
3. Les collections et index sont créés automatiquement au démarrage.

## 2. Configuration
```bash
cp backend/.env.example backend/.env      # puis remplir (MONGODB_URI, secrets, URL publique)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → JWT_SECRET, puis TOKEN_ENCRYPTION_KEY
```
- `PUBLIC_API_URL`: URL **HTTPS publique** du backend. Elle sert aux retours de connexion OAuth **et** à l'adresse des médias (Instagram et TikTok les téléchargent depuis cette URL). En local: `cloudflared tunnel --url http://localhost:4000` ou `ngrok http 4000`.
- Les comptes se créent par commande (pas d'inscription publique): `cd backend && npm run create-user -- <identifiant> <mot_de_passe>`. La même commande remplace le mot de passe d'un compte existant.
- Ne changez pas `TOKEN_ENCRYPTION_KEY` après avoir connecté des comptes: les jetons enregistrés deviendraient illisibles (il faudrait reconnecter).

## 3. Lancer
```bash
cd backend && npm install && npm run dev      # http://localhost:4000
cd frontend && npm install && npm run dev     # http://localhost:5173
```
Connectez-vous sur http://localhost:5173 avec l'identifiant créé (voir ci-dessus).

Le planificateur démarre avec le backend: il publie les posts programmés (toutes les 30 s) et synchronise stats/commentaires (toutes les 15 min), navigateur fermé. En production, le backend doit tourner en continu, en **un seul processus**, avec un disque persistant pour `UPLOAD_DIR` (les médias y sont stockés).

## 4. Applications développeur à créer (démarches externes)

URI de redirection à déclarer partout: `<PUBLIC_API_URL>/api/oauth/<instagram|linkedin|tiktok|facebook>/callback`

| Réseau | Où | À faire | Délai / validation |
|---|---|---|---|
| **Instagram** | developers.facebook.com | App type *Business* → produit **Instagram** (API with Instagram Login). Compte Instagram **Professionnel**. Ajoutez votre compte comme *testeur* tant que l'app est en développement. | Immédiat avec vos comptes testeurs. **App Review** + vérification Business pour d'autres comptes. |
| **LinkedIn** | linkedin.com/developers | App liée à une Page → produits **Share on LinkedIn** + **Sign In with LinkedIn using OpenID Connect**. | Profil personnel: immédiat. Pages, commentaires, stats: **Community Management API** (validation LinkedIn). |
| **TikTok** | developers.tiktok.com | App → **Login Kit** + **Content Posting API**, scopes `user.info.basic, user.info.profile, user.info.stats, video.list, video.publish`. | Sans **audit TikTok**, publication en privé uniquement. Pas d'API commentaires publique. |
| **Facebook** | developers.facebook.com | Même app Meta que pour Instagram (ou une autre): ajoutez **Facebook Login**, `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` (identifiants de l'app principale, pas ceux du produit Instagram). Vous devez **administrer une Page Facebook** (les profils personnels sont inaccessibles par API). Si vous avez plusieurs Pages, indiquez `FACEBOOK_PAGE_ID`. | Utilisable immédiatement par les administrateurs de l'app (mode Développement). **App Review** pour `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement` avant ouverture à d'autres comptes. |

Renseignez ensuite les identifiants dans `backend/.env`. Tant qu'ils manquent, la carte du réseau affiche « App non configurée » avec la démarche à suivre.

## 5. Sécurité en bref
- Mots de passe du dashboard hachés (scrypt), sessions JWT 7 jours, 10 tentatives de connexion par 15 min et par IP. Choisissez un mot de passe de 12 caractères ou plus avant d'exposer le dashboard sur Internet.
- Jetons des réseaux chiffrés en AES-256-GCM, jamais renvoyés au navigateur (projection explicite).
- OAuth: `state` aléatoire à usage unique (10 min), lié à l'utilisateur.
- Chaque route vérifie le JWT et filtre par `user_id`.
- Médias: seuls les fichiers du dossier de l'utilisateur sont acceptés pour la publication (anti-SSRF); noms de fichiers générés par le serveur; lecture publique par URL non devinable (nécessaire à Instagram/TikTok).
- Aucun mot de passe de réseau social n'est demandé ni stocké.
- Déconnexion: suppression des jetons et des données du compte + révocation quand l'API la propose (LinkedIn, TikTok). Instagram/Facebook: retirez aussi l'app dans les réglages du réseau.
- Session côté navigateur: jeton en `localStorage`. Pour un durcissement supplémentaire, passer à un cookie httpOnly.

## 6. Tests
```bash
cd backend && npm run typecheck && npm test
cd frontend && npm run build
```

## 7. Déploiement sur Render

Un seul service (`render.yaml`) sert l'API **et** le site: une seule adresse, pas de CORS. L'adresse publique est détectée automatiquement (`RENDER_EXTERNAL_URL`).

1. **Atlas → Network Access**: Render n'a pas d'IP fixe sur l'offre gratuite; autorisez `0.0.0.0/0` (le mot de passe de la base doit être fort).
2. **Créer l'utilisateur de production** (base séparée `boussole_prod`), depuis `backend/`:
   - PowerShell: `$env:MONGODB_DB="boussole_prod"; npm run create-user -- marc <mot_de_passe_long>`
3. **Render → New → Blueprint**, choisir le dépôt GitHub: Render lit `render.yaml`.
4. **Variables à saisir** (tableau de bord Render): `MONGODB_URI`, `TOKEN_ENCRYPTION_KEY` (nouvelle: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, et si besoin `FACEBOOK_CONFIG_ID`, `ANTHROPIC_API_KEY`. `JWT_SECRET` est généré par Render.
5. **Meta**: remplacer l'URI de redirection par `https://<votre-service>.onrender.com/api/oauth/facebook/callback` (Facebook Login for Business → Paramètres), puis « Vérifier l'URI ».
6. **Offre gratuite**: le service s'endort après ~15 min sans visite; la synchronisation automatique (toutes les 15 min) ne tourne alors pas et le premier chargement prend ~30 s. Pour un suivi continu, passer à l'offre **Starter** (`plan: starter` dans `render.yaml`).
7. **Ne pas partager les secrets**: ils restent dans Render (variables d'environnement), jamais dans Git.
