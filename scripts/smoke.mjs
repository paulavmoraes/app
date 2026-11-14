// End-to-end smoke test: two flatmates on phone-sized browsers.
// Usage: start `npm run dev` on a fresh local DB (SETUP_TOKEN=dev-setup), then `node scripts/smoke.mjs [baseUrl] [screenshotDir]`.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:5173";
const SHOTS = process.argv[3];
const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], deviceScaleFactor: 1 };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (msg) => console.log(`• ${msg}`);

try {
  const a = await (await browser.newContext(phone)).newPage();
  step("Ana sets up the household");
  await a.goto(`${BASE}/setup?token=dev-setup`);
  await a.getByLabel("Household name").fill("Flat 4");
  await a.getByLabel("Your name").fill("Ana");
  await a.getByRole("button", { name: "Create household" }).click();
  await a.getByRole("heading", { name: "Hi Ana" }).waitFor();

  step("Ana invites Ben");
  await a.getByRole("link", { name: /Settings/ }).click();
  await a.getByRole("button", { name: "Invite a flatmate" }).click();
  const url = await a.getByLabel("Link").inputValue();

  const b = await (await browser.newContext(phone)).newPage();
  step("Ben joins via the link");
  await b.goto(url);
  await b.getByLabel("Your name").fill("Ben");
  await b.getByRole("button", { name: "Join" }).click();
  await b.getByRole("heading", { name: "Hi Ben" }).waitFor();
  await b.getByText("You're in!").waitFor();
  await shot(b, "ben-welcome");

  step("The invite link can't be reused");
  const c = await (await browser.newContext(phone)).newPage();
  await c.goto(url);
  await c.getByRole("heading", { name: "Link not valid" }).waitFor();

  step("Ana creates a daily rotation task and a quick tick");
  await a.goto(`${BASE}/tasks/new`);
  await a.getByLabel("Name").fill("Wash the sink");
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) await a.getByRole("button", { name: d, exact: true }).click();
  await a.getByText("Next occurrences").waitFor();
  const previewText = await a.locator("li", { hasText: /Ana|Ben/ }).allInnerTexts();
  if (!/Ana/.test(previewText[0]) || !/Ben/.test(previewText[1])) throw new Error(`rotation preview wrong: ${previewText}`);
  await shot(a, "task-form");
  await a.getByRole("button", { name: "Create" }).click();
  await a.getByText("Rotation: Ana → Ben").waitFor();
  await a.getByRole("link", { name: "+ New" }).click();
  await a.getByRole("button", { name: "Quick tick" }).click();
  await a.getByLabel("Name").fill("Take out the bins");
  await a.getByRole("button", { name: "Create" }).click();
  await a.getByText("Take out the bins").waitFor();

  step("Ana marks today's sink as done by Ben");
  await a.getByRole("link", { name: /Today/ }).click();
  await a.getByRole("button", { name: "Mark Wash the sink done" }).click();
  await a.getByRole("button", { name: "Ben" }).click();
  await a.getByRole("button", { name: "Mark done" }).click();
  await a.getByText("Done: Wash the sink").waitFor();
  await a.getByText("Nothing due for you today").waitFor();

  step("Undo puts it back, then complete again");
  await a.getByRole("button", { name: "Undo" }).click();
  await a.getByRole("button", { name: "Mark Wash the sink done" }).waitFor();
  await a.getByRole("button", { name: "Mark Wash the sink done" }).click();
  await a.getByRole("button", { name: "Mark done" }).click();
  await a.getByText("Nothing due for you today").waitFor();

  step("Ben ticks the bins");
  await b.reload();
  await b.getByRole("button", { name: /Take out the bins/ }).click();
  await b.getByText("Logged: Take out the bins").waitFor();
  await b.getByText(/just now · Ben/).waitFor();
  await shot(b, "ben-today");

  step("History shows both, with who did it");
  await a.getByRole("link", { name: /History/ }).click();
  await a.getByText("Take out the bins").waitFor();
  await a.getByText(/^Ana · due/).waitFor();
  await shot(a, "history");

  // ---- Phase 2: Home, Calendar, future-only edits
  step("Home groups tasks by person: tomorrow's sink is Ben's");
  await a.getByRole("link", { name: /Home/ }).click();
  const benSection = a.locator("section", { has: a.getByRole("heading", { name: "Ben" }) });
  await benSection.getByText("Wash the sink").waitFor();
  await shot(a, "home");

  step("Calendar month view, filtered by person");
  await a.getByRole("link", { name: /Calendar/ }).click();
  await a.getByRole("heading", { name: /\w+ \d{4}/ }).waitFor();
  await a.locator("li").getByText("Wash the sink").first().waitFor();
  await a.getByLabel("Filter by person").selectOption({ label: "Ben" });
  await a.getByRole("button", { name: "Next", exact: true }).click();
  const chips = await a.locator("li button").allInnerTexts();
  if (chips.some((t) => t.includes("Ana"))) throw new Error("person filter leaked Ana");
  await a.getByRole("button", { name: "Week" }).click();
  await shot(a, "calendar-week");
  await a.getByRole("button", { name: "Month" }).click();
  await a.getByRole("button", { name: "Today" }).click();
  await a.getByLabel("Filter by person").selectOption({ label: "Everyone" });
  await shot(a, "calendar-month");

  step("Edit: swap the rotation order; today's completed one is untouched, the rotation carries on");
  await a.getByRole("link", { name: /Tasks/ }).click();
  await a.getByRole("button", { name: "Edit" }).first().click();
  await a.getByText("Changes apply from today").waitFor();
  await a.getByRole("button", { name: "Move up" }).nth(1).click();
  await a.getByText("Next occurrences").waitFor();
  await shot(a, "edit-form");
  await a.getByRole("button", { name: "Save changes" }).click();
  await a.getByText("Rotation: Ben → Ana").waitFor();
  await a.getByRole("link", { name: /History/ }).click();
  await a.getByText(/^Ana · due/).waitFor();
  await a.getByRole("link", { name: /Home/ }).click();
  await a.locator("section", { has: a.getByRole("heading", { name: "Ben" }) }).getByText("Wash the sink").waitFor();

  console.log("SMOKE OK");
} catch (e) {
  console.error("SMOKE FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
