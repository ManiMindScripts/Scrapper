import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
} from "playwright";

export interface BrowserManagerConfig {
  headless?: boolean | undefined;
  defaultUserAgent?: string | undefined;
  launchOptions?: LaunchOptions | undefined;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class BrowserManager {
  private browser: Browser | null = null;
  private readonly config: BrowserManagerConfig;

  constructor(config: BrowserManagerConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      defaultUserAgent: config.defaultUserAgent ?? DEFAULT_USER_AGENT,
      launchOptions: config.launchOptions,
    };
  }

  /**
   * Lazily launches or returns the shared Chromium browser instance.
   */
  async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      const launchOptions: LaunchOptions = {};
      if (this.config.launchOptions) {
        Object.assign(launchOptions, this.config.launchOptions);
      }
      if (this.config.headless !== undefined) {
        launchOptions.headless = this.config.headless;
      }
      this.browser = await chromium.launch(launchOptions);
    }
    return this.browser;
  }

  /**
   * Creates an isolated browser context per source to avoid cookie/cache leaks.
   */
  async createContext(
    options: BrowserContextOptions = {},
  ): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const contextOptions: BrowserContextOptions = {
      viewport: { width: 1280, height: 800 },
    };
    if (this.config.defaultUserAgent !== undefined) {
      contextOptions.userAgent = this.config.defaultUserAgent;
    }
    Object.assign(contextOptions, options);

    return browser.newContext(contextOptions);
  }

  /**
   * Closes the underlying browser instance and resets state.
   */
  async close(): Promise<void> {
    if (this.browser && this.browser.isConnected()) {
      await this.browser.close();
    }
    this.browser = null;
  }
}
