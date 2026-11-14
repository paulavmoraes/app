import { asc } from "drizzle-orm";
import type { Db } from "../env";
import { awayPeriods, members } from "../db/schema";
import type { AssignCtx } from "../../domain/assign";

/** Loads household members (in order) and away periods into the domain's assignment context. */
export async function loadAssignCtx(db: Db): Promise<AssignCtx> {
  const [ms, away] = await Promise.all([
    db.select({ id: members.id }).from(members).orderBy(asc(members.sortOrder)),
    db.select().from(awayPeriods),
  ]);
  return {
    members: ms.map((m) => m.id),
    isAway: (memberId, date) => away.some((a) => a.memberId === memberId && a.startDate <= date && date <= a.endDate),
  };
}
