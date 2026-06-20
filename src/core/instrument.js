/**
 * Sentry error tracking initialization.
 * Must be imported before any other modules to instrument correctly.
 */
import * as Sentry from "@sentry/node";
import { nodeEnv } from "#config";

Sentry.init({
  environment: nodeEnv,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
