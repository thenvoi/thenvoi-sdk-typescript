export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const noop = (): void => undefined;

export class NoopLogger implements Logger {
  public debug = noop;
  public info = noop;
  public warn = noop;
  public error = noop;
}

export class ConsoleLogger implements Logger {
  public debug(message: string, context?: Record<string, unknown>): void {
    this.emit("debug", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.emit("info", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.emit("warn", message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    const payload = context ? ` ${JSON.stringify(context)}` : "";
    process.stderr.write(`${message}${payload}\n`);
  }

  private emit(
    level: "debug" | "info" | "warn",
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const fn = console[level];
    if (context === undefined) {
      fn(message);
      return;
    }
    fn(message, context);
  }
}
