import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: "test",
            ADMIN_EMAILS: "admin@example.com",
            DEV_ADMIN_EMAIL: "admin@example.com",
            ACCESS_TEAM_DOMAIN: "",
            ACCESS_AUD: "",
            PUBLIC_BASE_URL: "https://example.test",
            TURNSTILE_SITE_KEY: "",
            STORE_ORIGIN_DESTINATION_ID: "",
            MINIMUM_PACKAGE_WEIGHT_GRAMS: "1000",
            SHIPPING_QUOTE_TTL_SECONDS: "900",
            KOMERCE_PAYMENT_TYPE: "qris",
            KOMERCE_CHANNEL_CODE: "",
            EMAIL_FROM: "Teman Makan <orders@example.com>",
            VAPID_SUBJECT: "mailto:owner@example.com",
            RAJAONGKIR_API_KEY: "",
            KOMERCE_PAYMENT_API_KEY: "",
            KOMERCE_CALLBACK_SECRET: "test-callback-secret",
            ORDER_TOKEN_SECRET: "test-order-token-secret-with-enough-entropy",
            RESEND_API_KEY: "",
            TURNSTILE_SECRET_KEY: "",
            VAPID_PUBLIC_KEY: "",
            VAPID_PRIVATE_KEY: ""
          },
          serviceBindings: {
            ASSETS: () => new Response("Not found", { status: 404 })
          }
        }
      };
    })
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    include: ["test/**/*.test.ts"]
  }
});
