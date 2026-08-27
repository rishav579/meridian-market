import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  TRANSITION_AUTHORS,
  type OrderStatus,
} from "@/lib/constants";

describe("ORDER_TRANSITIONS (real state machine)", () => {
  it("defines a transition row for every known status", () => {
    for (const status of ORDER_STATUSES) {
      expect(Array.isArray(ORDER_TRANSITIONS[status])).toBe(true);
    }
  });

  it("only targets valid statuses and never the current status", () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUSES).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it("permits the full happy path PENDING → PAID → PROCESSING → SHIPPED → DELIVERED", () => {
    const path: OrderStatus[] = ["PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(ORDER_TRANSITIONS[path[i]]).toContain(path[i + 1]);
    }
  });

  it("makes DELIVERED and CANCELLED terminal", () => {
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("allows cancellation from every pre-delivery stage only", () => {
    expect(ORDER_TRANSITIONS.PENDING).toContain("CANCELLED");
    expect(ORDER_TRANSITIONS.PAID).toContain("CANCELLED");
    expect(ORDER_TRANSITIONS.PROCESSING).toContain("CANCELLED");
    expect(ORDER_TRANSITIONS.SHIPPED).not.toContain("CANCELLED");
  });
});

describe("TRANSITION_AUTHORS (who may set what)", () => {
  it("reserves PAID exclusively for payment webhook — no human role may set PAID", () => {
    expect(TRANSITION_AUTHORS.PAID).toEqual([]);
    expect(TRANSITION_AUTHORS.PAID).not.toContain("ADMIN");
    expect(TRANSITION_AUTHORS.PAID).not.toContain("CUSTOMER");
    expect(TRANSITION_AUTHORS.PAID).not.toContain("VENDOR");
  });

  it("lets vendors advance fulfilment but not customers", () => {
    for (const status of ["PROCESSING", "SHIPPED", "DELIVERED"] as OrderStatus[]) {
      expect(TRANSITION_AUTHORS[status]).toContain("VENDOR");
      expect(TRANSITION_AUTHORS[status]).not.toContain("CUSTOMER");
    }
  });

  it("lets customers cancel their own order", () => {
    expect(TRANSITION_AUTHORS.CANCELLED).toContain("CUSTOMER");
  });

  it("has no author rule for re-entering PENDING", () => {
    expect(TRANSITION_AUTHORS.PENDING).toBeUndefined();
  });
});
