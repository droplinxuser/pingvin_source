import { ConsoleLogger, ConsoleLoggerOptions } from "@nestjs/common";
import { ErrorLogLevel, ErrorLogService } from "./errorLog.service";

/**
 * Keeps the normal console/systemd output and adds error-level messages to the
 * shared error log store. Only error and fatal messages are persisted, so a
 * busy instance does not fill Valkey with regular request logs.
 */
export class ErrorTrackingLogger extends ConsoleLogger {
  constructor(
    private readonly errorLogs: ErrorLogService,
    options?: ConsoleLoggerOptions,
  ) {
    super(options);
  }

  error(message: unknown, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.capture("error", message, stack, context);
  }

  fatal(message: unknown, stack?: string, context?: string) {
    super.fatal(message, stack, context);
    this.capture("fatal", message, stack, context);
  }

  private capture(
    level: ErrorLogLevel,
    message: unknown,
    stack?: string,
    context?: string,
  ) {
    let logStack = stack;
    let logContext = context;

    // A single string argument is usually the context, not a stack trace.
    if (!logContext && logStack && !logStack.includes("\n")) {
      logContext = logStack;
      logStack = undefined;
    }

    this.errorLogs.capture("backend", {
      message,
      stack: logStack,
      context: logContext,
      level,
    });
  }
}
