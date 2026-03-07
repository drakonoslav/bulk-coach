import {
  listPendingOutcomeEvaluations,
  updateInterventionOutcome,
} from "./intervention-store";
import { buildCurrentInterventionStateFromExistingOutputs, ExistingInterventionOutputs } from "./intervention-engine";
import { buildOutcomeWindow } from "../lib/intervention-outcomes";
import { scoreInterventionEffectiveness } from "../lib/intervention-outcomes";
import type { InterventionExperience, InterventionOutcomeWindow } from "../lib/intervention-types";
import { getExperienceById } from "./intervention-store";

export async function evaluatePendingInterventionOutcomes(
  userId: string,
  buildOutputsForDate: (date: string) => Promise<ExistingInterventionOutputs | null>,
): Promise<{ evaluated: number; skipped: number }> {
  const pending = await listPendingOutcomeEvaluations(userId);
  let evaluated = 0;
  let skipped = 0;

  for (const item of pending) {
    for (const windowDays of item.missingWindows) {
      const targetDate = new Date(
        new Date(item.createdAt).getTime() + windowDays * 86400000,
      );
      const targetDateStr = targetDate.toISOString().slice(0, 10);

      const laterOutputs = await buildOutputsForDate(targetDateStr);
      if (!laterOutputs) {
        skipped++;
        continue;
      }

      const laterState = buildCurrentInterventionStateFromExistingOutputs(laterOutputs);
      const outcome = buildOutcomeWindow(item.state, laterState, windowDays);

      const exp = await getExperienceById(userId, item.id);
      if (!exp) {
        skipped++;
        continue;
      }

      const updatedExp: InterventionExperience = {
        ...exp,
        ...(windowDays === 3 ? { outcome3d: outcome } : {}),
        ...(windowDays === 7 ? { outcome7d: outcome } : {}),
        ...(windowDays === 14 ? { outcome14d: outcome } : {}),
      };

      const effectiveness = scoreInterventionEffectiveness(updatedExp);

      await updateInterventionOutcome(
        userId,
        item.id,
        windowDays,
        outcome,
        effectiveness,
      );

      evaluated++;
    }
  }

  return { evaluated, skipped };
}
