// API-level scenario test for overdue → missed → penalty, swaps and away mode, using a simulated clock.
// Needs `npm run dev` on a FRESH local DB with SETUP_TOKEN=dev-setup and TEST_CLOCK=1 in .dev.vars.
// Usage: node scripts/rules.mjs [baseUrl]
import assert from "node:assert/strict";

const BASE = (process.argv[2] ?? "http://localhost:5173") + "/api";
let clock = "2026-11-16T10:00:00Z"; // Monday
const at = (d) => (clock = `${d}T10:00:00Z`);

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", "x-test-now": clock, cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const ok = async (p) => {
  const r = await p;
  assert.ok(r.status < 300, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const step = (m) => console.log(`• ${m}`);

const A = client(), B = client(), C = client();
await ok(A("POST", "/setup", { token: "dev-setup", householdName: "Flat", displayName: "Ana", color: "#0f766e" }));
for (const [cl, name, color] of [[B, "Ben", "#2563eb"], [C, "Cat", "#7c3aed"]]) {
  const { url } = await ok(A("POST", "/invites", { kind: "join" }));
  await ok(cl("POST", `/invites/${url.split("/join/")[1]}/accept`, { displayName: name, color }));
}
const members = await ok(A("GET", "/members"));
const [a, b, c] = members.map((m) => m.id);
const nm = { [a]: "A", [b]: "B", [c]: "C" };
const { id: dust } = await ok(A("POST", "/tasks", {
  kind: "recurring", name: "Dusting",
  schedule: { type: "weekdays", weekdays: [1, 4], startDate: "2026-11-16" },
  assignment: { mode: "rotation", order: [a, b, c] },
}));
const cal = async (from, to) =>
  (await ok(A("GET", `/calendar?from=${from}&to=${to}`))).occurrences
    .filter((o) => o.taskId === dust)
    .map((o) => `${o.date.slice(5)}:${nm[o.assigneeId]}${o.status === "pending" ? "" : `(${o.status})`}${o.override ? `[${o.override}]` : ""}`)
    .join(" ");
const occ = async (date) => (await ok(A("GET", `/calendar?from=${date}&to=${date}`))).occurrences.find((o) => o.taskId === dust);

step("Rotation: Tue A, Fri B, Tue C, Fri A");
assert.equal(await cal("2026-11-16", "2026-11-27"), "11-17:A 11-20:B 11-24:C 11-27:A");

step("Wed and Thu: Tuesday's task is overdue, not missed");
at("2026-11-18");
let t = await ok(A("GET", "/today"));
assert.deepEqual(t.overdue.map((o) => [o.date, o.daysOverdue, o.status]), [["2026-11-17", 1, "pending"]]);
at("2026-11-19");
t = await ok(A("GET", "/today"));
assert.equal(t.overdue[0].daysOverdue, 2);

step("Fri (next occurrence): Tuesday is missed, Ana takes Ben's Friday as an extra shift, rotation unchanged");
at("2026-11-20");
t = await ok(A("GET", "/today"));
assert.equal(t.overdue.length, 0);
assert.deepEqual(t.dueToday.map((o) => [o.date, o.override]), [["2026-11-20", "penalty"]]);
assert.equal(t.owedShifts, 0);
assert.equal((await ok(B("GET", "/today"))).dueToday.length, 0);
assert.equal(await cal("2026-11-16", "2026-11-27"), "11-17:A(missed) 11-20:A[penalty] 11-24:C 11-27:A");
const hist = await ok(A("GET", "/history"));
assert.ok(hist.items.some((i) => i.kind === "missed" && i.date === "2026-11-17" && i.assigneeId === a));

step("A missed occurrence can't be completed; the extra shift can");
assert.equal((await A("POST", `/occurrences/${(await occ("2026-11-17")).id}/complete`, {})).status, 409);
await ok(A("POST", `/occurrences/${(await occ("2026-11-20")).id}/complete`, {}));

step("Swap: only the assignee can propose; Cat hands Tue 24 to Ben, Ben accepts");
const tue24 = await occ("2026-11-24");
assert.equal((await A("POST", "/swaps", { occurrenceId: tue24.id, toMemberId: b })).status, 400);
const { id: swapId } = await ok(C("POST", "/swaps", { occurrenceId: tue24.id, toMemberId: b }));
assert.equal((await C("POST", "/swaps", { occurrenceId: tue24.id, toMemberId: a })).status, 409);
assert.equal((await ok(B("GET", "/swaps"))).length, 1);
assert.equal((await A("POST", `/swaps/${swapId}/accept`)).status, 400);
await ok(B("POST", `/swaps/${swapId}/accept`));
assert.equal(await cal("2026-11-24", "2026-12-04"), "11-24:B[swap] 11-27:A 12-01:B 12-04:C");
assert.equal((await ok(B("GET", "/swaps"))).length, 0);

step("Decline and cancel leave the shift where it was");
const fri27 = await occ("2026-11-27");
const s2 = await ok(A("POST", "/swaps", { occurrenceId: fri27.id, toMemberId: c }));
await ok(C("POST", `/swaps/${s2.id}/decline`));
const s3 = await ok(A("POST", "/swaps", { occurrenceId: fri27.id, toMemberId: c }));
await ok(A("POST", `/swaps/${s3.id}/cancel`));
assert.equal((await occ("2026-11-27")).assigneeId, a);

step("Whoever took the swap is responsible: Ben misses Tue 24, so Ben takes Ana's Fri 27");
at("2026-11-27");
assert.equal(await cal("2026-11-24", "2026-12-04"), "11-24:B(missed)[swap] 11-27:B[penalty] 12-01:B 12-04:C");

step("Away: Cat away 1–10 Dec → rotation skips her, nothing owed afterwards");
assert.equal(await cal("2026-12-01", "2026-12-15"), "12-01:B 12-04:C 12-08:A 12-11:B 12-15:C");
const { id: awayId } = await ok(C("POST", "/away", { startDate: "2026-12-01", endDate: "2026-12-10" }));
assert.equal(await cal("2026-12-01", "2026-12-15"), "12-01:B 12-04:A[away_cover] 12-08:B 12-11:C 12-15:A");
assert.equal((await C("POST", "/away", { startDate: "2026-12-05", endDate: "2026-12-20" })).status, 409);
assert.equal((await B("POST", "/swaps", { occurrenceId: (await occ("2026-12-08")).id, toMemberId: c })).status, 409);

step("Past rows are untouched by away changes; cancelling the trip restores the rotation");
assert.equal(await cal("2026-11-16", "2026-11-27"), "11-17:A(missed) 11-20:A(done)[penalty] 11-24:B(missed)[swap] 11-27:B[penalty]");
await ok(C("DELETE", `/away/${awayId}`));
assert.equal(await cal("2026-12-01", "2026-12-15"), "12-01:B 12-04:C 12-08:A 12-11:B 12-15:C");

step("Away on the day it would become missed: marked missed, but no extra shift");
await ok(B("POST", "/away", { startDate: "2026-12-01", endDate: "2026-12-03" }));
at("2026-12-01"); // Ben's Fri 27 penalty shift was never done; Tue 1 Dec arrives while Ben is away
assert.equal(await cal("2026-11-27", "2026-12-04"), "11-27:B(missed)[penalty] 12-01:C[away_cover] 12-04:A");
assert.equal((await ok(B("GET", "/today"))).owedShifts, 0);

step("Interval from last completion: never missed, just overdue; next counts from completion");
const { id: nes } = await ok(A("POST", "/tasks", {
  kind: "recurring", name: "Nespresso",
  schedule: { type: "interval", n: 1, unit: "week", anchor: "completion", startDate: "2026-12-01" },
  assignment: { mode: "fixed", memberId: a },
}));
at("2026-12-20");
t = await ok(A("GET", "/today"));
const n1 = t.overdue.find((o) => o.taskId === nes);
assert.deepEqual([n1.date, n1.daysOverdue, n1.status], ["2026-12-01", 19, "pending"]);
await ok(A("POST", `/occurrences/${n1.id}/complete`, {}));
const home = await ok(A("GET", "/home"));
assert.equal(home.groups.flatMap((g) => g.items).find((o) => o.taskId === nes).date, "2026-12-27");

console.log("RULES OK");
