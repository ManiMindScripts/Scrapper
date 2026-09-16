import cron, { type ScheduledTask } from "node-cron";
import { Logger, defaultLogger } from "../pipeline/logger.js";

export interface SchedulerConfig {
  /**
   * Cron expression. Defaults to "0 6 * * *" (Daily at 06:00).
   */
  cronExpression?: string | undefined;
  /**
   * Whether to run the scraper immediately upon starting the scheduler.
   */
  runOnStart?: boolean | undefined;
  /**
   * The scraper execution task.
   */
  onTick: () => Promise<void>;
  logger?: Logger | undefined;
}

export class Scheduler {
  private readonly cronExpression: string;
  private readonly runOnStart: boolean;
  private readonly onTick: () => Promise<void>;
  private readonly logger: Logger;

  private task: ScheduledTask | null = null;
  private isTickRunning = false;
  private isStopped = false;

  constructor(config: SchedulerConfig) {
    const expr = config.cronExpression ?? "0 6 * * *";
    if (!cron.validate(expr)) {
      throw new Error(`Invalid cron expression: '${expr}'`);
    }

    this.cronExpression = expr;
    this.runOnStart = config.runOnStart ?? false;
    this.onTick = config.onTick;
    this.logger = config.logger ?? defaultLogger;
  }

  getCronExpression(): string {
    return this.cronExpression;
  }

  isRunning(): boolean {
    return this.task !== null && !this.isStopped;
  }

  isExecuting(): boolean {
    return this.isTickRunning;
  }

  async start(): Promise<void> {
    this.isStopped = false;
    this.logger.info(
      `Initializing scheduler with pattern: '${this.cronExpression}'`,
      "scheduler",
    );

    if (this.runOnStart) {
      this.logger.info(
        "runOnStart enabled — executing initial scrape run immediately...",
        "scheduler",
      );
      await this.executeTick();
    }

    this.task = cron.schedule(this.cronExpression, async () => {
      await this.executeTick();
    });

    this.logger.info(
      `Scheduler running. Next execution scheduled according to '${this.cronExpression}'`,
      "scheduler",
    );
  }

  async executeTick(): Promise<void> {
    if (this.isTickRunning) {
      this.logger.warn(
        "Previous scraper execution still running. Skipping current scheduled tick to avoid overlapping runs.",
        "scheduler",
      );
      return;
    }

    this.isTickRunning = true;
    try {
      this.logger.info("Scheduled tick triggered — starting run...", "scheduler");
      await this.onTick();
      this.logger.info("Scheduled tick completed successfully.", "scheduler");
    } catch (err) {
      this.logger.error(
        `Error during scheduled execution tick: ${err instanceof Error ? err.message : String(err)}`,
        "scheduler",
        err,
      );
    } finally {
      this.isTickRunning = false;
    }
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    this.isStopped = true;
    this.logger.info("Scheduler stopped.", "scheduler");
  }
}
