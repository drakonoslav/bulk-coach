import type { InterventionPolicySummary } from "../lib/intervention-types";
import { listCandidateActions } from "../lib/intervention-candidates";
import {
  buildDecisionSummary,
  rankCandidateActions,
} from "../lib/intervention-decision";
import type { InterventionDecisionSummary } from "../lib/intervention-decision";

export function buildInterventionDecisionSummary(
  policy: InterventionPolicySummary,
): InterventionDecisionSummary {
  const currentState = policy.currentState;
  const candidates = listCandidateActions(currentState);
  const ranked = rankCandidateActions(candidates, currentState, policy);
  return buildDecisionSummary(ranked, policy);
}
