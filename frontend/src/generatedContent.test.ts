import { expect, test } from "vitest";
import {
  localizeGeneratedExerciseName,
  localizeGeneratedPlanDescription,
  localizeGeneratedWeekNote,
  localizeGeneratedWorkoutNotes,
  localizeGeneratedWorkoutTitle,
} from "./generatedContent";
import type { TranslationKey } from "./i18n";
import type { TrainingPlan } from "./types";

const messages: Partial<Record<TranslationKey, string>> = {
  customEvent: "Своя дистанция",
  experienceIntermediate: "Средний",
  generatedPlanDescription: "План {experience} для {event}: {goal}",
  generatedWorkoutNotes: "Тренировка {phase} для {goal}",
  generatedWorkoutTitle: "{type} · {sport}",
  goalRun5k: "5 км",
  noDescription: "Нет описания",
  phaseBase: "База",
  phaseNoteBase: "Развитие аэробной выносливости.",
  sportRunning: "бег",
  stepWarmup: "Разминка",
  typeEndurance: "Базовая",
};

const t = (key: TranslationKey, values: Record<string, string | number> = {}) =>
  Object.entries(values).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, String(value)),
    messages[key] ?? key,
  );

const plan = {
  id: 1,
  coach: 1,
  athlete: 2,
  title: "5 km",
  description: "Automatically periodized intermediate plan for City 5K: 5 km. The coach must review the generated workload against athlete readiness and availability.",
  primary_sport: "running",
  target_event_name: "City 5K",
  target_event_type: "run_5k",
  target_distance_km: "5.00",
  generation_method: "periodized",
  experience_level: "intermediate",
  start_date: "2026-08-03",
  end_date: "2026-09-14",
  is_active: true,
  publication_status: "published",
  published_at: "2026-07-28T00:00:00Z",
  weeks: [],
} satisfies TrainingPlan;

test("localizes structured content from an existing periodized plan", () => {
  const week = {
    id: 2,
    training_plan: 1,
    week_number: 1,
    start_date: "2026-08-03",
    phase: "base",
    planned_duration_minutes: 260,
    is_recovery: false,
    notes: "Develop aerobic durability and technical consistency.",
    workouts: [],
  };
  const workout = {
    id: 3,
    weekly_plan: 2,
    title: "Endurance run",
    sport: "running",
    workout_type: "endurance",
    status: "planned",
    scheduled_at: "2026-08-04T07:00:00Z",
    planned_duration_minutes: 45,
    planned_distance_km: "8.00",
    intensity: "Z2",
    notes: "Generated base phase session for 5 km. Adjust after reviewing recovery and recent training response.",
    exercises: [],
    coach_comments: [],
  };
  const exercise = {
    id: 4,
    workout: 3,
    name: "Warm-up",
    step_type: "warmup",
    order: 1,
    description: "",
    repetitions: null,
    duration_seconds: 600,
    distance_meters: null,
    recovery_seconds: null,
    target_type: "pace",
    target_min: "1",
    target_max: "2",
    target_unit: "zone",
    resolved_target_min: null,
    resolved_target_max: null,
    resolved_target_unit: "",
    resolved_target_label: "",
  };

  expect(localizeGeneratedPlanDescription(plan, t)).toBe("План Средний для City 5K: 5 км");
  expect(localizeGeneratedWeekNote(plan, week, t)).toBe("Развитие аэробной выносливости.");
  expect(localizeGeneratedWorkoutTitle(workout, t)).toBe("Базовая · бег");
  expect(localizeGeneratedWorkoutNotes(plan, week, workout, t)).toBe("Тренировка База для 5 км");
  expect(localizeGeneratedExerciseName(plan, exercise, t)).toBe("Разминка");
});

test("preserves coach-authored plan and workout text", () => {
  const manualPlan = { ...plan, description: "Coach objective", generation_method: "manual" as const };
  const customWorkout = {
    title: "Hill repetitions",
    sport: "running",
    workout_type: "intervals",
  };

  expect(localizeGeneratedPlanDescription(manualPlan, t)).toBe("Coach objective");
  expect(localizeGeneratedWorkoutTitle(customWorkout, t)).toBe("Hill repetitions");
});
