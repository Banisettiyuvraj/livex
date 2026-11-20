import { describe, expect, it } from "vitest";
import {
  SESSION_TRANSITIONS,
  canTransition,
} from "../../src/session/SessionState";
import type { SessionState } from "../../src/types/media";

const ALL_STATES: SessionState[] = [
  "idle",
  "ready",
  "live",
  "paused",
  "completed",
  "error",
];

describe("canTransition", () => {
  it("always allows a self-transition", () => {
    for (const state of ALL_STATES) {
      expect(canTransition(state, state)).toBe(true);
    }
  });

  it("allows the documented happy path through a session", () => {
    expect(canTransition("idle", "ready")).toBe(true);
    expect(canTransition("ready", "live")).toBe(true);
    expect(canTransition("live", "paused")).toBe(true);
    expect(canTransition("paused", "live")).toBe(true);
    expect(canTransition("live", "completed")).toBe(true);
    expect(canTransition("completed", "ready")).toBe(true);
    expect(canTransition("completed", "idle")).toBe(true);
    expect(canTransition("ready", "idle")).toBe(true);
  });

  it("allows error from every state that can be playing", () => {
    expect(canTransition("idle", "error")).toBe(true);
    expect(canTransition("ready", "error")).toBe(true);
    expect(canTransition("live", "error")).toBe(true);
    expect(canTransition("paused", "error")).toBe(true);
  });

  it("rejects jumping straight from idle to live", () => {
    // A file must be loaded (idle → ready) before a session can start.
    expect(canTransition("idle", "live")).toBe(false);
    expect(canTransition("idle", "paused")).toBe(false);
    expect(canTransition("idle", "completed")).toBe(false);
  });

  it("rejects starting a session directly from completed", () => {
    expect(canTransition("completed", "live")).toBe(false);
  });

  it("rejects leaving error without going through ready or idle", () => {
    expect(canTransition("error", "live")).toBe(false);
    expect(canTransition("error", "paused")).toBe(false);
    expect(canTransition("error", "completed")).toBe(false);
  });

  it("rejects completing from a state that never played", () => {
    expect(canTransition("ready", "completed")).toBe(false);
    expect(canTransition("paused", "completed")).toBe(false);
  });

  it("keeps every declared transition consistent with the table", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (from === to) continue;
        const declared = SESSION_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(declared);
      }
    }
  });

  it("declares no duplicate targets", () => {
    for (const state of ALL_STATES) {
      const targets = SESSION_TRANSITIONS[state];
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});
