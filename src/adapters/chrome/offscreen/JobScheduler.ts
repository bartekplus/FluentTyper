import type { AiGenerationRequest } from "@core/domain/grammar/review/ai/types";

/**
 * Review job queue for the single engine: one job runs at a time, pending
 * jobs are bounded per port and in total, ports are served round-robin, and
 * identical in-flight payloads from the same port share one job. A cancel or
 * disconnect only ever touches the jobs of the port it came from. Latest-wins
 * within a port is the client's job (it cancels what it no longer needs).
 */

export const MAX_PENDING_PER_PORT = 2;
export const MAX_PENDING_TOTAL = 16;
/** Request ids that may share one identical in-flight job. */
const MAX_JOINED_REQUESTS = 4;

export interface ScheduledJob<P> {
  port: P;
  /** Requests waiting for this job's result (identical payloads are joined). */
  requestIds: string[];
  request: AiGenerationRequest;
  /** Payload identity for dedupe; session memory only. */
  key: string;
  cancelled: boolean;
}

type EnqueueResult = "queued" | "joined" | "busy";

export class JobScheduler<P> {
  /** Map order is the round-robin order: a served port moves to the back. */
  private readonly queues = new Map<P, Array<ScheduledJob<P>>>();
  /** Queued jobs across all ports (not the running one). */
  pending = 0;
  running: ScheduledJob<P> | null = null;

  enqueue(port: P, requestId: string, request: AiGenerationRequest): EnqueueResult {
    const key = JSON.stringify(request);
    const queue = this.queues.get(port) ?? [];
    const candidates =
      this.running?.port === port && !this.running.cancelled ? [this.running, ...queue] : queue;
    const identical = candidates.find((job) => job.key === key);
    if (identical) {
      if (identical.requestIds.length >= MAX_JOINED_REQUESTS) {
        return "busy";
      }
      identical.requestIds.push(requestId);
      return "joined";
    }
    if (queue.length >= MAX_PENDING_PER_PORT || this.pending >= MAX_PENDING_TOTAL) {
      return "busy";
    }
    queue.push({ port, requestIds: [requestId], request, key, cancelled: false });
    this.queues.set(port, queue);
    this.pending += 1;
    return "queued";
  }

  /** Takes the next job round-robin across ports and marks it running. */
  next(): ScheduledJob<P> | null {
    for (const [port, queue] of this.queues) {
      const job = queue.shift();
      if (!job) {
        continue;
      }
      this.pending -= 1;
      this.queues.delete(port);
      this.queues.set(port, queue);
      this.running = job;
      return job;
    }
    return null;
  }

  finish(job: ScheduledJob<P>): void {
    if (this.running === job) {
      this.running = null;
    }
  }

  /**
   * Drops `requestId` from its job on `port`; null when unknown. `orphaned`:
   * no requester is left (a queued job is removed, a running one is marked
   * cancelled and should be interrupted).
   */
  cancel(port: P, requestId: string): { job: ScheduledJob<P>; orphaned: boolean } | null {
    const queue = this.queues.get(port) ?? [];
    const candidates = this.running?.port === port ? [this.running, ...queue] : queue;
    const job = candidates.find((candidate) => candidate.requestIds.includes(requestId));
    if (!job) {
      return null;
    }
    job.requestIds = job.requestIds.filter((id) => id !== requestId);
    if (job.requestIds.length > 0) {
      return { job, orphaned: false };
    }
    job.cancelled = true;
    const index = queue.indexOf(job);
    if (index >= 0) {
      queue.splice(index, 1);
      this.pending -= 1;
    }
    return { job, orphaned: true };
  }

  /** Forgets a port: drops its queue; its running job (if any) is returned, cancelled. */
  removePort(port: P): ScheduledJob<P> | null {
    this.pending -= this.queues.get(port)?.length ?? 0;
    this.queues.delete(port);
    if (this.running?.port === port) {
      this.running.cancelled = true;
      this.running.requestIds = [];
      return this.running;
    }
    return null;
  }

  /** Removes and returns every queued job (not the running one). */
  drain(): Array<ScheduledJob<P>> {
    const jobs = [...this.queues.values()].flat();
    this.queues.clear();
    this.pending = 0;
    return jobs;
  }
}
