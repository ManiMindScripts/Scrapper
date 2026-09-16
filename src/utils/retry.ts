import { Logger } from "../pipeline/logger.js";

export interface RetryOptions {
  maxRetries?: number | undefined;
  delayMs?: number | undefined;
  backoffFactor?: number | undefined;
  logger?: Logger | undefined;
  tag?: string | undefined;
  shouldRetry?: ((error: unknown) => boolean) | undefined;
}

/**
 * Executes an async operation with exponential backoff retries.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelay = options.delayMs ?? 1000;
  const factor = options.backoffFactor ?? 2;
  const logger = options.logger;
  const tag = options.tag;

  let attempt = 0;
  let currentDelay = initialDelay;

  while (true) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt > maxRetries) {
        throw err;
      }

      if (options.shouldRetry && !options.shouldRetry(err)) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      if (logger) {
        logger.warn(
          `Attempt ${attempt} failed: ${errMsg}. Retrying in ${currentDelay}ms... (attempt ${attempt + 1}/${maxRetries + 1})`,
          tag,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      currentDelay *= factor;
    }
  }
}
