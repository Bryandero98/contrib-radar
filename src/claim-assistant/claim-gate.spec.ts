import { evaluateGate, MIN_CLAIM_SCORE, type GateInput } from './claim-gate';

function baseInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    hasAssignee: false,
    openCompetingPrCount: 0,
    sentimentLabel: null,
    score: 100,
    ...overrides,
  };
}

describe('evaluateGate', () => {
  it('passes cleanly (empty reasons) when nothing is wrong', () => {
    expect(evaluateGate(baseInput())).toEqual([]);
  });

  it('rejects an already-assigned issue', () => {
    expect(evaluateGate(baseInput({ hasAssignee: true }))).toEqual([
      'ALREADY_ASSIGNED',
    ]);
  });

  it('rejects when a competing PR is already open', () => {
    expect(evaluateGate(baseInput({ openCompetingPrCount: 1 }))).toEqual([
      'COMPETING_PR_OPEN',
    ]);
  });

  it('rejects a discouraged maintainer sentiment', () => {
    expect(evaluateGate(baseInput({ sentimentLabel: 'discouraged' }))).toEqual([
      'MAINTAINER_DISCOURAGED',
    ]);
  });

  it('rejects a stale_or_duplicate maintainer sentiment', () => {
    expect(
      evaluateGate(baseInput({ sentimentLabel: 'stale_or_duplicate' })),
    ).toEqual(['MAINTAINER_DISCOURAGED']);
  });

  it('does not reject encouraged or neutral sentiment', () => {
    expect(evaluateGate(baseInput({ sentimentLabel: 'encouraged' }))).toEqual(
      [],
    );
    expect(evaluateGate(baseInput({ sentimentLabel: 'neutral' }))).toEqual([]);
  });

  it('rejects a score below the floor, accepts one at or above it', () => {
    expect(evaluateGate(baseInput({ score: MIN_CLAIM_SCORE - 1 }))).toEqual([
      'SCORE_TOO_LOW',
    ]);
    expect(evaluateGate(baseInput({ score: MIN_CLAIM_SCORE }))).toEqual([]);
  });

  it('accumulates every failing reason, not just the first', () => {
    expect(
      evaluateGate(
        baseInput({
          hasAssignee: true,
          openCompetingPrCount: 2,
          sentimentLabel: 'discouraged',
          score: 0,
        }),
      ),
    ).toEqual([
      'ALREADY_ASSIGNED',
      'COMPETING_PR_OPEN',
      'MAINTAINER_DISCOURAGED',
      'SCORE_TOO_LOW',
    ]);
  });
});
