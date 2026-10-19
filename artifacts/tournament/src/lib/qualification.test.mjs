import assert from "node:assert/strict";
import test from "node:test";
import { getBreakoutQualificationStatuses, getPositionFirstQualifierSeeds } from "./qualification.ts";

test("Top 6 default seeds put each group winner before any runner-up", () => {
  const groups = [[3, 2, 1], [6, 5, 4], [9, 8, 7]].map((ids) => ids.map((teamId) => ({ teamId })));
  const qualified = new Map([3, 2, 6, 5, 9, 8].map((id) => [id, "automatic"]));
  assert.deepEqual(getPositionFirstQualifierSeeds(groups, qualified), [3, 6, 9, 2, 5, 8]);
});

test("additional seeds retain their group position without advancing eliminated teams", () => {
  const groups = [[3, 2, 1], [6, 5, 4], [9, 8, 7]].map((ids) => ids.map((teamId) => ({ teamId })));
  const qualified = new Map([[3, "automatic"], [6, "automatic"], [9, "automatic"], [8, "additional"], [2, "additional"], [1, "additional"]]);
  assert.deepEqual(getPositionFirstQualifierSeeds(groups, qualified), [3, 6, 9, 2, 8, 1]);
});

test("both breakout brackets retain automatic and additional qualification indicators", () => {
  const statuses = getBreakoutQualificationStatuses([
    { qualifiers: [{ teamId: 3, position: 0 }, { teamId: 2, position: 1 }] },
    { qualifiers: [{ teamId: 6, position: 0 }, { teamId: 5, position: 1 }] },
  ], 1);
  assert.deepEqual([...statuses], [[3, "automatic"], [2, "additional"], [6, "automatic"], [5, "additional"]]);
  assert.equal(statuses.has(99), false);
  assert.equal(getBreakoutQualificationStatuses([], 1).size, 0);
});
