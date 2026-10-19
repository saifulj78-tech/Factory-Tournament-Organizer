import { describe, expect, it } from "vitest";
import { hasRequiredGenders, isKnockoutTieClinched, isValidDreambreakerRotation, isValidRubberScore, pointsForTeamTie } from "./teamEvent";

describe("team event domain rules", () => {
  it("enforces mixed and doubles lineups", () => {
    expect(hasRequiredGenders("mixed_doubles", [{ gender: "male" }, { gender: "female" }])).toBe(true);
    expect(hasRequiredGenders("mixed_doubles", [{ gender: "male" }, { gender: "male" }])).toBe(false);
    expect(hasRequiredGenders("womens_doubles", [{ gender: "female" }, { gender: "female" }])).toBe(true);
  });
  it("accepts flexible game scores while validating best-of results", () => {
    expect(isValidRubberScore(21, 1, 21, 19)).toBe(true);
    expect(isValidRubberScore(21, 1, 21, 20)).toBe(true);
    expect(isValidRubberScore(21, 1, 7, 3)).toBe(true);
    expect(isValidRubberScore(21, 1, 4, 4)).toBe(false);
    expect(isValidRubberScore(21, 3, 2, 1)).toBe(true);
    expect(isValidRubberScore(21, 3, 1, 0)).toBe(false);
  });
  it("awards two points for a tie win, one for a draw, and none for a loss", () => {
    expect(pointsForTeamTie(3, 1)).toBe(2);
    expect(pointsForTeamTie(2, 2)).toBe(1);
    expect(pointsForTeamTie(1, 3)).toBe(0);
  });
  it("clinches a knockout tie only when the remaining rubbers cannot change the leader", () => {
    expect(isKnockoutTieClinched(2, 0, 1)).toBe(true);
    expect(isKnockoutTieClinched(1, 0, 1)).toBe(false);
    expect(isKnockoutTieClinched(2, 0, 2)).toBe(false);
    expect(isKnockoutTieClinched(0, 3, 2)).toBe(true);
  });
  it("requires two named men and two named women in a Dreambreaker rotation", () => {
    expect(isValidDreambreakerRotation([
      { id: 1, gender: "male" }, { id: 2, gender: "female" },
      { id: 3, gender: "male" }, { id: 4, gender: "female" },
    ])).toBe(true);
    expect(isValidDreambreakerRotation([
      { id: 1, gender: "male" }, { id: 1, gender: "female" },
      { id: 3, gender: "male" }, { id: 4, gender: "female" },
    ])).toBe(false);
  });
});