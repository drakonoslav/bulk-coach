import type { InterventionAction, InterventionStateSnapshot } from "./intervention-types";
import {
  actionAddRestDay,
  actionDeload,
  actionHoldSteady,
  actionIncreaseCarbs,
  actionReduceCardio,
  actionReduceVolume,
} from "./intervention-state";

export interface CandidateAction {
  key:
    | "HOLD_STEADY"
    | "DELOAD"
    | "REDUCE_VOLUME_20"
    | "ADD_REST_DAY"
    | "INCREASE_CARBS_40G"
    | "REDUCE_CARDIO_1_SESSION";
  action: InterventionAction;
}

export function listCandidateActions(
  _currentState: InterventionStateSnapshot,
): CandidateAction[] {
  return [
    {
      key: "HOLD_STEADY",
      action: actionHoldSteady("coach"),
    },
    {
      key: "DELOAD",
      action: actionDeload(2, "coach"),
    },
    {
      key: "REDUCE_VOLUME_20",
      action: actionReduceVolume(20, "coach"),
    },
    {
      key: "ADD_REST_DAY",
      action: actionAddRestDay(1, "coach"),
    },
    {
      key: "INCREASE_CARBS_40G",
      action: actionIncreaseCarbs(40, "coach"),
    },
    {
      key: "REDUCE_CARDIO_1_SESSION",
      action: actionReduceCardio(1, "coach"),
    },
  ];
}
