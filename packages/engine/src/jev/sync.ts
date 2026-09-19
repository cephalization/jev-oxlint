/**
 * Synchronous bridge to jev.
 *
 * oxlint JS plugin rules are synchronous (ESLint visitor semantics), but jev
 * is an HTTP API. A long-lived worker thread owns the async `fetch`; the rule
 * thread posts a request and blocks on `Atomics.wait` until the worker
 * signals completion. This is the same technique `synckit` uses for
 * eslint-plugin-prettier. Experiment 1 measured ~36ms round-trip overhead
 * including worker start-up.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

import type { SystemOneRequest } from "./types.js";
import type { WorkerCall, WorkerReply, WorkerResult } from "./worker.js";

interface Bridge {
  signal: Int32Array;
  port: MessagePort;
  worker: Worker;
}

let bridge: Bridge | undefined;
let nextCallId = 1;

export function workerResultForCall(reply: WorkerReply, id: number): WorkerResult | undefined {
  if (reply.id !== id) return undefined;
  const { id: _id, ...result } = reply;
  return result;
}

function getBridge(): Bridge {
  if (bridge) return bridge;
  const sab = new SharedArrayBuffer(4);
  const { port1, port2 } = new MessageChannel();
  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");
  const worker = new Worker(workerPath, {
    workerData: { sab, port: port2 },
    transferList: [port2],
  });
  // Never keep the lint process alive because of us.
  worker.unref();
  bridge = { signal: new Int32Array(sab), port: port1, worker };
  return bridge;
}

export interface CallOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
}

export function callJevSync(body: SystemOneRequest, options: CallOptions): WorkerResult {
  const { signal, port } = getBridge();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const id = nextCallId++;
  const call: WorkerCall = {
    id,
    url: options.url,
    apiKey: options.apiKey,
    body,
    timeoutMs,
  };
  port.postMessage(call);
  const deadline = Date.now() + timeoutMs + 1_000;

  for (;;) {
    // A timed-out request may complete after the next request starts. Drain and
    // discard replies by id so a late answer can never be attributed to the
    // current request and cached under the wrong content hash.
    let message = receiveMessageOnPort(port);
    while (message) {
      const reply = message.message as WorkerReply;
      const result = workerResultForCall(reply, id);
      if (result) return result;
      message = receiveMessageOnPort(port);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0)
      return {
        ok: false,
        error: `jev call timed out after ${timeoutMs}ms`,
        ms: timeoutMs,
      };

    Atomics.store(signal, 0, 0);
    // Check again after resetting the signal. If a reply raced with the reset,
    // it is already queued; if it arrives after this check, Atomics.wait sees
    // the changed signal value or receives the notification.
    message = receiveMessageOnPort(port);
    if (message) {
      const reply = message.message as WorkerReply;
      const result = workerResultForCall(reply, id);
      if (result) return result;
      continue;
    }
    Atomics.wait(signal, 0, 0, remaining);
  }
}
