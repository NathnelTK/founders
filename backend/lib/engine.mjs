/**
 * Deterministic experimentation engine.
 *
 * Turns a startup hypothesis into the artefacts the Foundry loop needs:
 *   1. buildAssumptions  — falsifiable claims across Desirability / Viability / Feasibility
 *   2. buildCouncil      — five fixed founder perspectives on the same hypothesis
 *   3. computeDecision   — an evidence score and an explicit PROCEED / PIVOT / PERISH call
 *
 * Pure functions, no I/O, no model calls. This is the guaranteed fallback and the
 * baseline that Bedrock or a founder's own API key can refine — never the other way
 * around, so the product behaves identically with no keys and no network at all.
 *
 * Risk ratings are derived from signals actually present in the pitch (arithmetic,
 * named payment rails, stated skills, concrete channel words), not from randomness,
 * so two runs over the same hypothesis produce the same board.
 */

import { marginAudit } from "./heuristics.mjs";

const DESIRABILITY = "Desirability";
const VIABILITY = "Viability";
const FEASIBILITY = "Feasibility";

export const CATEGORIES = [DESIRABILITY, VIABILITY, FEASIBILITY];

export const STATUSES = ["unvalidated", "testing", "validated", "invalidated"];

/** Risk weights used by the evidence score. A wrong high-risk bet costs more. */
const RISK_WEIGHT = { High: 1.5, Medium: 1, Low: 0.6 };

/** Status contributions to the evidence score, before risk weighting. */
const STATUS_VALUE = { validated: 1, invalidated: -1, testing: 0.35, unvalidated: 0 };

function hash(input) {
  const s = String(input || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick(arr, seed) {
  return arr[seed % arr.length];
}

/** Counts how many of the given patterns appear in the haystack. */
function signals(haystack, patterns) {
  return patterns.reduce((n, re) => n + (re.test(haystack) ? 1 : 0), 0);
}

/** Turns a 0..1 strength into the risk that the assumption does NOT hold. */
function riskFromStrength(strength) {
  if (strength >= 0.62) return "Low";
  if (strength >= 0.3) return "Medium";
  return "High";
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(n);
}

/**
 * Builds the assumption board for a hypothesis.
 * @param {object} pitch normalised pitch ({name, sector, market, pitch, skills, price, cogs, cac})
 * @param {object} [evaluation] a prior evaluation; its economics audit is reused when present
 * @returns {Array<{id, category, claim, risk, experiment, evidenceHint}>}
 */
export function buildAssumptions(pitch, evaluation) {
  const text = `${pitch?.pitch || ""} ${pitch?.market || ""} ${pitch?.sector || ""}`.toLowerCase();
  const market = String(pitch?.market || "your target market").trim();
  const sector = String(pitch?.sector || "this sector").trim();
  const name = String(pitch?.name || "the concept").trim();
  const skills = Array.isArray(pitch?.skills) ? pitch.skills : [];
  const audit = evaluation?.economics || marginAudit(pitch || {});
  const price = money(pitch?.price);
  const seed = hash(`${pitch?.name}|${pitch?.market}|${pitch?.pitch}`);

  /* ── Signal strength, one number per theme ─────────────────────────────── */

  const painStrength = clamp01(
    0.25 +
      signals(text, [
        /spend(s)? hours/,
        /manual(ly)?/,
        /by hand/,
        /waste(s|d)? /,
        /error(s)? /,
        /reconcil/,
        /no visibility/,
        /out of stock/,
        /loses? (sales|customers|money)/,
        /complain/
      ]) *
        0.16
  );

  const urgencyStrength = clamp01(
    0.2 +
      signals(text, [
        /today/,
        /this (week|month|quarter)/,
        /daily/,
        /every (day|week|morning)/,
        /urgent/,
        /deadline/,
        /compliance/,
        /fine(s)? /
      ]) *
        0.15
  );

  const willingnessStrength = clamp01(
    (price ? 0.4 : 0.12) +
      signals(text, [
        /alread(y)? (pay|pays|spend|spends)/,
        /subscription/,
        /monthly/,
        /commission/,
        /take rate/,
        /paid/,
        /budget/
      ]) *
        0.15
  );

  const channelStrength = clamp01(
    0.18 +
      signals(text, [
        /whatsapp/,
        /telegram/,
        /instagram/,
        /facebook/,
        /tiktok/,
        /referral/,
        /agent(s)? /,
        /partner(ship)?/,
        /marketplace/,
        /retail/,
        /distributor/,
        /direct sales/,
        /field/
      ]) *
        0.16
  );

  const railStrength = clamp01(
    0.15 +
      signals(text, [
        /m-?pesa/,
        /telebirr/,
        /momo/,
        /paystack/,
        /flutterwave/,
        /stripe/,
        /paypal/,
        /adyen/,
        /card/,
        /bank transfer/,
        /cash on delivery/,
        /cod/,
        /ussd/,
        /mobile money/,
        /wallet/
      ]) *
        0.2
  );

  const regulationExposure = signals(text, [
    /fintech/,
    /payment/,
    /loan/,
    /credit/,
    /health/,
    /medical/,
    /patient/,
    /agri/,
    /food/,
    /logistics/,
    /insurance/,
    /kyc/,
    /licen[cs]e/
  ]);

  const complianceStrength = clamp01(
    0.34 +
      (/\b(licen[cs]e|regulat|kyc|compliance|permit)/.test(text) ? 0.3 : 0) +
      (regulationExposure >= 2 ? -0.18 : 0)
  );

  const teamStrength = clamp01(0.12 + skills.length * 0.16);

  const opsStrength = clamp01(
    0.3 +
      signals(text, [
        /pilot/,
        /concierge/,
        /manually/,
        /first (10|20|50|100)/,
        /one (city|metro|region|geography)/,
        /spreadsheet/,
        /inventory/,
        /delivery/,
        /support/
      ]) *
        0.13
  );

  const dataStrength = clamp01(
    0.3 +
      signals(text, [
        /api/,
        /open data/,
        /public data/,
        /catalog(ue)?/,
        /supplier/,
        /integration/,
        /scrape/,
        /export/
      ]) *
        0.14
  );

  /* ── Economics-derived strengths ───────────────────────────────────────── */

  const hasEconomics = audit && audit.contribution !== null && audit.contribution !== undefined;
  const marginStrength = clamp01(
    hasEconomics ? (audit.contribution > 0 ? clamp01(0.35 + (audit.marginPct || 0) / 100) : 0.05) : 0.22
  );
  const paybackStrength = clamp01(
    hasEconomics && audit.paybackUnits
      ? audit.paybackUnits <= 3
        ? 0.85
        : audit.paybackUnits <= 8
          ? 0.5
          : 0.2
      : 0.25
  );

  const assumptions = [];

  const add = (category, claim, strength, experiment, evidenceHint) => {
    assumptions.push({
      id: `${category[0].toLowerCase()}${assumptions.filter((a) => a.category === category).length + 1}`,
      category,
      claim,
      risk: riskFromStrength(strength),
      experiment,
      evidenceHint
    });
  };

  /* Desirability — will anyone want this? */
  add(
    DESIRABILITY,
    `${market} feels this problem sharply enough to change behaviour this quarter.`,
    painStrength,
    `Run 10 problem interviews with ${market}. Ask what they did the last time this broke, not what they would do.`,
    "Count the interviews where the problem occurred in the last 30 days, and what they did about it."
  );

  add(
    DESIRABILITY,
    urgencyStrength > 0.5
      ? "The cost of doing nothing is visible on a monthly number the buyer already tracks."
      : "The pain is urgent enough that a buyer acts before the next budgeting cycle.",
    urgencyStrength,
    "Ask each interviewee to name the line item or deadline this shows up in. If they cannot, it is a nice-to-have.",
    "One quote per customer naming the number or deadline this touches."
  );

  add(
    DESIRABILITY,
    price
      ? `At least 20 customers in ${market} will pay ${price} before the product is fully automated.`
      : `At least 20 customers in ${market} will pay a stated monthly fee before the product is automated.`,
    willingnessStrength,
    "Put a price in front of people: take a pre-order, a deposit, or a signed pilot at the real price.",
    "Number of paid commitments (not survey yeses), with the amount collected."
  );

  add(
    DESIRABILITY,
    `You can reach ${market} through one channel you already understand${sector ? ` for ${sector}` : ""}.`,
    channelStrength,
    "Pick the single most likely channel and send 50 outreach touches this week. Measure replies, not impressions.",
    "Reply rate and meetings booked from one channel, with the message you used."
  );

  /* Viability — can this become a business? */
  add(
    VIABILITY,
    hasEconomics
      ? `Contribution margin of ${(audit.marginPct ?? 0).toFixed(1)}% survives sales fees, failed delivery, and currency costs.`
      : "The unit price leaves enough contribution margin to cover sales and support.",
    marginStrength,
    "Rebuild the number with real invoices: price, COGS, transaction fee, refunds, and FX. Publish the margin weekly.",
    "A one-page margin model using actual collected revenue, not projections."
  );

  add(
    VIABILITY,
    hasEconomics && audit.paybackUnits
      ? `Customer acquisition cost pays back within ${Math.ceil(audit.paybackUnits)} units, not months of hope.`
      : "Customer acquisition cost pays back fast enough to fund growth without a second raise.",
    paybackStrength,
    "Track spend per channel against collected cash for two weeks. Kill the channel that cannot pay back in 8 units.",
    "CAC and payback per channel from real spend, not blended averages."
  );

  add(
    VIABILITY,
    railStrength > 0.5
      ? "Money arrives through a rail that settles in days and customers already trust."
      : "You can collect money reliably through a rail customers already use.",
    railStrength,
    "Take one real payment end to end and time the settlement. Do not count a signed contract as cash.",
    "A settled payment with the days-to-cash figure written down."
  );

  add(
    VIABILITY,
    regulationExposure >= 2
      ? `The regulatory posture for ${sector} does not block launch in ${market}.`
      : "Compliance and data obligations are small enough to start without a legal budget.",
    complianceStrength,
    "Write the one-page regulatory checklist for your first market. Get a 30-minute lawyer or regulator read.",
    "Named rules you must satisfy, and who confirmed them."
  );

  /* Feasibility — can this team build and run it? */
  add(
    FEASIBILITY,
    skills.length
      ? `The current team (${skills.join(", ")}) can ship a usable v1 without the missing role.`
      : "The current team can ship a usable v1 without a missing critical role.",
    teamStrength,
    "Scope the smallest version you can ship in 3 weeks with the people you have. Cut everything else in writing.",
    "A dated scope with owners, and what you explicitly cut."
  );

  add(
    FEASIBILITY,
    "Operations — support, fulfilment, and reconciliation — can be run by hand for the first 20 customers.",
    opsStrength,
    "Onboard 3 customers manually with a spreadsheet and a group chat. Record every minute of labour.",
    "Hours of manual labour per customer per week."
  );

  add(
    FEASIBILITY,
    "The data or access the wedge depends on is obtainable without a partner lock-in.",
    dataStrength,
    "Get the data yourself for one customer. If it needs a partner, get a written 30-day trial agreement.",
    "A working data path that does not depend on one gatekeeper."
  );

  return assumptions;
}

/* ── Founder Council ─────────────────────────────────────────────────────── */

const COUNCIL_ROLES = [
  {
    role: "Strategist",
    focus: "Positioning and moat",
    stance: "cautious"
  },
  { role: "CFO", focus: "Unit economics and cash", stance: "critical" },
  { role: "Validator", focus: "Evidence and experiments", stance: "cautious" },
  { role: "Builder", focus: "Feasibility and scope", stance: "supportive" },
  { role: "Skeptic", focus: "Why this fails", stance: "critical" }
];

/**
 * Builds five founder perspectives over the same hypothesis.
 * @returns {Array<{role, focus, stance, headline, critique, question}>}
 */
export function buildCouncil(pitch, evaluation, assumptions) {
  const market = String(pitch?.market || "your market").trim();
  const name = String(pitch?.name || "the concept").trim();
  const skills = Array.isArray(pitch?.skills) ? pitch.skills : [];
  const audit = evaluation?.economics || marginAudit(pitch || {});
  const highRisk = (assumptions || []).filter((a) => a.risk === "High");
  const topHighRisk = highRisk[0]?.claim || "the core demand claim";
  const hasEconomics = audit && audit.contribution !== null && audit.contribution !== undefined;
  const price = money(pitch?.price);

  const byRole = {
    Strategist: {
      headline: `"${name}" is a wedge, not a market — prove the wedge first.`,
      critique: `The risk is not whether ${market} has the problem; it is whether you own a specific distribution or data rail before a better-funded team copies the feature. Narrow to one corridor, one buyer, and one channel. ${topHighRisk} is the assumption that decides whether this becomes a position or a feature.`,
      question: `If a competitor with 50x your budget shipped this next quarter, what would you still own?`
    },
    CFO: {
      headline: hasEconomics
        ? `The arithmetic says ${
            audit.contribution <= 0
              ? "you are paying customers to take the product."
              : `${(audit.marginPct ?? 0).toFixed(1)}% contribution — workable only if collection is reliable.`
          }`
        : "There is no unit economics sheet yet, so there is no business yet.",
      critique: hasEconomics
        ? `Contribution per unit is ${audit.contribution}${price ? ` on a price of ${price}` : ""}${
            audit.paybackUnits ? `, with CAC payback around ${audit.paybackUnits.toFixed(1)} units` : ""
          }. Model the leak, not the plan: failed payments, refunds, support minutes, and FX. Cash timing kills more startups at this stage than pricing does.`
        : `You have not told me price, cost, or acquisition cost. Until then every score is directional. Put three numbers on one page and defend them.`,
      question: `What is your cash collected per customer in the first 30 days, after every leak?`
    },
    Validator: {
      headline: `${(assumptions || []).length} assumptions, ${highRisk.length} of them high-risk. Pick two.`,
      critique: `You cannot test everything. The board is telling you the demand claim and the pricing claim are the weak links. Run the two cheapest experiments that could kill the idea this week — a pre-payment and a manual concierge pilot — and let the result, not the deck, decide.`,
      question: `Which single result this week would make you stop, and are you willing to accept it?`
    },
    Builder: {
      headline: skills.length
        ? `Shippable — if you cut the scope to what ${skills.join(", ")} can actually finish.`
        : "Shippable — if you name the missing role and stop pretending it is not needed.",
      critique: `A 3-week manual version beats a 6-month platform. Start with a spreadsheet and a group chat, instrument the manual labour, and only automate the step customers pay for twice. ${skills.length < 3 ? "You are missing a critical role; decide whether to hire, partner, or deliberately de-scope around it." : "Your skill coverage is the strongest part of this plan — protect it from scope creep."}`,
      question: `What is the smallest version you can put in front of a paying customer in 21 days?`
    },
    Skeptic: {
      headline: topHighRisk,
      critique: `Here is the failure I would bet on: ${market} agrees the problem exists, sympathises, and never changes behaviour. The current alternatives are "good enough", and switching costs — habit, WhatsApp, the existing supplier relationship — are underestimated. Every founder says the market is underserved; almost none can show a customer who already tried to solve this themselves.`,
      question: `Show me one customer who has already tried to fix this on their own. What did they build?`
    }
  };

  return COUNCIL_ROLES.map((r) => ({ ...r, ...byRole[r.role] }));
}

/* ── Decision & Next Move ───────────────────────────────────────────────── */

/**
 * Evidence score and verdict from the current state of the assumption board.
 * The score is a weighted read of what is actually validated, not of optimism.
 */
export function computeDecision(assumptions) {
  const list = Array.isArray(assumptions) ? assumptions : [];
  const total = list.length;

  if (!total) {
    return {
      evidenceScore: 0,
      coverage: 0,
      verdict: "PIVOT",
      confidence: "low",
      rationale: "No assumptions recorded yet. Build the board before making a call.",
      drivers: [],
      nextSteps: [{ title: "Generate the assumption board", detail: "Analyse a hypothesis in the Workspace to populate the board." }]
    };
  }

  let weighted = 0;
  let weightSum = 0;
  let resolved = 0;
  const invalidatedHigh = [];
  const validatedHigh = [];
  const openHigh = [];

  for (const a of list) {
    const w = RISK_WEIGHT[a.risk] ?? 1;
    const v = STATUS_VALUE[a.status] ?? 0;
    weightSum += w;
    weighted += w * v;

    const isResolved = a.status === "validated" || a.status === "invalidated";
    if (isResolved) resolved += 1;

    if (a.risk === "High") {
      if (a.status === "invalidated") invalidatedHigh.push(a);
      else if (a.status === "validated") validatedHigh.push(a);
      else openHigh.push(a);
    }
  }

  const raw = weightSum ? weighted / weightSum : 0;
  const evidenceScore = Math.round(Math.max(3, Math.min(97, 50 + raw * 50)));
  const coverage = Math.round((resolved / total) * 100);

  let verdict;
  let rationale;

  if (invalidatedHigh.length) {
    verdict = "PERISH";
    rationale = `${invalidatedHigh.length} high-risk assumption${
      invalidatedHigh.length > 1 ? "s were" : " was"
    } invalidated. The evidence contradicts the core of this hypothesis — do not spend more runway on it as written.`;
  } else if (evidenceScore >= 65 && coverage >= 50) {
    verdict = "PROCEED";
    rationale = `Evidence score ${evidenceScore} with ${coverage}% of the board resolved and no high-risk assumption invalidated. Double down, but keep testing the ${openHigh.length} unproven high-risk claim${openHigh.length === 1 ? "" : "s"}.`;
  } else if (evidenceScore <= 38) {
    verdict = "PERISH";
    rationale = `Evidence score ${evidenceScore}. More assumptions are failing than passing — a pivot here is not a small edit, it is a different hypothesis.`;
  } else {
    verdict = "PIVOT";
    rationale =
      coverage < 35
        ? `Only ${coverage}% of the board is resolved. You are not ready to proceed — the call is to pivot toward testing the highest-risk claims first.`
        : `Evidence score ${evidenceScore} with ${coverage}% coverage. The hypothesis is not dead, but it is not fundable as written. Narrow it until the next result is decisive.`;
  }

  const confidence = coverage >= 70 ? "high" : coverage >= 35 ? "medium" : "low";

  const drivers = [];
  if (validatedHigh.length) drivers.push({ tone: "positive", text: `${validatedHigh.length} high-risk assumption${validatedHigh.length > 1 ? "s" : ""} validated.` });
  if (invalidatedHigh.length) drivers.push({ tone: "negative", text: `${invalidatedHigh[0].claim}` });
  if (openHigh.length) drivers.push({ tone: "neutral", text: `${openHigh.length} high-risk assumption${openHigh.length > 1 ? "s" : ""} still unproven.` });
  const testing = list.filter((a) => a.status === "testing");
  if (testing.length) drivers.push({ tone: "neutral", text: `${testing.length} experiment${testing.length > 1 ? "s" : ""} in flight.` });
  if (!drivers.length) drivers.push({ tone: "neutral", text: "Nothing resolved yet — evidence score is a baseline." });

  const nextSteps = [...openHigh, ...list.filter((a) => a.status === "testing"), ...list.filter((a) => a.status === "unvalidated" && a.risk === "Medium")]
    .slice(0, 3)
    .map((a) => ({ id: a.id, title: a.experiment, detail: a.claim }));

  if (!nextSteps.length) {
    nextSteps.push({
      title: "Re-read the board end to end",
      detail: "Every assumption is resolved. Re-run the analysis with what you now know and check whether the hypothesis has shifted."
    });
  }

  return { evidenceScore, coverage, verdict, confidence, rationale, drivers, nextSteps };
}

/** Convenience: the artefacts the API and UI both need for one hypothesis. */
export function buildAnalysis(pitch, evaluation) {
  const assumptions = buildAssumptions(pitch, evaluation);
  const council = buildCouncil(pitch, evaluation, assumptions);
  const decision = computeDecision(assumptions);
  return { assumptions, council, decision };
}
