import { describe, expect, it } from "vitest";
import { matchScore, toProfileCard } from "./profile-card.js";
import type { ProfileText } from "./embed.js";

describe("matchScore", () => {
  it("maps similarity 1.0 to 100", () => {
    expect(matchScore(0)).toBe(100);
  });

  it("clips below the floor to 0", () => {
    expect(matchScore(0.75)).toBe(0);
    expect(matchScore(0.9)).toBe(0);
    expect(matchScore(1.0)).toBe(0);
  });

  it("maps the mid-range linearly", () => {
    expect(matchScore(0.37)).toBe(73);
    expect(matchScore(0.27)).toBe(96);
  });

  it("clips above the ceiling to 100", () => {
    expect(matchScore(0.1)).toBe(100);
  });

  it("matches the measured prod data points", () => {
    expect(matchScore(0.37)).toBeGreaterThan(70);
    expect(matchScore(0.73)).toBeLessThanOrEqual(5);
    expect(matchScore(0.68)).toBeLessThanOrEqual(10);
  });
});

describe("toProfileCard", () => {
  const content: ProfileText = {
    headline: { text: "Engineer" },
    summary: { text: "Backend dev." },
    experiences: [{ role: "Dev", company: "Acme", start: "2020", end: null, bullets: [] }],
    education: [],
    skills: [{ name: "Go" }],
    languages: [{ name: "English", level: "Fluent" }],
    contact: { city: "São Paulo" },
  };

  it("builds a card from content and distance", () => {
    const card = toProfileCard("id-1", "Ana", content, 0.37);

    expect(card.id).toBe("id-1");
    expect(card.name).toBe("Ana");
    expect(card.headline).toBe("Engineer");
    expect(card.match).toBe(73);
    expect(card.city).toBe("São Paulo");
  });
});
