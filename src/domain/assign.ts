import type { ISODate } from "./dates";

export type Assignment = { mode: "fixed"; memberId: string } | { mode: "rotation"; order: string[] };

/** pointer: index into the rotation of who is next. cover: round-robin counter for away cover. */
export type AssignState = { pointer: number; cover: number };

export type AssignCtx = {
  /** All household members, in household order. */
  members: string[];
  isAway: (memberId: string, date: ISODate) => boolean;
};

export type Pick = {
  assigneeId: string;
  /** Who it would have been without away mode. */
  generatedAssigneeId: string;
  override: "away_cover" | null;
  /** Everyone eligible was away: kept the normal assignee and flagged it. */
  allAway: boolean;
  state: AssignState;
};

export function initialState(a: Assignment, startIndex = 0): AssignState {
  return { pointer: a.mode === "rotation" && a.order.length ? startIndex % a.order.length : 0, cover: 0 };
}

export function pickAssignee(a: Assignment, state: AssignState, date: ISODate, ctx: AssignCtx): Pick {
  if (a.mode === "fixed") {
    const fixed = a.memberId;
    if (!ctx.isAway(fixed, date)) {
      return { assigneeId: fixed, generatedAssigneeId: fixed, override: null, allAway: false, state };
    }
    const present = ctx.members.filter((m) => m !== fixed && !ctx.isAway(m, date));
    if (present.length === 0) {
      return { assigneeId: fixed, generatedAssigneeId: fixed, override: null, allAway: true, state };
    }
    return {
      assigneeId: present[state.cover % present.length],
      generatedAssigneeId: fixed,
      override: "away_cover",
      allAway: false,
      state: { ...state, cover: state.cover + 1 },
    };
  }

  const order = a.order;
  if (order.length === 0) throw new Error("rotation needs at least one member");
  const base = state.pointer % order.length;
  const generated = order[base];
  for (let i = 0; i < order.length; i++) {
    const idx = (base + i) % order.length;
    if (!ctx.isAway(order[idx], date)) {
      return {
        assigneeId: order[idx],
        generatedAssigneeId: generated,
        override: i > 0 ? "away_cover" : null,
        allAway: false,
        state: { ...state, pointer: (idx + 1) % order.length },
      };
    }
  }
  return {
    assigneeId: generated,
    generatedAssigneeId: generated,
    override: null,
    allAway: true,
    state: { ...state, pointer: (base + 1) % order.length },
  };
}
