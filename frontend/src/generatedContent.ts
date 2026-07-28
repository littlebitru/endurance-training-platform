import type { TranslationKey } from "./i18n";
import type { Exercise, TrainingPlan, WeeklyPlan, Workout } from "./types";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

const goalKeys: Record<string, TranslationKey> = {
  run_5k: "goalRun5k",
  run_10k: "goalRun10k",
  run_half_marathon: "goalRunHalfMarathon",
  run_marathon: "goalRunMarathon",
  run_ultra_50k: "goalRunUltra50k",
  cycling_tt_20k: "goalCyclingTt20k",
  cycling_tt_40k: "goalCyclingTt40k",
  cycling_gran_fondo_100k: "goalCyclingGranFondo100k",
  cycling_gran_fondo_160k: "goalCyclingGranFondo160k",
  swim_400m: "goalSwim400m",
  swim_1500m: "goalSwim1500m",
  swim_open_water_3k: "goalSwimOpenWater3k",
  swim_open_water_5k: "goalSwimOpenWater5k",
  triathlon_sprint: "goalTriathlonSprint",
  triathlon_olympic: "goalTriathlonOlympic",
  triathlon_half: "goalTriathlonHalf",
  triathlon_full: "goalTriathlonFull",
};

const experienceKeys: Record<string, TranslationKey> = {
  beginner: "experienceBeginner",
  intermediate: "experienceIntermediate",
  advanced: "experienceAdvanced",
};

const phaseKeys: Record<string, TranslationKey> = {
  base: "phaseBase",
  build: "phaseBuild",
  peak: "phasePeak",
  taper: "phaseTaper",
  recovery: "phaseRecovery",
  race: "phaseRace",
};

const phaseNoteKeys: Record<string, TranslationKey> = {
  base: "phaseNoteBase",
  build: "phaseNoteBuild",
  peak: "phaseNotePeak",
  taper: "phaseNoteTaper",
  recovery: "phaseNoteRecovery",
  race: "phaseNoteRace",
};

const generatedPhaseNotes = new Set([
  "Develop aerobic durability and technical consistency.",
  "Increase race-specific quality while preserving aerobic volume.",
  "Practice race demands with controlled overall fatigue.",
  "Reduce volume while retaining short race-specific efforts.",
  "Absorb the previous training block with reduced volume and intensity.",
  "Prioritize freshness, race execution, and recovery.",
]);

const workoutTypeKeys: Record<string, TranslationKey> = {
  recovery: "typeRecovery",
  endurance: "typeEndurance",
  long: "typeLong",
  tempo: "typeTempo",
  threshold: "typeThreshold",
  intervals: "typeIntervals",
  vo2_max: "typeVo2Max",
  technique: "typeTechnique",
  brick: "typeBrick",
  race: "typeRace",
  strength: "typeStrength",
};

const sportKeys: Record<string, TranslationKey> = {
  running: "sportRunning",
  cycling: "sportCycling",
  swimming: "sportSwimming",
  triathlon: "sportTriathlon",
};

const generatedTypeLabels: Record<string, string> = {
  recovery: "Recovery",
  endurance: "Endurance",
  long: "Long",
  tempo: "Tempo",
  threshold: "Threshold",
  intervals: "Intervals",
  vo2_max: "Vo2 Max",
  technique: "Technique",
  brick: "Brick",
  race: "Race",
  strength: "Strength",
};

const generatedSportLabels: Record<string, string> = {
  running: "run",
  cycling: "ride",
  swimming: "swim",
  triathlon: "triathlon",
};

const exerciseNameKeys: Record<string, TranslationKey> = {
  "Warm-up": "stepWarmup",
  "Main set": "stepMainSet",
  "Main intervals": "stepMainIntervals",
  "Cool-down": "stepCooldown",
  "Bike race-specific block": "stepBikeRaceBlock",
  Transition: "stepTransition",
  "Run off the bike": "stepRunOffBike",
};

export function isPeriodizedPlan(plan: TrainingPlan): boolean {
  return plan.generation_method === "periodized"
    || plan.description.startsWith("Automatically periodized ");
}

export function localizeGeneratedPlanDescription(plan: TrainingPlan, t: Translate): string {
  if (!isPeriodizedPlan(plan)) return plan.description || t("noDescription");
  const parsedExperience = plan.description.match(/^Automatically periodized (beginner|intermediate|advanced) plan /)?.[1];
  const experience = plan.experience_level || parsedExperience || "intermediate";
  const goalKey = goalKeys[plan.target_event_type];
  const goal = goalKey ? t(goalKey) : plan.target_event_name || t("customEvent");
  return t("generatedPlanDescription", {
    experience: t(experienceKeys[experience] || "experienceIntermediate"),
    event: plan.target_event_name || goal,
    goal,
  });
}

export function localizeGeneratedWeekNote(plan: TrainingPlan, week: WeeklyPlan, t: Translate): string {
  const key = phaseNoteKeys[week.phase];
  if (
    isPeriodizedPlan(plan)
    && key
    && (!week.notes || generatedPhaseNotes.has(week.notes))
  ) {
    return t(key);
  }
  return week.notes;
}

export function localizeGeneratedWorkoutTitle(
  workout: Pick<Workout, "title" | "sport" | "workout_type">,
  t: Translate,
): string {
  const expectedTitle = `${generatedTypeLabels[workout.workout_type] || ""} ${generatedSportLabels[workout.sport] || ""}`.trim();
  const typeKey = workoutTypeKeys[workout.workout_type];
  const sportKey = sportKeys[workout.sport];
  if (!typeKey || !sportKey || workout.title.toLowerCase() !== expectedTitle.toLowerCase()) {
    return workout.title;
  }
  return t("generatedWorkoutTitle", { type: t(typeKey), sport: t(sportKey) });
}

export function localizeGeneratedWorkoutNotes(
  plan: TrainingPlan,
  week: WeeklyPlan,
  workout: Workout,
  t: Translate,
): string {
  if (
    !isPeriodizedPlan(plan)
    || !/^Generated (base|build|peak|taper|recovery|race) phase session for .+ Adjust after reviewing recovery and recent training response\.$/.test(workout.notes)
  ) {
    return workout.notes;
  }
  const goalKey = goalKeys[plan.target_event_type];
  const phaseKey = phaseKeys[week.phase];
  return t("generatedWorkoutNotes", {
    phase: phaseKey ? t(phaseKey) : week.phase,
    goal: goalKey ? t(goalKey) : plan.target_event_name || t("customEvent"),
  });
}

export function localizeGeneratedExerciseName(
  plan: TrainingPlan,
  exercise: Exercise,
  t: Translate,
): string {
  const key = exerciseNameKeys[exercise.name];
  return isPeriodizedPlan(plan) && key ? t(key) : exercise.name;
}
