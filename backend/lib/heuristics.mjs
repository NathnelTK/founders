const ROASTS = [
  "Margins that thin would make a neighborhood shop look like a hedge fund.",
  "You described a whole market. Investors fund a focused customer segment and an experiment they can verify this week.",
  "Payment integration is not a moat. Reliability, dispute handling, and distribution are the product.",
  "If the pitch needs 'Uber for X' energy, the unit economics probably need a calculator, not a slogan.",
  "Hardware plus operations plus regulation is three startups. Pick the one that can prove demand this quarter."
];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function hashPitch(p) {
  const s = `${p.name}|${p.sector}|${p.market}|${p.pitch}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function marginAudit(p) {
  const price = Number(p.price) || 0;
  const cogs = Number(p.cogs) || 0;
  const cac = Number(p.cac) || 0;
  if (!price) {
    return {
      contribution: null,
      paybackUnits: null,
      note: "No unit price provided. Treat any investability score as directional, not underwritable."
    };
  }
  const contribution = price - cogs;
  const marginPct = (contribution / price) * 100;
  const paybackUnits = contribution > 0 && cac > 0 ? cac / contribution : null;
  let note;
  if (contribution <= 0) {
    note = "Negative contribution margin. You are paying customers to take the product.";
  } else if (marginPct < 25) {
    note = `Contribution margin ${marginPct.toFixed(1)}% is fragile once sales fees, failed deliveries, and currency costs hit.`;
  } else if (paybackUnits && paybackUnits > 8) {
    note = `CAC payback is ~${paybackUnits.toFixed(1)} units. In thin-trust markets that is a working-capital trap.`;
  } else {
    note = `Contribution margin ${marginPct.toFixed(1)}% is workable if collection is reliable and customer acquisition costs do not outpace revenue.`;
  }
  return { contribution, marginPct, paybackUnits, note };
}

export function heuristicsEvaluate(pitch) {
  const h = hashPitch(pitch);
  const skills = pitch.skills || [];
  const audit = marginAudit(pitch);
  const sectorBoost = /fintech|agri|health|logistics/i.test(pitch.sector || "") ? 6 : 0;
  const lengthBoost = clamp(Math.floor((pitch.pitch || "").length / 80), 0, 10);
  const skillGapPenalty = skills.length >= 3 ? 0 : 7;
  const economicsBoost = audit.contribution > 0 ? 8 : 0;
  const global = clamp(58 + sectorBoost + lengthBoost + economicsBoost - skillGapPenalty + (h % 9), 38, 92);
  const investability = clamp(global - 8 - (audit.contribution <= 0 ? 12 : 0) + (skills.includes("finance") ? 4 : 0), 22, 88);

  const missing = ["Engineering", "Growth/Sales", "Finance/Ops", "Domain Expert", "Product"].filter((role) => {
    const key = role.toLowerCase().split("/")[0];
    return !skills.some((s) => s.toLowerCase().includes(key.slice(0, 5)));
  }).slice(0, 3);

  return {
    engine: "heuristics",
    model: null,
    roast: pick(ROASTS, h),
    marketPotential: `${pitch.market || "the target market"} can support a wedge in ${pitch.sector || "this sector"} if you own a specific payment or distribution rail rather than a generic marketplace. Density of demand matters more than TAM slides.`,
    monetization: "Charge for a transaction or workflow customers already pay for. Subscriptions need a clear recurring benefit; transaction fees need reliable collection. Start with the payment and sales channels customers already use.",
    risks: [
      "Regulatory and identity-verification requirements for payments or sensitive data.",
      "Fulfillment and support costs eating contribution margin.",
      "Established competitors copying the feature before you build a durable advantage."
    ],
    suggestions: [
      "Name the first 50 paying users and how they already pay for this kind of product.",
      "Run a 14-day paid pilot with one geography and one SKU/workflow.",
      "Publish unit economics weekly: price, COGS, CAC, failed delivery, FX."
    ],
    roadmap: [
      { week: "Week 1", item: "Ten customer interviews in the target market; capture willingness-to-pay in the currency customers use." },
      { week: "Week 2", item: "Manual concierge MVP (WhatsApp/Telegram + spreadsheet) to prove collection." },
      { week: "Week 3", item: "Instrument unit economics and one distribution partner conversation." },
      { week: "Week 4", item: "Kill, narrow, or price-up based on actual cash collected, not survey warmth." }
    ],
    crowded: `Crowded: generic ${pitch.sector || "marketplace"} clones and pilots that never convert into repeatable revenue.`,
    opportunity: "Underserved: reconciliation, customer support, dispute resolution, and working-capital timing between businesses and customers.",
    confidence: clamp(45 + lengthBoost * 4 + (audit.contribution ? 10 : 0), 35, 86),
    missingSkills: missing,
    investorQuestion: `What existing alternatives does ${pitch.market || "this market"} already use, why are they insufficient, and what evidence can you collect in week one that proves your approach is better?`,
    regionalAnalysis: `Expanding beyond ${pitch.market || "your first market"} requires validating local regulations, customer expectations, operating costs, and available sales channels. Prove one focused market before expanding.`,
    scores: { global, investability },
    economics: audit,
    vcTakeaway: "Interesting if the wedge is operational and customers will pay for it. Not interesting as a slogan without evidence.",
    coreAdvice: "Shrink the story to one customer, one channel, and one number you can defend in an investor meeting."
  };
}

export function battleHeuristics(a, b) {
  const as = a.scores?.investability ?? 50;
  const bs = b.scores?.investability ?? 50;
  const winner = as === bs ? (a.name || "A") : as > bs ? (a.name || "A") : (b.name || "B");
  return {
    engine: "heuristics",
    winner,
    rationale: `${winner} wins on risk-adjusted collectability (investability ${Math.max(as, bs)} vs ${Math.min(as, bs)}). Prefer the concept with clearer unit economics and a more focused customer segment.`,
    axes: [
      { label: "Investability", a: as, b: bs },
      { label: "Global rating", a: a.scores?.global ?? 50, b: b.scores?.global ?? 50 },
      { label: "Confidence", a: a.confidence ?? 50, b: b.confidence ?? 50 }
    ]
  };
}
