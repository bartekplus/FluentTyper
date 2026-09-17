import type { Logger } from "@core/application/logging/Logger";

export type Handler<TPayload, TResult> = (payload: TPayload) => Promise<TResult> | TResult;

export interface DispatchContext<TPayload, TResult> {
  command: string;
  payload: TPayload;
  handler?: Handler<TPayload, TResult>;
}

export type HandlerMiddleware<TPayload, TResult> = (
  context: DispatchContext<TPayload, TResult>,
  next: () => Promise<TResult>,
) => Promise<TResult>;

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

  async dispatch(command: TCommand, payload: TPayload): Promise<TResult> {
    const context: DispatchContext<TPayload, TResult> = {
      command,
      payload,
      handler: this.handlers.get(command),
    };
    return this.executeMiddleware(0, context);
  }

  private async executeMiddleware(
    index: number,
    context: DispatchContext<TPayload, TResult>,
  ): Promise<TResult> {
    if (index >= this.middlewares.length) {
      if (!context.handler) {
        throw new Error(`No handler registered for command: ${context.command}`);
      }
      return context.handler(context.payload);
    }
    const middleware = this.middlewares[index];
    return middleware(context, () => this.executeMiddleware(index + 1, context));
  }
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
      return options.mapError(error, context);
    }
  };
}
