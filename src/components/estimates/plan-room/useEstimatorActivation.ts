import { useEffect, useState } from "react";

export type EstimatorActivationStage =
  "loading" | "welcome" | "guided" | "takeoff" | "revision" | "hidden";

const validStages = new Set<EstimatorActivationStage>([
  "welcome",
  "guided",
  "takeoff",
  "revision",
  "hidden",
]);

const storageKey = (estimateId: string) => `overwatch.plan-room.activation.v1:${estimateId}`;

export function useEstimatorActivation(estimateId: string) {
  const [stage, setStage] = useState<EstimatorActivationStage>("loading");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(
        storageKey(estimateId),
      ) as EstimatorActivationStage | null;
      setStage(stored && validStages.has(stored) ? stored : "welcome");
    } catch {
      setStage("welcome");
    }
  }, [estimateId]);

  const choose = (nextStage: Exclude<EstimatorActivationStage, "loading" | "welcome">) => {
    setStage(nextStage);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(storageKey(estimateId), nextStage);
      } catch {
        // Private browsing or storage policies should never block takeoff work.
      }
    }
  };

  const openWelcome = () => setStage("welcome");
  const hide = () => choose("hidden");

  return {
    stage,
    welcomeOpen: stage === "welcome",
    checklistVisible: stage === "guided" || stage === "takeoff",
    choose,
    openWelcome,
    hide,
  };
}
