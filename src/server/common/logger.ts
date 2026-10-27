/** Minimal context-tagged console logger (the shape services used from Nest). */
export class Logger {
  constructor(private readonly context: string) {}

  log(message: string) {
    if (process.env.NODE_ENV !== "test") console.log(`[${this.context}] ${message}`);
  }

  warn(message: string) {
    console.warn(`[${this.context}] ${message}`);
  }

  error(message: string) {
    console.error(`[${this.context}] ${message}`);
  }
}
