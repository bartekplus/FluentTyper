import type { Logger } from "@core/application/logging/Logger";

type Handler<TPayload> = (payload: TPayload) => Promise<void> | void;

/** Dispatches commands to registered handlers, logging each dispatch and routing failures to `onError`. */
export class HandlerRegistry<TCommand extends string, TPayload> {
  private readonly handlers = new Map<TCommand, Handler<TPayload>>();

  constructor(
    private readonly logger: Logger,
    private readonly onError: (error: unknown, command: TCommand, payload: TPayload) => void,
  ) {}

  register(command: TCommand, handler: Handler<TPayload>): void {
    this.handlers.set(command, handler);
  }

  async dispatch(command: TCommand, payload: TPayload): Promise<void> {
    this.logger.debug("Dispatching command", { command });
    try {
      const handler = this.handlers.get(command);
      if (!handler) {
        throw new Error(`No handler registered for command: ${command}`);
      }
      await handler(payload);
      this.logger.debug("Command handled", { command });
    } catch (error) {
      this.logger.error("Command handler failed", {
        command,
        error: error instanceof Error ? error.message : String(error),
      });
      this.onError(error, command, payload);
    }
  }
}
