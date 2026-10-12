import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  /** URL publique du backend: callbacks OAuth ET adresse des médias (Instagram/TikTok doivent pouvoir les télécharger). */
  PUBLIC_API_URL: z.string().url(),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'URI MongoDB attendue'),
  MONGODB_DB: z.string().default('social_dashboard'),
  JWT_SECRET: z.string().min(32, '32 caractères minimum'),
  UPLOAD_DIR: z.string().default('./uploads'),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, '64 caractères hexadécimaux attendus'),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_API_VERSION: z.string().default('202506'),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  /** Facultatif: Page à connecter si vous en administrez plusieurs (sinon la première). */
  FACEBOOK_PAGE_ID: z.string().optional(),
  /** Facebook Login for Business: identifiant de la configuration (Facebook Login for Business > Configurations). */
  FACEBOOK_CONFIG_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
});

const raw: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);
// Sur Render, l'adresse publique du service est fournie automatiquement (RENDER_EXTERNAL_URL).
// Le site est servi par le même service: l'API et le frontend ont donc la même adresse.
if (raw.RENDER_EXTERNAL_URL) {
  raw.PUBLIC_API_URL ??= raw.RENDER_EXTERNAL_URL;
  raw.FRONTEND_URL ??= raw.PUBLIC_API_URL;
}
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  console.error('Configuration invalide (.env) :');
  for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
export const env = parsed.data;
