import type { Logger } from "@core/application/logging/Logger";

export type Handler<TPayload, TResult> = (
  payload: TPayload,
) => Promise<TResult> | TResult;

export interface DispatchContext<TPayload, TResult> {
  command: string;
  payload: TPayload;
  handler?: Handler<TPayload, TResult>;
}

export type HandlerMiddleware<TPayload, TResult> = (
  context: DispatchContext<TPayload, TResult>,
  next: () => Promise<TResult>,
) => Promise<TResult>;

export class UnknownHandlerError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(`Unknown command: ${command}`);
    this.name = "UnknownHandlerError";
    this.command = command;
  }
}

function isUnknownHandlerError(error: unknown): error is UnknownHandlerError {
  if (error instanceof UnknownHandlerError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeUnknownError = error as {
    name?: unknown;
    command?: unknown;
    message?: unknown;
  };
  return (
    maybeUnknownError.name === "UnknownHandlerError" &&
    typeof maybeUnknownError.command === "string" &&
    typeof maybeUnknownError.message === "string"
  );
}

export class HandlerRegistry<TCommand extends string, TPayload, TResult = void> {
  private readonly handlers = new Map<TCommand, Handler<TPayload, TResult>>();
  private readonly middlewares: readonly HandlerMiddleware<TPayload, TResult>[];

  constructor(middlewares: readonly HandlerMiddleware<TPayload, TResult>[] = []) {
    this.middlewares = middlewares;
  }

  register(command: TCommand, handler: Handler<TPayload, TResult>): this {
    this.handlers.set(command, handler);
    return this;
  }

  has(command: string): command is TCommand {
    return this.handlers.has(command as TCommand);
  }

  async dispatch(command: string, payload: TPayload): Promise<TResult> {
    const context: DispatchContext<TPayload, TResult> = {
      command,
      payload,
      handler: this.handlers.get(command as TCommand),
    };
    return this.executeMiddleware(0, context);
  }

  private async executeMiddleware(
    index: number,
    context: DispatchContext<TPayload, TResult>,
  ): Promise<TResult> {
    if (index >= this.middlewares.length) {
      if (!context.handler) {
        throw new UnknownHandlerError(context.command);
      }
      return context.handler(context.payload);
    }
    const middleware = this.middlewares[index];
    return middleware(context, () => this.executeMiddleware(index + 1, context));
  }
}

export function createValidationMiddleware<
  TPayload,
  TResult,
  TCommand extends string,
>(
  isSupportedCommand: (command: string) => command is TCommand,
): HandlerMiddleware<TPayload, TResult> {
  return async (context, next) => {
    if (!isSupportedCommand(context.command) || !context.handler) {
      throw new UnknownHandlerError(context.command);
    }
    return next();
  };
}

export function createLoggingMiddleware<TPayload, TResult>(
  logger: Logger,
): HandlerMiddleware<TPayload, TResult> {
  return async (context, next) => {
    logger.debug("Dispatching command", { command: context.command });
    try {
      const result = await next();
      logger.debug("Command handled", { command: context.command });
      return result;
    } catch (error) {
      logger.error("Command handler failed", {
        command: context.command,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

export interface ErrorMappingMiddlewareOptions<TPayload, TResult> {
  mapUnknownCommand: (command: string, payload: TPayload) => TResult | Promise<TResult>;
  mapError: (
    error: unknown,
    context: DispatchContext<TPayload, TResult>,
  ) => TResult | Promise<TResult>;
}

export function createErrorMappingMiddleware<TPayload, TResult>(
  options: ErrorMappingMiddlewareOptions<TPayload, TResult>,
): HandlerMiddleware<TPayload, TResult> {
  return async (context, next) => {
    try {
      return await next();
    } catch (error) {
      if (isUnknownHandlerError(error)) {
        return options.mapUnknownCommand(context.command, context.payload);
      }
      return options.mapError(error, context);
    }
  };
}
