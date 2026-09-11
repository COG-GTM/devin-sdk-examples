import type { HarnessDiagnostic } from "@ai-sdk/harness/agent";

/**
 * What a turn is doing before Devin says anything, as a short checklist the
 * chat can show instead of a blank message.
 *
 * The steps are driven by the harness's own diagnostics (routed here from the
 * agent's `onLog` by harness session id, which is the chat id) plus the two
 * checkpoints the route observes itself: the session being acquired and the
 * first chunk of Devin output.
 */
type StepId = "sandbox" | "bridge" | "devin" | "model";
type StepState = "pending" | "active" | "done";

interface SetupStep {
  id: StepId;
  label: string;
  state: StepState;
  /** One-line detail for the current/last activity in this step. */
  detail?: string;
  /** Milliseconds the step took, once done. */
  ms?: number;
}

export interface SetupProgress {
  steps: SetupStep[];
  /** Set once Devin has started responding. */
  readyMs?: number;
}

const LABELS: Record<StepId, string> = {
  sandbox: "Sandbox",
  bridge: "Harness bridge",
  devin: "Devin session",
  model: "Devin",
};
const ORDER: StepId[] = ["sandbox", "bridge", "devin", "model"];
/** What a step is doing until a more specific event says otherwise. */
const DEFAULT_DETAIL: Record<StepId, string> = {
  sandbox: "creating or resuming the microVM, installing the bridge",
  bridge: "connecting to the bridge",
  devin: "connecting to Devin",
  model: "waiting for the first token",
};

type Listener = (event: HarnessDiagnostic) => void;
const listeners = new Map<string, Set<Listener>>();

/** Wire this to `HarnessAgent`'s `onLog`. */
export function routeDiagnostic(event: HarnessDiagnostic): void {
  if (event.sessionId === undefined) return;
  for (const listener of listeners.get(event.sessionId) ?? []) listener(event);
}

/** Tracks one turn's setup and reports every change through `emit`. */
export class SetupTracker {
  private readonly startedAt = Date.now();
  private stepStartedAt = this.startedAt;
  private readonly steps: Record<StepId, SetupStep> = Object.fromEntries(
    ORDER.map((id) => [id, { id, label: LABELS[id], state: "pending" }]),
  ) as Record<StepId, SetupStep>;
  private readonly listener: Listener;
  private finished = false;

  constructor(
    private readonly chatId: string,
    private readonly emit: (progress: SetupProgress) => void,
  ) {
    this.listener = (event) => {
      this.onDiagnostic(event);
    };
    let set = listeners.get(chatId);
    if (!set) listeners.set(chatId, (set = new Set()));
    set.add(this.listener);
    this.activate("sandbox", DEFAULT_DETAIL.sandbox);
  }

  /** The harness session exists: the bridge is connected (or was just spawned). */
  sessionAcquired(): void {
    this.complete("bridge");
    this.activate("devin", "connecting to Devin");
  }

  /** Devin produced its first output. */
  firstOutput(): void {
    if (this.finished) return;
    this.complete("model");
    this.finished = true;
    this.emit({ ...this.snapshot(), readyMs: Date.now() - this.startedAt });
    this.dispose();
  }

  dispose(): void {
    const set = listeners.get(this.chatId);
    set?.delete(this.listener);
    if (set?.size === 0) listeners.delete(this.chatId);
  }

  private onDiagnostic(event: HarnessDiagnostic): void {
    if (this.finished) return;
    switch (event.subsystem) {
      case "devin.bridge.attach":
        this.complete("sandbox");
        this.activate("bridge", "attaching to the parked bridge");
        break;
      case "devin.bridge.spawn":
        this.complete("sandbox");
        this.activate("bridge", "installing and starting the bridge");
        break;
      case "devin.bridge.ready":
        this.complete("bridge", event.attrs?.attached === true ? "attached" : "started");
        break;
      case "devin.cli":
        this.activate("devin", "connecting to Devin");
        break;
      case "devin.session":
        this.activate(
          "devin",
          event.message.startsWith("Loading")
            ? "resuming the Devin session"
            : "creating a Devin session",
        );
        break;
      case "devin.session.ready":
        this.complete("devin", event.attrs?.loaded === true ? "session loaded" : "session created");
        this.activate("model", "waiting for the first token");
        break;
      case "devin.prompt":
        this.activate("model", "prompt sent, waiting for the first token");
        break;
      default:
        return;
    }
  }

  private step(id: StepId): SetupStep {
    return this.steps[id];
  }

  private snapshot(): SetupProgress {
    return { steps: ORDER.map((id) => ({ ...this.steps[id] })) };
  }

  private activate(id: StepId, detail: string): void {
    // Everything before this step is necessarily finished.
    for (const prior of ORDER.slice(0, ORDER.indexOf(id))) {
      if (this.step(prior).state !== "done") this.complete(prior);
    }
    const step = this.step(id);
    if (step.state === "done") return;
    if (step.state === "pending") this.stepStartedAt = Date.now();
    step.state = "active";
    step.detail = detail;
    this.emit(this.snapshot());
  }

  private complete(id: StepId, detail?: string): void {
    const step = this.step(id);
    if (step.state === "done") return;
    step.state = "done";
    step.ms = Date.now() - this.stepStartedAt;
    this.stepStartedAt = Date.now();
    if (detail !== undefined) step.detail = detail;
    // Something is always in progress until Devin speaks.
    const next = ORDER.at(ORDER.indexOf(id) + 1);
    if (next !== undefined && this.step(next).state === "pending" && !this.finished) {
      this.activate(next, DEFAULT_DETAIL[next]);
      return;
    }
    this.emit(this.snapshot());
  }
}
