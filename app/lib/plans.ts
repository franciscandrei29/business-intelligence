// Shared plan constants - safe for client & server

export const PLAN_MODULES: Record<string, string[]> = {
  FREE: [
    "dashboard", "ask-ai", "analytics", "peaks", "statistics",
  ],
  STARTER: [
    "dashboard", "ask-ai", "analytics", "peaks", "statistics",
    "stock", "rfm", "cohorts", "ltv", "forecast", "compare",
  ],
  GROWTH: [
    "dashboard", "ask-ai", "analytics", "peaks", "statistics",
    "stock", "rfm", "cohorts", "ltv", "forecast", "compare",
    "churn", "bcg", "basket", "discounts", "refunds",
    "turnover", "fulfilment", "anomalies", "goals",
    "narrative", "shares", "profitability", "margin",
    "scale", "repeat", "stockout",
    "data-health", "audit", "annotations", "digest", "actions", "courier", "ads",
  ],
  SCALE: [
    "dashboard", "ask-ai", "analytics", "peaks", "statistics",
    "stock", "rfm", "cohorts", "ltv", "forecast", "compare",
    "churn", "bcg", "basket", "discounts", "refunds",
    "turnover", "fulfilment", "anomalies", "goals",
    "narrative", "shares", "profitability", "margin",
    "scale", "repeat", "stockout",
    "data-health", "audit", "annotations", "digest", "actions", "courier", "ads",
  ],
};

export const ALWAYS_ALLOWED = [
  "stores", "team", "settings", "pricing-analysis", "onboarding", "ai-advisor", "ask-ai", "statistics",
];

export const PLAN_LIMITS: Record<string, {
  maxStores: number;
  aiMessages: number;
  maxTeam: number;
  label: string;
  price: string;
  period: string;
  color: string;
}> = {
  FREE:    { maxStores: 1,  aiMessages: 3,   maxTeam: 1,  label: "Free",    price: "0",   period: "pentru totdeauna", color: "#5F5E5A" },
  STARTER: { maxStores: 1,  aiMessages: 50,  maxTeam: 1,  label: "Starter", price: "49",  period: "/ lună",         color: "#0369a1" },
  GROWTH:  { maxStores: 3,  aiMessages: -1,  maxTeam: 3,  label: "Growth",  price: "129", period: "/ lună",         color: "#D85A30" },
  SCALE:   { maxStores: 10, aiMessages: -1,  maxTeam: -1, label: "Scale",   price: "Custom", period: "ofertă personalizată", color: "#7c3aed" },
};

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}

export function getPlanModules(plan: string): string[] {
  return PLAN_MODULES[plan] || PLAN_MODULES.FREE;
}

export function isModuleAllowed(plan: string, moduleRoute: string): boolean {
  if (ALWAYS_ALLOWED.includes(moduleRoute)) return true;
  return getPlanModules(plan).includes(moduleRoute);
}
