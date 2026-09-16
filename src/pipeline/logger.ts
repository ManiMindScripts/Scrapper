export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel | undefined;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LEVEL_ORDER[targetLevel] >= LEVEL_ORDER[this.level];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    tag?: string | undefined,
  ): string {
    const timestamp = new Date().toISOString();
    const tagPrefix = tag ? `[${tag}] ` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${tagPrefix}${message}`;
  }

  debug(message: string, tag?: string | undefined): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, tag));
    }
  }

  info(message: string, tag?: string | undefined): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, tag));
    }
  }

  warn(message: string, tag?: string | undefined): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, tag));
    }
  }

  error(message: string, tag?: string | undefined, error?: unknown): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, tag));
      if (error) {
        console.error(error);
      }
    }
  }
}

export const defaultLogger = new Logger();
