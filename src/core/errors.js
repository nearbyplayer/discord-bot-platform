/**
 * Base error class for all bot errors.
 * Provides context tracking for better debugging.
 */
export class BotError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [context] - Additional context for debugging
   */
  constructor(message, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * User-facing errors that should be shown to users without logging to Sentry.
 * Use for validation errors, permission issues, and other expected failures.
 */
export class UserError extends BotError {
  constructor(message, context = {}) {
    super(message, context);
  }
}

/**
 * System failures that should be logged to Sentry.
 * Users see a generic error message, admins see full details in logs.
 */
export class SystemError extends BotError {
  /**
   * @param {string} message - User-friendly description of what failed
   * @param {Error} [originalError] - The underlying error that caused this
   * @param {Object} [context] - Additional context for debugging
   */
  constructor(message, originalError = null, context = {}) {
    super(message, context);
    this.originalError = originalError;
  }
}

/**
 * Configuration errors (missing or invalid guild settings).
 * Extends UserError since these are actionable by server admins.
 */
export class ConfigError extends UserError {
  constructor(message, context = {}) {
    super(message, context);
  }
}

/**
 * Validation errors (invalid user input).
 * Extends UserError since users can fix these themselves.
 */
export class ValidationError extends UserError {
  constructor(message, context = {}) {
    super(message, context);
  }
}

/**
 * Database operation failures.
 * Extends SystemError since these indicate infrastructure issues.
 */
export class DatabaseError extends SystemError {
  constructor(message, originalError = null, context = {}) {
    super(message, originalError, context);
  }
}
