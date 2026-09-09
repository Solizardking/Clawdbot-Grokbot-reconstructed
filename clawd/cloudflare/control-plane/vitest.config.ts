import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const TEST_AUTH_SECRET = "test-only-better-auth-secret-with-more-than-32-characters";
const TEST_CLOUDFLARE_TOKEN = "test-only-cloudflare-api-token-with-no-real-access";
const TEST_EMAIL_FROM = "noreply@clawdbot.com";
process.env.BETTER_AUTH_SECRET ??= TEST_AUTH_SECRET;
process.env.CLOUDFLARE_API_TOKEN ??= TEST_CLOUDFLARE_TOKEN;
process.env.EMAIL_FROM = TEST_EMAIL_FROM;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)) },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
          CLOUDFLARE_API_TOKEN: TEST_CLOUDFLARE_TOKEN,
          ALLOWED_ORIGINS: "https://app.clawdbot.test",
          // Pin the allowed sender so a local gitignored .dev.vars cannot
          // inject clawd@solgpt.us into miniflare's Send Email binding.
          EMAIL_FROM: TEST_EMAIL_FROM,
          TEST_MIGRATIONS: await readD1Migrations(`${root}migrations`),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
