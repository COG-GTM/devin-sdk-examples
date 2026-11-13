"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { BoardEvent, Card, Window } from "./card";

type Link = "connecting" | "live" | "reconnecting";

export interface BoardState {
  /** Every card the server knows, newest change first. */
  cards: Card[];
  /** This tab's link to the server. */
  link: Link;
  /** The server's link to Devin. */
  upstream: boolean;
  note: string | undefined;
  lastEventAt: number | undefined;
}

const RETRY_MS = 5_000;

const INITIAL: BoardState = {
  cards: [],
  link: "connecting",
  upstream: false,
  note: undefined,
  lastEventAt: undefined,
};

/**
 * The browser's copy of the board, fed by `/api/board/stream`. `EventSource`
 * reconnects on its own and the server answers every connection with a full
 * snapshot, so a dropped tab catches up without any bookkeeping here.
 */
class BoardStore {
  #cards = new Map<string, Card>();
  #state = INITIAL;
  #source: EventSource | undefined;
  readonly #listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): BoardState => this.#state;

  open(window: Window): void {
    this.close();
    const url = `/api/board/stream?window=${window}`;
    const source = new EventSource(url);
    source.onmessage = (message: MessageEvent<string>) => {
      this.#handle(JSON.parse(message.data) as BoardEvent);
    };
    source.onerror = () => {
      this.#commit({ link: "reconnecting" });
      if (source.readyState === EventSource.CLOSED) void this.#recover(source, url, window);
    };
    this.#source = source;
    this.#commit({ link: "connecting" });
  }

  close(): void {
    this.#source?.close();
    this.#source = undefined;
  }

  /**
   * `EventSource` stops for good on any non-200 without saying which, so ask
   * again: a 401 means log in, anything else is an outage to wait out.
   */
  async #recover(source: EventSource, url: string, window: Window): Promise<void> {
    const response = await fetch(url).catch(() => undefined);
    await response?.body?.cancel();
    if (response?.status === 401) {
      location.assign("/login");
      return;
    }
    setTimeout(() => {
      if (this.#source === source) this.open(window);
    }, RETRY_MS);
  }

  #handle(event: BoardEvent): void {
    switch (event.type) {
      case "snapshot":
        this.#cards = new Map(event.cards.map((card) => [card.id, card]));
        this.#commit({ link: "live", upstream: event.connected, note: event.note, cards: true });
        break;
      case "card":
        this.#cards.set(event.card.id, event.card);
        this.#commit({ link: "live", cards: true });
        break;
      case "connection":
        this.#commit({ link: "live", upstream: event.connected, note: event.note });
        break;
    }
  }

  #commit(patch: Partial<Omit<BoardState, "cards">> & { cards?: true }): void {
    const { cards, ...rest } = patch;
    this.#state = {
      ...this.#state,
      ...rest,
      lastEventAt: Date.now(),
      cards: cards === true ? [...this.#cards.values()].sort(byRecency) : this.#state.cards,
    };
    for (const listener of this.#listeners) listener();
  }
}

function byRecency(a: Card, b: Card): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

const store = new BoardStore();

export function useBoard(window: Window): BoardState {
  useEffect(() => {
    store.open(window);
    return () => {
      store.close();
    };
  }, [window]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => INITIAL);
}

/** The current time, refreshed every `everyMs`, for relative labels. */
export function useNow(everyMs: number): number {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, everyMs);
      return () => {
        clearInterval(timer);
      };
    },
    () => Math.floor(Date.now() / everyMs) * everyMs,
    () => 0,
  );
}
