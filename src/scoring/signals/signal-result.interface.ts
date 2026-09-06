import type { ScoreReason } from '../../database/schema';

export interface SignalResult {
  penalty: number;
  reasons: ScoreReason[];
}
