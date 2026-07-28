import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import {
  localizeGeneratedExerciseName,
  localizeGeneratedPlanDescription,
  localizeGeneratedWeekNote,
  localizeGeneratedWorkoutNotes,
  localizeGeneratedWorkoutTitle,
} from "./generatedContent";
import { localizeApiError, useLanguage } from "./i18n";
import type {
  AthleteThreshold,
  Relationship,
  TrainingGoalProfile,
  TrainingPlan,
  TrainingZone,
  WeeklyPlan,
  Workout,
  WorkoutTemplate,
} from "./types";

type Editor =
  | { kind: "plan" }
  | { kind: "week"; plan: TrainingPlan }
  | { kind: "workout"; week: WeeklyPlan; planSport: string; athleteId: number; scheduledDate?: string; workout?: Workout }
  | { kind: "exercise"; workout: Workout }
  | { kind: "comment"; workout: Workout }
  | { kind: "log"; workout: Workout };

interface StepDraft {
  id: number;
  stepType: string;
  name: string;
  repetitions: string;
  durationMinutes: string;
  distanceMeters: string;
  recoverySeconds: string;
  targetType: string;
  targetMin: string;
  targetMax: string;
  targetUnit: string;
  description: string;
}

interface ThresholdDraft {
  thresholdHeartRate: string;
  maximumHeartRate: string;
  ftp: string;
  thresholdPace: string;
  css: string;
}

interface SavedDestination {
  planId: number;
  calendarDate?: string;
  athleteId?: number;
}

const EMPTY_THRESHOLD: ThresholdDraft = {
  thresholdHeartRate: "",
  maximumHeartRate: "",
  ftp: "",
  thresholdPace: "",
  css: "",
};

let stepId = 0;

function createStep(values: Partial<StepDraft>): StepDraft {
  stepId += 1;
  return {
    id: stepId,
    stepType: "work",
    name: "",
    repetitions: "1",
    durationMinutes: "5",
    distanceMeters: "",
    recoverySeconds: "",
    targetType: "free",
    targetMin: "",
    targetMax: "",
    targetUnit: "",
    description: "",
    ...values,
  };
}

function compactForm(form: HTMLFormElement): Record<string, string | boolean> {
  const payload: Record<string, string | boolean> = {};
  new FormData(form).forEach((value, key) => {
    const normalized = String(value).trim();
    if (normalized) payload[key] = normalized;
  });
  return payload;
}

function localDateTime(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateOffset(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function nextMonday(): string {
  const value = new Date();
  const daysUntilMonday = (8 - value.getDay()) % 7 || 7;
  value.setDate(value.getDate() + daysUntilMonday);
  return dateKey(value);
}

function addDaysToDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

const GOAL_LABEL_KEYS = {
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
} as const;

function dateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPaceSeconds(value: number | null): string {
  if (!value) return "";
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function parsePaceValue(value: string): number | null {
  if (!value.trim()) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[2]) > 59) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function thresholdDraftFrom(profile?: AthleteThreshold): ThresholdDraft {
  if (!profile) return { ...EMPTY_THRESHOLD };
  return {
    thresholdHeartRate: profile.threshold_heart_rate ? String(profile.threshold_heart_rate) : "",
    maximumHeartRate: profile.maximum_heart_rate ? String(profile.maximum_heart_rate) : "",
    ftp: profile.functional_threshold_power ? String(profile.functional_threshold_power) : "",
    thresholdPace: formatPaceSeconds(profile.threshold_pace_seconds_per_km),
    css: formatPaceSeconds(profile.critical_swim_speed_seconds_per_100m),
  };
}

function stepFromExercise(step: Workout["exercises"][number]): StepDraft {
  return createStep({
    stepType: step.step_type,
    name: step.name,
    repetitions: String(step.repetitions ?? 1),
    durationMinutes: step.duration_seconds ? String(step.duration_seconds / 60) : "",
    distanceMeters: step.distance_meters ? String(step.distance_meters) : "",
    recoverySeconds: step.recovery_seconds ? String(step.recovery_seconds) : "",
    targetType: step.target_type,
    targetMin: step.target_min ?? "",
    targetMax: step.target_max ?? "",
    targetUnit: step.target_unit,
    description: step.description,
  });
}

function stepFromTemplate(step: Record<string, string | number | null>): StepDraft {
  return createStep({
    stepType: String(step.step_type ?? "work"),
    name: String(step.name ?? ""),
    repetitions: String(step.repetitions ?? 1),
    durationMinutes: step.duration_seconds ? String(Number(step.duration_seconds) / 60) : "",
    distanceMeters: step.distance_meters ? String(step.distance_meters) : "",
    recoverySeconds: step.recovery_seconds ? String(step.recovery_seconds) : "",
    targetType: String(step.target_type ?? "free"),
    targetMin: step.target_min == null ? "" : String(step.target_min),
    targetMax: step.target_max == null ? "" : String(step.target_max),
    targetUnit: String(step.target_unit ?? ""),
    description: String(step.description ?? ""),
  });
}

function weekDays(startDate: string): Date[] {
  const start = new Date(`${startDate}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

const SPORT_IDS = ["running", "cycling", "swimming", "triathlon"] as const;
const SPORT_MARKS: Record<string, string> = {
  running: "RUN",
  cycling: "BIKE",
  swimming: "SWIM",
  triathlon: "TRI",
};

const WORKOUT_TYPES_BY_SPORT: Record<string, string[]> = {
  running: ["recovery", "endurance", "long", "tempo", "threshold", "intervals", "vo2_max", "race", "strength"],
  cycling: ["recovery", "endurance", "long", "tempo", "threshold", "intervals", "vo2_max", "race", "strength"],
  swimming: ["recovery", "technique", "endurance", "threshold", "intervals", "race", "strength"],
  triathlon: ["recovery", "endurance", "long", "tempo", "threshold", "intervals", "brick", "race", "strength"],
};

function preferredTargetType(sport: string, zones: TrainingZone[]): string {
  const available = new Set(zones.map((zone) => zone.metric));
  if (sport === "cycling") return available.has("power") ? "power" : available.has("heart_rate") ? "heart_rate" : "power";
  if (sport === "running" || sport === "swimming") return available.has("pace") ? "pace" : available.has("heart_rate") ? "heart_rate" : "pace";
  return "heart_rate";
}

function resolvedZoneRange(zones: TrainingZone[], metric: string, start: string, end: string): string {
  const minimum = Number(start);
  const maximum = Number(end || start);
  const selected = zones.filter((zone) => zone.metric === metric && zone.zone_number >= minimum && zone.zone_number <= maximum);
  if (!selected.length) return "";
  const zoneLabel = minimum === maximum ? `Z${minimum}` : `Z${minimum}–Z${maximum}`;
  if (selected.length === 1) return `${zoneLabel} · ${selected[0].display_range}`;
  const values = selected.flatMap((zone) => [Number(zone.lower_bound), Number(zone.upper_bound)]);
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  const unit = selected[0].unit;
  if (unit === "sec/km" || unit === "sec/100m") {
    const format = (value: number) => `${Math.floor(value / 60)}:${String(Math.round(value) % 60).padStart(2, "0")}`;
    return `${zoneLabel} · ${format(lower)}–${format(upper)} ${unit === "sec/km" ? "/km" : "/100m"}`;
  }
  return `${zoneLabel} · ${Math.round(lower)}–${Math.round(upper)} ${unit}`;
}

function displayName(relationship: Relationship): string {
  const athlete = relationship.athlete;
  return `${athlete.first_name} ${athlete.last_name}`.trim() || athlete.username;
}

function planTimestamp(plan: TrainingPlan): number {
  const value = plan.updated_at || plan.created_at || `${plan.start_date}T00:00:00`;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? plan.id : timestamp;
}

export function sortPlansByRecency(plans: TrainingPlan[]): TrainingPlan[] {
  return [...plans].sort((left, right) => {
    const difference = planTimestamp(right) - planTimestamp(left);
    return difference || right.id - left.id;
  });
}

type PlanLibraryFilter = "current" | "all" | "draft" | "published" | "archived";

export function PlanLibrary({
  plans,
  selectedPlanId,
  athleteNames,
  isCoach,
  onSelect,
}: {
  plans: TrainingPlan[];
  selectedPlanId: number | null;
  athleteNames: Map<number, string>;
  isCoach: boolean;
  onSelect: (planId: number) => void;
}) {
  const { locale, t } = useLanguage();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlanLibraryFilter>("current");
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filteredPlans = plans.filter((plan) => {
    if (filter === "current" && plan.publication_status === "archived") return false;
    if (filter !== "all" && filter !== "current" && plan.publication_status !== filter) return false;
    if (!normalizedQuery) return true;
    const searchValue = [
      plan.title,
      plan.target_event_name,
      plan.target_event_type,
      athleteNames.get(plan.athlete) ?? "",
    ].join(" ").toLocaleLowerCase(locale);
    return searchValue.includes(normalizedQuery);
  });
  const filters: PlanLibraryFilter[] = isCoach
    ? ["current", "all", "draft", "published", "archived"]
    : ["current", "all", "published", "archived"];
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";

  return (
    <section className="plan-library" aria-labelledby="plan-library-title">
      <div className="plan-library-heading">
        <div>
          <span className="eyebrow">{t("planLibrary")}</span>
          <h3 id="plan-library-title">{t("chooseTrainingPlan")}</h3>
          <p>{t("planLibraryIntro")}</p>
        </div>
        <span className="plan-library-count">{plans.length}</span>
      </div>
      <div className="plan-library-tools">
        <label>
          <span>{t("searchPlans")}</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlansPlaceholder")}
            type="search"
            value={query}
          />
        </label>
        <div className="plan-library-filters" role="group" aria-label={t("planStatusFilter")}>
          {filters.map((value) => (
            <button
              className={filter === value ? "active" : ""}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value === "current" ? t("currentPlans") : value === "all" ? t("allPlans") : t(value)}
            </button>
          ))}
        </div>
      </div>
      {filteredPlans.length ? (
        <div className="plan-library-list">
          {filteredPlans.map((plan) => {
            const sessions = plan.weeks.reduce((total, week) => total + week.workouts.length, 0);
            const selected = plan.id === selectedPlanId;
            return (
              <button
                aria-pressed={selected}
                className={`plan-library-card ${plan.primary_sport} ${selected ? "selected" : ""}`}
                key={plan.id}
                onClick={() => onSelect(plan.id)}
                type="button"
              >
                <span className="plan-library-card-top">
                  <i>{SPORT_MARKS[plan.primary_sport] ?? "ACT"}</i>
                  <span className={`status publication-status ${plan.publication_status}`}>{t(plan.publication_status)}</span>
                </span>
                {isCoach && <small>{athleteNames.get(plan.athlete) || t("athlete")}</small>}
                <strong>{plan.title}</strong>
                <span className="plan-library-goal">{plan.target_event_name || t("trainingPlan")}</span>
                <span className="plan-library-meta">
                  {new Date(`${plan.start_date}T12:00:00`).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                  {" — "}
                  {new Date(`${plan.end_date}T12:00:00`).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" })}
                </span>
                <span className="plan-library-sessions">{t("sessionsCount", { count: sessions })}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="plan-library-empty">{t("noMatchingPlans")}</div>
      )}
    </section>
  );
}

export function EditorPanel({
  editor,
  relationships,
  onClose,
  onSaved,
}: {
  editor: Editor;
  relationships: Relationship[];
  onClose: () => void;
  onSaved: (message: string, destination?: SavedDestination) => Promise<void>;
}) {
  const { t } = useLanguage();
  const activeRelationships = relationships.filter((item) => item.is_active);
  const initialPlanRelationship = editor.kind === "plan" && activeRelationships.length === 1
    ? activeRelationships[0]
    : undefined;
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const editingWorkout = editor.kind === "workout" ? editor.workout : undefined;
  const [planMode, setPlanMode] = useState<"automatic" | "manual">("automatic");
  const [availableDays, setAvailableDays] = useState([0, 2, 4, 6]);
  const [workoutSport, setWorkoutSport] = useState(editingWorkout?.sport ?? (editor.kind === "workout" ? editor.planSport : ""));
  const [workoutType, setWorkoutType] = useState(editingWorkout?.workout_type ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(editingWorkout?.exercises.map(stepFromExercise) ?? []);
  const [zones, setZones] = useState<TrainingZone[]>([]);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [planAthleteId, setPlanAthleteId] = useState(initialPlanRelationship ? String(initialPlanRelationship.athlete.id) : "");
  const [planSport, setPlanSport] = useState(initialPlanRelationship?.athlete.profile?.sport || "");
  const [planThreshold, setPlanThreshold] = useState<ThresholdDraft>({ ...EMPTY_THRESHOLD });
  const [planZones, setPlanZones] = useState<TrainingZone[]>([]);
  const [planProfileExists, setPlanProfileExists] = useState(false);
  const [planProfileLoading, setPlanProfileLoading] = useState(false);
  const [goalProfiles, setGoalProfiles] = useState<TrainingGoalProfile[]>([]);
  const [goalProfilesLoading, setGoalProfilesLoading] = useState(false);
  const [targetEventType, setTargetEventType] = useState("");
  const [experienceLevel, setExperienceLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [weeklyHours, setWeeklyHours] = useState("6");
  const [taperWeeks, setTaperWeeks] = useState("2");
  const [planStartDate, setPlanStartDate] = useState(() => nextMonday());
  const [eventDate, setEventDate] = useState(() => dateOffset(84));

  useEffect(() => {
    if (editor.kind !== "workout" || !workoutSport) return;
    let active = true;
    setZonesLoading(true);
    api.trainingZones(editor.athleteId, workoutSport)
      .then((response) => {
        if (!active) return;
        setZones(response.results);
        const targetType = preferredTargetType(workoutSport, response.results);
        setSteps((current) => current.map((step) => step.targetUnit === "zone" ? { ...step, targetType } : step));
      })
      .catch(() => { if (active) setZones([]); })
      .finally(() => { if (active) setZonesLoading(false); });
    return () => { active = false; };
  }, [editor, workoutSport]);

  useEffect(() => {
    if (editor.kind !== "workout") return;
    api.workoutTemplates()
      .then((response) => setTemplates(response.results))
      .catch(() => setTemplates([]));
  }, [editor]);

  useEffect(() => {
    if (editor.kind !== "plan" || !planAthleteId || !planSport) {
      setPlanThreshold({ ...EMPTY_THRESHOLD });
      setPlanZones([]);
      setPlanProfileExists(false);
      return;
    }
    let active = true;
    setPlanProfileLoading(true);
    api.thresholds(Number(planAthleteId))
      .then((response) => {
        if (!active) return;
        const profile = response.results.find((item) => item.sport === planSport && item.is_current);
        setPlanThreshold(thresholdDraftFrom(profile));
        setPlanZones(profile?.zones ?? []);
        setPlanProfileExists(Boolean(profile));
      })
      .catch(() => {
        if (!active) return;
        setPlanThreshold({ ...EMPTY_THRESHOLD });
        setPlanZones([]);
        setPlanProfileExists(false);
      })
      .finally(() => { if (active) setPlanProfileLoading(false); });
    return () => { active = false; };
  }, [editor, planAthleteId, planSport]);

  useEffect(() => {
    if (editor.kind !== "plan" || !planSport) {
      setGoalProfiles([]);
      setTargetEventType("");
      return;
    }
    let active = true;
    setGoalProfilesLoading(true);
    api.trainingGoals(planSport)
      .then((profiles) => {
        if (!active) return;
        setGoalProfiles(profiles);
        setTargetEventType((current) => (
          profiles.some((profile) => profile.code === current) ? current : profiles[0]?.code ?? ""
        ));
      })
      .catch((caught) => {
        if (!active) return;
        setGoalProfiles([]);
        setTargetEventType("");
        setError(localizeApiError((caught as Error).message, t));
      })
      .finally(() => { if (active) setGoalProfilesLoading(false); });
    return () => { active = false; };
  }, [editor, planSport, t]);

  const selectedGoal = useMemo(
    () => goalProfiles.find((profile) => profile.code === targetEventType),
    [goalProfiles, targetEventType],
  );
  const minimumPreparationWeeks = selectedGoal?.minimum_weeks ?? (targetEventType === "custom" ? 8 : 6);

  useEffect(() => {
    if (selectedGoal) {
      setWeeklyHours(String(selectedGoal.recommended_weekly_minutes[experienceLevel] / 60));
      setTaperWeeks(String(selectedGoal.recommended_taper_weeks));
      return;
    }
    if (targetEventType === "custom") {
      const customWeeklyMinutes = { beginner: 300, intermediate: 420, advanced: 540 };
      setWeeklyHours(String(customWeeklyMinutes[experienceLevel] / 60));
      setTaperWeeks("2");
    }
  }, [experienceLevel, selectedGoal, targetEventType]);

  useEffect(() => {
    if (!selectedGoal && targetEventType !== "custom") return;
    setEventDate(addDaysToDate(planStartDate, minimumPreparationWeeks * 7));
  }, [minimumPreparationWeeks, planStartDate, selectedGoal, targetEventType]);

  const titles = {
    plan: t("createPlan"),
    week: t("addWeek"),
    workout: editingWorkout ? t("editWorkout") : t("addWorkout"),
    exercise: t("addExercise"),
    comment: t("addComment"),
    log: t("markComplete"),
  };

  const workoutTypeLabels: Record<string, string> = {
    recovery: t("typeRecovery"),
    endurance: t("typeEndurance"),
    long: t("typeLong"),
    tempo: t("typeTempo"),
    threshold: t("typeThreshold"),
    intervals: t("typeIntervals"),
    vo2_max: t("typeVo2Max"),
    technique: t("typeTechnique"),
    brick: t("typeBrick"),
    race: t("typeRace"),
    strength: t("typeStrength"),
  };

  function makeTemplate(type: string, sport: string): StepDraft[] {
    const targetType = preferredTargetType(sport, zones);
    const zoneStep = (
      name: string,
      stepType: string,
      durationMinutes: number,
      zoneMin: number,
      zoneMax = zoneMin,
      repetitions = 1,
      recoverySeconds = 0,
      description = "",
    ) => createStep({
      name,
      stepType,
      durationMinutes: String(durationMinutes),
      repetitions: String(repetitions),
      recoverySeconds: recoverySeconds ? String(recoverySeconds) : "",
      targetType,
      targetMin: String(zoneMin),
      targetMax: String(zoneMax),
      targetUnit: "zone",
      description,
    });
    const warmup = zoneStep(t("stepWarmup"), "warmup", 12, 1, 2);
    const cooldown = zoneStep(t("stepCooldown"), "cooldown", 10, 1);

    if (type === "recovery") return [zoneStep(t("stepRecovery"), "steady", 40, 1)];
    if (type === "long") return [warmup, zoneStep(t("stepMainSet"), "steady", 90, 2), cooldown];
    if (type === "tempo") return [warmup, zoneStep(t("stepMainSet"), "work", 15, 3, 3, 2, 180), cooldown];
    if (type === "threshold") return [warmup, zoneStep(t("stepThreshold"), "work", 8, 4, 4, 4, 180), cooldown];
    if (type === "intervals") return [warmup, zoneStep(t("stepIntervals"), "work", 3, 5, 5, 6, 120), cooldown];
    if (type === "vo2_max") return [warmup, zoneStep(t("stepVo2Max"), "work", 4, 5, 5, 5, 240), cooldown];
    if (type === "technique") return [warmup, zoneStep(t("stepTechnique"), "drill", 2, 2, 2, 8, 30), cooldown];
    if (type === "brick") {
      return [
        zoneStep(t("stepBike"), "steady", 50, 2, 3),
        createStep({ stepType: "recovery", name: t("stepTransition"), durationMinutes: "5" }),
        zoneStep(t("stepRun"), "work", 25, 3),
      ];
    }
    if (type === "race") return [warmup, zoneStep(t("stepRace"), "work", 60, 4, 5), cooldown];
    if (type === "strength") {
      return [
        createStep({ stepType: "warmup", name: t("stepWarmup"), durationMinutes: "10" }),
        createStep({ stepType: "work", name: t("stepStrength"), repetitions: "3", durationMinutes: "10", recoverySeconds: "120" }),
        createStep({ stepType: "cooldown", name: t("stepCooldown"), durationMinutes: "5" }),
      ];
    }
    return [warmup, zoneStep(t("stepMainSet"), "steady", 40, 2), cooldown];
  }

  function selectSport(sport: string) {
    setWorkoutSport(sport);
    if (workoutType && (WORKOUT_TYPES_BY_SPORT[sport] || []).includes(workoutType)) {
      setSteps(makeTemplate(workoutType, sport));
    } else {
      setWorkoutType("");
      setSteps([]);
    }
  }

  function selectWorkoutType(type: string) {
    setWorkoutType(type);
    setSteps(makeTemplate(type, workoutSport));
  }

  function loadTemplate(templateId: string) {
    const template = templates.find((item) => String(item.id) === templateId);
    if (!template) return;
    setWorkoutSport(template.sport);
    setWorkoutType(template.workout_type);
    setSteps(template.structured_steps.map(stepFromTemplate));
  }

  function updateStep(id: number, field: keyof StepDraft, value: string) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, [field]: value } : step)));
  }

  function updateTargetType(id: number, targetType: string) {
    setSteps((current) => current.map((step) => {
      if (step.id !== id) return step;
      if (["heart_rate", "pace", "power"].includes(targetType)) {
        return { ...step, targetType, targetMin: step.targetMin || "2", targetMax: step.targetMax || step.targetMin || "2", targetUnit: "zone" };
      }
      return { ...step, targetType, targetMin: targetType === "rpe" ? "5" : "", targetMax: targetType === "rpe" ? "5" : "", targetUnit: targetType === "rpe" ? "RPE" : "" };
    }));
  }

  function zoneNumbers(targetType: string): number[] {
    const available = zones.filter((zone) => zone.metric === targetType).map((zone) => zone.zone_number);
    return available.length ? available : [1, 2, 3, 4, 5];
  }

  function updatePlanThreshold(field: keyof ThresholdDraft, value: string) {
    setPlanThreshold((current) => ({ ...current, [field]: value }));
  }

  function toggleTrainingDay(day: number) {
    setAvailableDays((current) => {
      if (current.includes(day)) return current.filter((item) => item !== day);
      if (current.length >= 6) return current;
      return [...current, day].sort();
    });
  }

  function goalLabel(profile: TrainingGoalProfile) {
    const key = GOAL_LABEL_KEYS[profile.code as keyof typeof GOAL_LABEL_KEYS];
    return key ? t(key) : profile.label;
  }

  const planTargetMetric = planSport ? preferredTargetType(planSport, planZones) : "";
  const planPreviewZones = planZones.filter(
    (zone) => zone.metric === planTargetMetric && [2, 4].includes(zone.zone_number),
  );

  const structuredDuration = Math.max(1, Math.ceil(steps.reduce((total, step) => {
    const repetitions = Number(step.repetitions) || 1;
    const workSeconds = (Number(step.durationMinutes) || 0) * 60 * repetitions;
    const recoverySeconds = (Number(step.recoverySeconds) || 0) * Math.max(0, repetitions - 1);
    return total + workSeconds + recoverySeconds;
  }, 0) / 60));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const payload = compactForm(event.currentTarget);

    if (editor.kind === "workout" && (!workoutSport || !workoutType || !steps.length)) {
      setError(t("completeWorkoutStructure"));
      setSubmitting(false);
      return;
    }

    try {
      if (editor.kind === "plan") {
        if (planMode === "automatic" && availableDays.length < 3) {
          setError(t("selectAtLeastThreeDays"));
          setSubmitting(false);
          return;
        }
        if (planMode === "automatic" && !targetEventType) {
          setError(t("selectTargetEventType"));
          setSubmitting(false);
          return;
        }
        const thresholdPace = parsePaceValue(planThreshold.thresholdPace);
        const css = parsePaceValue(planThreshold.css);
        const profileComplete =
          (planSport === "running" && Boolean(thresholdPace))
          || (planSport === "cycling" && Boolean(planThreshold.ftp))
          || (planSport === "swimming" && Boolean(css))
          || (planSport === "triathlon" && Boolean(planThreshold.thresholdHeartRate || planThreshold.maximumHeartRate));
        if (Number.isNaN(thresholdPace) || Number.isNaN(css)) {
          setError(t("paceFormatError"));
          setSubmitting(false);
          return;
        }
        if (!profileComplete) {
          setError(t("completeThresholdProfile"));
          setSubmitting(false);
          return;
        }
        const thresholdProfile = {
          threshold_heart_rate: planThreshold.thresholdHeartRate ? Number(planThreshold.thresholdHeartRate) : null,
          maximum_heart_rate: planThreshold.maximumHeartRate ? Number(planThreshold.maximumHeartRate) : null,
          functional_threshold_power: planSport === "cycling" ? Number(planThreshold.ftp) : null,
          threshold_pace_seconds_per_km: planSport === "running" ? thresholdPace : null,
          critical_swim_speed_seconds_per_100m: planSport === "swimming" ? css : null,
        };
        if (planMode === "automatic") {
          const generatedPlan = await api.generatePlan({
            athlete: Number(planAthleteId),
            title: String(payload.title),
            primary_sport: planSport,
            start_date: String(payload.start_date),
            event_date: String(payload.event_date),
            event_name: String(payload.event_name),
            target_event_type: targetEventType,
            target_distance_km: targetEventType === "custom" ? Number(payload.custom_distance_km) : undefined,
            weekly_minutes: Math.round(Number(weeklyHours) * 60),
            available_days: availableDays,
            recovery_every: Number(payload.recovery_every),
            taper_weeks: Number(taperWeeks),
            experience_level: experienceLevel,
            threshold_profile: thresholdProfile,
          });
          await onSaved(t("planGenerated"), {
            calendarDate: generatedPlan.start_date,
            athleteId: generatedPlan.athlete,
            planId: generatedPlan.id,
          });
        } else {
          const createdPlan = await api.createPlan({
            athlete: Number(planAthleteId),
            title: String(payload.title),
            description: String(payload.description ?? ""),
            primary_sport: planSport,
            start_date: String(payload.start_date),
            end_date: String(payload.end_date),
            is_active: true,
            threshold_profile: thresholdProfile,
          });
          await onSaved(t("planCreated"), { planId: createdPlan.id });
        }
      } else if (editor.kind === "week") {
        await api.createWeek({ ...payload, training_plan: editor.plan.id });
        await onSaved(t("weekCreated"));
      } else if (editor.kind === "workout") {
        const structuredSteps = steps.map((step, index) => {
          const exercise: Record<string, string | number> = {
            order: index + 1,
            name: step.name,
            step_type: step.stepType,
            repetitions: Number(step.repetitions) || 1,
            duration_seconds: Math.round((Number(step.durationMinutes) || 0) * 60),
            target_type: step.targetType,
            description: step.description,
          };
          if (step.distanceMeters) exercise.distance_meters = Number(step.distanceMeters);
          if (step.recoverySeconds) exercise.recovery_seconds = Number(step.recoverySeconds);
          if (step.targetMin) exercise.target_min = step.targetMin;
          if (step.targetMax) exercise.target_max = step.targetMax;
          if (step.targetUnit) exercise.target_unit = step.targetUnit;
          return exercise;
        });
        const workoutPayload = {
          ...payload,
          weekly_plan: editor.week.id,
          planned_duration_minutes: structuredDuration,
          scheduled_at: new Date(String(payload.scheduled_at)).toISOString(),
          structured_steps: structuredSteps,
        };
        if (editor.workout) {
          await api.updateWorkout(editor.workout.id, workoutPayload);
          await onSaved(t("workoutUpdated"));
        } else {
          await api.createWorkout(workoutPayload);
          await onSaved(t("workoutCreated"));
        }
      } else if (editor.kind === "exercise") {
        await api.createExercise({ ...payload, workout: editor.workout.id });
        await onSaved(t("exerciseCreated"));
      } else if (editor.kind === "comment") {
        await api.createComment({ ...payload, workout: editor.workout.id });
        await onSaved(t("commentCreated"));
      } else {
        await api.logWorkout({
          ...payload,
          workout: editor.workout.id,
          completed_at: new Date(String(payload.completed_at)).toISOString(),
        });
        await onSaved(t("completionRecorded"));
      }
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
      setSubmitting(false);
    }
  }

  return (
    <div className="editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="editor-title" aria-modal="true" className={`editor-panel ${editor.kind === "workout" ? "workout-builder-panel" : editor.kind === "plan" ? "plan-builder-panel" : ""}`} role="dialog">
        <div className="editor-head">
          <div><span className="eyebrow">{t("trainingWorkspace")}</span><h2 id="editor-title">{titles[editor.kind]}</h2></div>
          <button aria-label={t("close")} className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <form className="editor-form" onSubmit={submit}>
          {editor.kind === "plan" && (
            <>
              <div className="plan-mode-switch" role="tablist" aria-label={t("planCreationMode")}>
                <button aria-selected={planMode === "automatic"} className={planMode === "automatic" ? "active" : ""} onClick={() => setPlanMode("automatic")} role="tab" type="button"><strong>{t("smartPlan")}</strong><small>{t("smartPlanText")}</small></button>
                <button aria-selected={planMode === "manual"} className={planMode === "manual" ? "active" : ""} onClick={() => setPlanMode("manual")} role="tab" type="button"><strong>{t("manualPlan")}</strong><small>{t("manualPlanText")}</small></button>
              </div>
              <div className="plan-wizard-progress" aria-label={t("planSetupProgress")}>
                <span className={planAthleteId ? "complete" : "active"}><b>1</b>{t("athleteAndSport")}</span>
                <i />
                <span className={planAthleteId && planSport ? "active" : ""}><b>2</b>{t("personalIntensity")}</span>
                <i />
                <span><b>3</b>{t("planGoalAndDates")}</span>
              </div>

              <fieldset className="builder-fieldset plan-builder-section">
                <legend><b>1</b>{t("athleteAndSport")}</legend>
                <label>{t("selectAthlete")}<select name="athlete" onChange={(event) => {
                  const athleteId = event.target.value;
                  const relationship = activeRelationships.find((item) => String(item.athlete.id) === athleteId);
                  setPlanAthleteId(athleteId);
                  setPlanSport(relationship?.athlete.profile?.sport || "");
                }} required value={planAthleteId}><option value="" disabled>{t("selectAthlete")}</option>{activeRelationships.map((item) => <option key={item.id} value={item.athlete.id}>{displayName(item)}</option>)}</select></label>
                <span className="fieldset-label">{t("primarySport")}</span>
                <div className="sport-choice-grid">
                  {SPORT_IDS.map((sport) => (
                    <label className={`${sport} ${planSport === sport ? "selected" : ""}`} key={sport}>
                      <input checked={planSport === sport} name="primary_sport" onChange={() => setPlanSport(sport)} required type="radio" value={sport} />
                      <i>{SPORT_MARKS[sport]}</i><span><strong>{t(`sport${sport[0].toUpperCase()}${sport.slice(1)}` as "sportRunning")}</strong><small>{t("selectPlanSportHelp")}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {planAthleteId && planSport && (
                <fieldset className="builder-fieldset plan-builder-section intensity-profile-section">
                  <legend><b>2</b>{t("personalIntensity")}</legend>
                  <div className={`auto-profile-status ${planProfileExists ? "connected" : "new"}`}>
                    <span>{planProfileLoading ? "…" : planProfileExists ? "✓" : "AUTO"}</span>
                    <div><strong>{planProfileExists ? t("existingProfileLoaded") : t("newProfileRequired")}</strong><p>{planProfileExists ? t("existingProfileLoadedText") : t("newProfileRequiredText")}</p></div>
                  </div>
                  <div className="threshold-form-grid compact-threshold-grid">
                    <label>{t("thresholdHeartRate")}<input max="240" min="80" onChange={(event) => updatePlanThreshold("thresholdHeartRate", event.target.value)} placeholder="172" type="number" value={planThreshold.thresholdHeartRate} /><small>{t("thresholdHeartRateHelp")}</small></label>
                    <label>{t("maximumHeartRate")}<input max="240" min="100" onChange={(event) => updatePlanThreshold("maximumHeartRate", event.target.value)} placeholder="190" type="number" value={planThreshold.maximumHeartRate} /><small>{t("maximumHeartRateHelp")}</small></label>
                    {planSport === "cycling" && <label>{t("functionalThresholdPower")}<input max="1000" min="50" onChange={(event) => updatePlanThreshold("ftp", event.target.value)} placeholder="250" required type="number" value={planThreshold.ftp} /><small>{t("functionalThresholdPowerHelp")}</small></label>}
                    {planSport === "running" && <label>{t("thresholdRunningPace")}<input onChange={(event) => updatePlanThreshold("thresholdPace", event.target.value)} pattern="[0-9]{1,2}:[0-9]{2}" placeholder="4:20" required value={planThreshold.thresholdPace} /><small>{t("thresholdRunningPaceHelp")}</small></label>}
                    {planSport === "swimming" && <label>{t("criticalSwimSpeed")}<input onChange={(event) => updatePlanThreshold("css", event.target.value)} pattern="[0-9]{1,2}:[0-9]{2}" placeholder="1:40" required value={planThreshold.css} /><small>{t("criticalSwimSpeedHelp")}</small></label>}
                  </div>
                  {planSport === "triathlon" && <p className="discipline-note">{t("triathlonThresholdRequired")}</p>}
                  {planPreviewZones.length > 0 && <div className="plan-zone-preview"><span>{t("currentAutomaticTargets")}</span>{planPreviewZones.map((zone) => <strong key={zone.id}>Z{zone.zone_number} · {zone.display_range}</strong>)}</div>}
                  <p className="calculation-note">{t("planZonesCalculatedOnSave")}</p>
                </fieldset>
              )}

              <fieldset className="builder-fieldset plan-builder-section">
                <legend><b>3</b>{t("planGoalAndDates")}</legend>
                <label>{t("planTitle")}<input name="title" required /></label>
                {planMode === "automatic" ? (
                  <>
                    <label>{t("targetEventType")}
                      <select
                        disabled={goalProfilesLoading || !planSport}
                        onChange={(event) => setTargetEventType(event.target.value)}
                        required
                        value={targetEventType}
                      >
                        <option disabled value="">{goalProfilesLoading ? t("loading") : t("selectTargetEventType")}</option>
                        {goalProfiles.map((profile) => (
                          <option key={profile.code} value={profile.code}>{goalLabel(profile)}</option>
                        ))}
                        <option value="custom">{t("customEvent")}</option>
                      </select>
                    </label>
                    {targetEventType === "custom" && (
                      <label>{t("customDistance")}<input min="0.1" name="custom_distance_km" required step="0.1" type="number" /></label>
                    )}
                    <label>{t("targetEvent")}<input name="event_name" placeholder={t("targetEventPlaceholder")} required /></label>
                    <div className="form-grid">
                      <label>{t("startDate")}<input name="start_date" onChange={(event) => setPlanStartDate(event.target.value)} type="date" value={planStartDate} min={dateOffset(0)} required /></label>
                      <label>{t("eventDate")}<input name="event_date" onChange={(event) => setEventDate(event.target.value)} type="date" value={eventDate} min={addDaysToDate(planStartDate, minimumPreparationWeeks * 7)} required /></label>
                    </div>
                    <div className="auto-plan-grid">
                      <label>{t("plannedPeakVolume")}<input max="30" min="2" onChange={(event) => setWeeklyHours(event.target.value)} step="0.5" type="number" value={weeklyHours} required /><small>{t("plannedPeakVolumeHelp")}</small></label>
                      <label>{t("experienceLevel")}<select onChange={(event) => setExperienceLevel(event.target.value as "beginner" | "intermediate" | "advanced")} value={experienceLevel}><option value="beginner">{t("experienceBeginner")}</option><option value="intermediate">{t("experienceIntermediate")}</option><option value="advanced">{t("experienceAdvanced")}</option></select></label>
                      <label>{t("recoveryCycle")}<select defaultValue="4" name="recovery_every"><option value="3">{t("everyThirdWeek")}</option><option value="4">{t("everyFourthWeek")}</option></select></label>
                      <label>{t("taperDuration")}<select onChange={(event) => setTaperWeeks(event.target.value)} value={taperWeeks}><option value="1">1 {t("weekUnit")}</option><option value="2">2 {t("weeksUnit")}</option><option value="3">3 {t("weeksUnit")}</option></select></label>
                    </div>
                    {selectedGoal && (
                      <div className="goal-recommendation">
                        <span>{t("goalRecommendation")}</span>
                        <strong>{goalLabel(selectedGoal)}</strong>
                        <div>
                          <small>{t("targetDistance")} <b>{selectedGoal.distance_km} km</b></small>
                          <small>{t("preparationWindow")} <b>{selectedGoal.minimum_weeks} {t("weeksUnit")}</b></small>
                          <small>{t("recommendedWeeklyVolume")} <b>{selectedGoal.recommended_weekly_minutes[experienceLevel] / 60} {t("hoursShort")}</b></small>
                        </div>
                        <p>{t("calculatedFromGoal")}</p>
                      </div>
                    )}
                    <fieldset className="training-days">
                      <legend>{t("availableTrainingDays")}</legend>
                      {[t("mondayShort"), t("tuesdayShort"), t("wednesdayShort"), t("thursdayShort"), t("fridayShort"), t("saturdayShort"), t("sundayShort")].map((label, day) => (
                        <label className={availableDays.includes(day) ? "selected" : ""} key={day}><input checked={availableDays.includes(day)} disabled={!availableDays.includes(day) && availableDays.length >= 6} onChange={() => toggleTrainingDay(day)} type="checkbox" />{label}</label>
                      ))}
                    </fieldset>
                    <div className="rest-day-guarantee"><span>REST</span><div><strong>{t("mandatoryRestDay")}</strong><small>{t("maxSixTrainingDays")}</small></div></div>
                    <div className="auto-plan-review"><strong>{t("automaticPeriodization")}</strong><p>{t("automaticPeriodizationText")}</p></div>
                  </>
                ) : (
                  <>
                    <label className="wide">{t("planObjective")}<textarea name="description" rows={3} placeholder={t("planObjectivePlaceholder")} /></label>
                    <div className="form-grid">
                      <label>{t("startDate")}<input name="start_date" type="date" defaultValue={dateOffset(0)} required /></label>
                      <label>{t("endDate")}<input name="end_date" type="date" defaultValue={dateOffset(42)} required /></label>
                    </div>
                  </>
                )}
              </fieldset>
            </>
          )}

          {editor.kind === "week" && (
            <>
              <div className="editor-context"><strong>{editor.plan.title}</strong><small>{editor.plan.start_date} — {editor.plan.end_date}</small></div>
              <div className="form-grid">
                <label>{t("weekNumber")}<input name="week_number" type="number" min="1" required /></label>
                <label>{t("startDate")}<input name="start_date" type="date" defaultValue={editor.plan.start_date} required /></label>
              </div>
              <label>{t("weekNotes")}<textarea name="notes" rows={3} /></label>
            </>
          )}

          {editor.kind === "workout" && (
            <>
              <div className="editor-context"><strong>{t("week", { number: editor.week.week_number })}</strong><small>{editor.week.start_date}</small></div>
              <label className="template-picker">{t("templateLibrary")}<select defaultValue="" onChange={(event) => loadTemplate(event.target.value)}><option value="">{templates.length ? t("chooseTemplate") : t("noTemplates")}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.title} · {workoutTypeLabels[template.workout_type] ?? template.workout_type}</option>)}</select><small>{t("templateLibraryHelp")}</small></label>
              <fieldset className="builder-fieldset">
                <legend><b>1</b>{t("chooseWorkoutSport")}</legend>
                <div className="sport-choice-grid">
                  {SPORT_IDS.map((sport) => (
                    <label className={`${sport} ${workoutSport === sport ? "selected" : ""}`} key={sport}>
                      <input checked={workoutSport === sport} name="sport" onChange={() => selectSport(sport)} required type="radio" value={sport} />
                      <i>{SPORT_MARKS[sport]}</i><span><strong>{t(`sport${sport[0].toUpperCase()}${sport.slice(1)}` as "sportRunning")}</strong><small>{t("sportSpecificTargets")}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {workoutSport && (
                <fieldset className="builder-fieldset">
                  <legend><b>2</b>{t("chooseWorkoutType")}</legend>
                  <div className="workout-type-grid">
                    {(WORKOUT_TYPES_BY_SPORT[workoutSport] || []).map((type) => (
                      <label className={workoutType === type ? "selected" : ""} key={type}>
                        <input checked={workoutType === type} name="workout_type" onChange={() => selectWorkoutType(type)} required type="radio" value={type} />
                        <strong>{workoutTypeLabels[type]}</strong><small>{t(`typeHelp${type.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/^./, (letter) => letter.toUpperCase())}` as "typeHelpRecovery")}</small>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="form-grid">
                <label>{t("workoutTitle")}<input defaultValue={editor.workout?.title} name="title" required /></label>
                <label>{t("scheduledAt")}<input name="scheduled_at" type="datetime-local" defaultValue={editor.workout ? localDateTime(new Date(editor.workout.scheduled_at)) : `${editor.scheduledDate || editor.week.start_date}T07:00`} required /></label>
                <label>{t("intensity")}<input defaultValue={editor.workout?.intensity} name="intensity" placeholder="Z2 / easy / tempo" /></label>
                <label>{t("distanceKm")}<input defaultValue={editor.workout?.planned_distance_km ?? ""} name="planned_distance_km" type="number" min="0" step="0.01" /></label>
              </div>

              {workoutType && (
                <fieldset className="builder-fieldset structure-builder">
                  <legend><b>3</b>{t("buildWorkoutStructure")}</legend>
                  <div className={`personal-zone-banner ${zones.length ? "ready" : "missing"}`}>
                    <span>{zonesLoading ? "…" : zones.length ? "✓" : "!"}</span>
                    <div><strong>{zones.length ? t("personalZonesReady") : t("personalZonesMissing")}</strong><p>{zones.length ? t("personalZonesReadyText") : t("personalZonesMissingText")}</p></div>
                  </div>
                  <div className="structure-summary">
                    <div><span>{t("calculatedDuration")}</span><strong>{structuredDuration} {t("minutes")}</strong></div>
                    <div><span>{t("structuredSteps")}</span><strong>{steps.length}</strong></div>
                    <div className="workout-profile" aria-label={t("workoutProfile")}>
                      {steps.map((step) => <i className={step.stepType} key={step.id} style={{ flexGrow: Math.max(1, Number(step.durationMinutes) * (Number(step.repetitions) || 1)), height: `${Math.min(100, 28 + (Number(step.targetMax) || Number(step.targetMin) || 1) * 12)}%` }} />)}
                    </div>
                  </div>

                  <div className="structured-steps">
                    {steps.map((step, index) => (
                      <article className={`structured-step ${step.stepType}`} key={step.id}>
                        <header><span>{index + 1}</span><strong>{step.name || t("unnamedStep")}</strong><button aria-label={t("removeStep")} disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))} type="button">×</button></header>
                        <div className="step-grid">
                          <label>{t("stepType")}<select onChange={(event) => updateStep(step.id, "stepType", event.target.value)} value={step.stepType}><option value="warmup">{t("stepWarmup")}</option><option value="work">{t("stepWork")}</option><option value="recovery">{t("stepRecovery")}</option><option value="cooldown">{t("stepCooldown")}</option><option value="steady">{t("stepSteady")}</option><option value="drill">{t("stepDrill")}</option></select></label>
                          <label>{t("stepName")}<input onChange={(event) => updateStep(step.id, "name", event.target.value)} required value={step.name} /></label>
                          <label>{t("repetitions")}<input min="1" onChange={(event) => updateStep(step.id, "repetitions", event.target.value)} type="number" value={step.repetitions} /></label>
                          <label>{t("stepDurationMinutes")}<input min="0.1" onChange={(event) => updateStep(step.id, "durationMinutes", event.target.value)} step="0.1" type="number" value={step.durationMinutes} /></label>
                          <label>{t("recoverySeconds")}<input min="0" onChange={(event) => updateStep(step.id, "recoverySeconds", event.target.value)} type="number" value={step.recoverySeconds} /></label>
                          <label>{t("targetType")}<select onChange={(event) => updateTargetType(step.id, event.target.value)} value={step.targetType}><option value="free">{t("targetFree")}</option><option value="heart_rate">{t("targetHeartRate")}</option><option value="pace">{t("targetPace")}</option><option value="power">{t("targetPower")}</option><option value="rpe">RPE</option></select></label>
                          {["heart_rate", "pace", "power"].includes(step.targetType) && <><label>{t("targetZoneFrom")}<select onChange={(event) => updateStep(step.id, "targetMin", event.target.value)} value={step.targetMin}>{zoneNumbers(step.targetType).map((zone) => <option key={zone} value={zone}>Z{zone}</option>)}</select></label><label>{t("targetZoneTo")}<select onChange={(event) => updateStep(step.id, "targetMax", event.target.value)} value={step.targetMax}>{zoneNumbers(step.targetType).map((zone) => <option key={zone} value={zone}>Z{zone}</option>)}</select></label></>}
                          {step.targetType === "rpe" && <><label>{t("targetMin")}<input max="10" min="1" onChange={(event) => updateStep(step.id, "targetMin", event.target.value)} type="number" value={step.targetMin} /></label><label>{t("targetMax")}<input max="10" min="1" onChange={(event) => updateStep(step.id, "targetMax", event.target.value)} type="number" value={step.targetMax} /></label></>}
                        </div>
                        {["heart_rate", "pace", "power"].includes(step.targetType) && <div className={`automatic-step-target ${resolvedZoneRange(zones, step.targetType, step.targetMin, step.targetMax) ? "resolved" : "unresolved"}`}><span>{t("automaticTarget")}</span><strong>{resolvedZoneRange(zones, step.targetType, step.targetMin, step.targetMax) || t("thresholdRequired")}</strong></div>}
                        <label>{t("exerciseDescription")}<textarea onChange={(event) => updateStep(step.id, "description", event.target.value)} rows={2} value={step.description} /></label>
                      </article>
                    ))}
                  </div>
                  <button className="secondary add-step-button" onClick={() => setSteps((current) => [...current, createStep({ name: t("stepWork") })])} type="button">+ {t("addStep")}</button>
                </fieldset>
              )}
              <label>{t("workoutNotes")}<textarea defaultValue={editor.workout?.notes} name="notes" rows={3} /></label>
            </>
          )}

          {editor.kind === "exercise" && (
            <>
              <div className="editor-context"><strong>{editor.workout.title}</strong><small>{t("exerciseDetails")}</small></div>
              <div className="form-grid">
                <label>{t("exerciseName")}<input name="name" required /></label>
                <label>{t("exerciseOrder")}<input name="order" type="number" min="1" defaultValue={editor.workout.exercises.length + 1} required /></label>
                <label>{t("stepType")}<select name="step_type"><option value="warmup">{t("stepWarmup")}</option><option value="work">{t("stepWork")}</option><option value="recovery">{t("stepRecovery")}</option><option value="cooldown">{t("stepCooldown")}</option><option value="steady">{t("stepSteady")}</option><option value="drill">{t("stepDrill")}</option></select></label>
                <label>{t("repetitions")}<input name="repetitions" type="number" min="1" defaultValue="1" /></label>
                <label>{t("durationSeconds")}<input name="duration_seconds" type="number" min="1" /></label>
                <label>{t("distanceMeters")}<input name="distance_meters" type="number" min="1" /></label>
                <label>{t("recoverySeconds")}<input name="recovery_seconds" type="number" min="0" /></label>
                <label>{t("targetType")}<select name="target_type"><option value="free">{t("targetFree")}</option><option value="heart_rate">{t("targetHeartRate")}</option><option value="pace">{t("targetPace")}</option><option value="power">{t("targetPower")}</option><option value="rpe">RPE</option></select></label>
                <label>{t("targetMin")}<input name="target_min" type="number" step="0.01" /></label>
                <label>{t("targetMax")}<input name="target_max" type="number" step="0.01" /></label>
                <label>{t("targetUnit")}<input name="target_unit" placeholder="zone / %FTP / bpm" /></label>
              </div>
              <label>{t("exerciseDescription")}<textarea name="description" rows={3} /></label>
            </>
          )}

          {editor.kind === "comment" && (
            <>
              <div className="editor-context"><strong>{editor.workout.title}</strong><small>{t("coachCommentHelp")}</small></div>
              <label>{t("comment")}<textarea name="body" rows={5} required /></label>
            </>
          )}

          {editor.kind === "log" && (
            <>
              <div className="editor-context"><strong>{editor.workout.title}</strong><small>{t("completionHelp")}</small></div>
              <div className="form-grid">
                <label>{t("completedAt")}<input name="completed_at" type="datetime-local" defaultValue={localDateTime()} required /></label>
                <label>{t("actualDuration")}<input name="actual_duration_minutes" type="number" min="1" /></label>
                <label>{t("actualDistance")}<input name="actual_distance_km" type="number" min="0" step="0.01" /></label>
                <label>{t("perceivedEffort")}<input name="perceived_exertion" type="number" min="1" max="10" /></label>
              </div>
              <label>{t("completionNotes")}<textarea name="notes" rows={4} /></label>
            </>
          )}

          <div className="form-actions">
            <button className="secondary" onClick={onClose} type="button">{t("cancel")}</button>
            <button className="primary" disabled={submitting} type="submit">{submitting ? t("saving") : t("save")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function TrainingPlansPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expandedWorkout, setExpandedWorkout] = useState<number | null>(null);
  const [sportFilter, setSportFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dragOverDate, setDragOverDate] = useState("");
  const requestedPlanId = Number(searchParams.get("plan_id")) || null;
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(requestedPlanId);

  const reload = useCallback(async () => {
    const planResponse = await api.plans();
    setPlans(planResponse.results);
    if (user?.role === "coach") {
      const athleteResponse = await api.athletes();
      setRelationships(athleteResponse.results);
    }
  }, [user?.role]);

  useEffect(() => {
    setLoading(true);
    reload().catch((caught) => setError((caught as Error).message)).finally(() => setLoading(false));
  }, [reload]);

  const athletesById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.athlete.id, displayName(relationship)])),
    [relationships],
  );
  const sortedPlans = useMemo(() => sortPlansByRecency(plans), [plans]);
  const selectedPlan = useMemo(
    () => sortedPlans.find((plan) => plan.id === selectedPlanId) ?? sortedPlans[0] ?? null,
    [selectedPlanId, sortedPlans],
  );

  useEffect(() => {
    if (!sortedPlans.length) {
      setSelectedPlanId(null);
      return;
    }
    const requestedPlan = requestedPlanId
      ? sortedPlans.find((plan) => plan.id === requestedPlanId)
      : undefined;
    if (requestedPlan) {
      setSelectedPlanId(requestedPlan.id);
      return;
    }
    if (!sortedPlans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(sortedPlans[0].id);
    }
  }, [requestedPlanId, selectedPlanId, sortedPlans]);

  function selectPlan(planId: number) {
    setSelectedPlanId(planId);
    setExpandedWorkout(null);
    setSportFilter("all");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("plan_id", String(planId));
    setSearchParams(nextParams, { replace: true });
  }

  async function saved(notice: string, destination?: SavedDestination) {
    setEditor(null);
    setMessage(notice);
    setError("");
    if (destination?.calendarDate && destination.athleteId) {
      const params = new URLSearchParams({
        date: destination.calendarDate,
        athlete_id: String(destination.athleteId),
        plan_id: String(destination.planId),
      });
      navigate(`/calendar?${params.toString()}`);
      return;
    }
    await reload();
    if (destination) selectPlan(destination.planId);
  }

  async function moveWorkout(workout: Workout, week: WeeklyPlan, targetDate: string) {
    const source = new Date(workout.scheduled_at);
    const hours = String(source.getHours()).padStart(2, "0");
    const minutes = String(source.getMinutes()).padStart(2, "0");
    try {
      await api.updateWorkout(workout.id, {
        weekly_plan: week.id,
        scheduled_at: new Date(`${targetDate}T${hours}:${minutes}`).toISOString(),
      });
      setMessage(t("workoutMoved"));
      setError("");
      await reload();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setDragOverDate("");
    }
  }

  async function duplicateWorkout(workout: Workout, week: WeeklyPlan) {
    const target = new Date(workout.scheduled_at);
    const nextDay = new Date(target);
    nextDay.setDate(nextDay.getDate() + 1);
    const weekEnd = new Date(`${week.start_date}T23:59:59`);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (nextDay > weekEnd) target.setHours(target.getHours() + 1);
    else target.setDate(target.getDate() + 1);
    try {
      await api.duplicateWorkout(workout.id, { weekly_plan: week.id, scheduled_at: target.toISOString() });
      await saved(t("workoutDuplicated"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function removeWorkout(workout: Workout) {
    if (!window.confirm(t("confirmDeleteWorkout"))) return;
    try {
      await api.deleteWorkout(workout.id);
      setExpandedWorkout(null);
      await saved(t("workoutDeleted"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function publishPlan(plan: TrainingPlan) {
    try {
      await api.publishPlan(plan.id);
      setMessage(t("planPublished"));
      setError("");
      await reload();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function returnPlanToDraft(plan: TrainingPlan) {
    if (!window.confirm(t("confirmReturnToDraft"))) return;
    try {
      await api.returnPlanToDraft(plan.id);
      setMessage(t("planReturnedToDraft"));
      setError("");
      await reload();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function archivePlan(plan: TrainingPlan) {
    if (!window.confirm(t("confirmArchivePlan"))) return;
    try {
      await api.archivePlan(plan.id);
      setMessage(t("planArchived"));
      setError("");
      await reload();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function saveWorkoutTemplate(workout: Workout) {
    try {
      await api.createWorkoutTemplate({
        title: workout.title,
        sport: workout.sport,
        workout_type: workout.workout_type,
        description: workout.notes,
        planned_duration_minutes: workout.planned_duration_minutes,
        planned_distance_km: workout.planned_distance_km,
        intensity: workout.intensity,
        structured_steps: workout.exercises.map((step) => ({
          name: step.name,
          step_type: step.step_type,
          order: step.order,
          description: step.description,
          repetitions: step.repetitions,
          duration_seconds: step.duration_seconds,
          distance_meters: step.distance_meters,
          recovery_seconds: step.recovery_seconds,
          target_type: step.target_type,
          target_min: step.target_min,
          target_max: step.target_max,
          target_unit: step.target_unit,
        })),
      });
      setMessage(t("templateSaved"));
      setError("");
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function duplicateWeek(plan: TrainingPlan, week: WeeklyPlan) {
    const lastStart = plan.weeks.reduce((latest, item) => item.start_date > latest ? item.start_date : latest, week.start_date);
    const targetStart = new Date(`${lastStart}T12:00:00`);
    targetStart.setDate(targetStart.getDate() + 7);
    if (dateKey(targetStart) > plan.end_date) {
      setError(t("extendPlanBeforeCopyingWeek"));
      return;
    }
    try {
      await api.duplicateWeek(week.id, {
        start_date: dateKey(targetStart),
        week_number: Math.max(...plan.weeks.map((item) => item.week_number)) + 1,
      });
      await saved(t("weekDuplicated"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const sportLabels: Record<string, string> = {
    running: t("sportRunning"),
    cycling: t("sportCycling"),
    swimming: t("sportSwimming"),
    triathlon: t("sportTriathlon"),
  };
  const statusLabels: Record<string, string> = {
    planned: t("statusPlanned"),
    completed: t("statusCompleted"),
    skipped: t("statusSkipped"),
  };
  const workoutTypeLabels: Record<string, string> = {
    recovery: t("typeRecovery"),
    endurance: t("typeEndurance"),
    long: t("typeLong"),
    tempo: t("typeTempo"),
    threshold: t("typeThreshold"),
    intervals: t("typeIntervals"),
    vo2_max: t("typeVo2Max"),
    technique: t("typeTechnique"),
    brick: t("typeBrick"),
    race: t("typeRace"),
    strength: t("typeStrength"),
  };
  const phaseLabels: Record<string, string> = {
    base: t("phaseBase"),
    build: t("phaseBuild"),
    peak: t("phasePeak"),
    taper: t("phaseTaper"),
    recovery: t("phaseRecovery"),
    race: t("phaseRace"),
  };
  const translatedGoalLabel = (code: string) => {
    const key = GOAL_LABEL_KEYS[code as keyof typeof GOAL_LABEL_KEYS];
    return key ? t(key) : t("customEvent");
  };
  const allWorkouts = selectedPlan?.weeks.flatMap((week) => week.workouts) ?? [];

  return (
    <>
      <div className="section-title plan-toolbar">
        <div><span className="eyebrow">{t("training")}</span><h2>{t("plansAndSessions")}</h2><p>{user?.role === "coach" ? t("coachPlanHelp") : t("athletePlanHelp")}</p></div>
        {user?.role === "coach" && <button className="primary" disabled={!relationships.some((item) => item.is_active)} onClick={() => setEditor({ kind: "plan" })} type="button">+ {t("createPlan")}</button>}
      </div>

      {user?.role === "coach" && (
        <section className="plan-guide" aria-label={t("planGuide")}>
          <article><strong>1</strong><div><h3>{t("planStepOne")}</h3><p>{t("planStepOneText")}</p></div></article>
          <article><strong>2</strong><div><h3>{t("planStepTwo")}</h3><p>{t("planStepTwoText")}</p></div></article>
          <article><strong>3</strong><div><h3>{t("planStepThree")}</h3><p>{t("planStepThreeText")}</p></div></article>
        </section>
      )}

      {!loading && plans.length > 0 && (
        <PlanLibrary
          athleteNames={athletesById}
          isCoach={user?.role === "coach"}
          onSelect={selectPlan}
          plans={sortedPlans}
          selectedPlanId={selectedPlan?.id ?? null}
        />
      )}

      <nav className="sport-filter" aria-label={t("sportFilter")}>
        <button className={sportFilter === "all" ? "active" : ""} onClick={() => setSportFilter("all")} type="button">
          {t("allSports")} <span>{allWorkouts.length}</span>
        </button>
        {SPORT_IDS.map((sport) => (
          <button className={sportFilter === sport ? `active ${sport}` : sport} key={sport} onClick={() => setSportFilter(sport)} type="button">
            <i>{SPORT_MARKS[sport]}</i> {sportLabels[sport]} <span>{allWorkouts.filter((workout) => workout.sport === sport).length}</span>
          </button>
        ))}
      </nav>

      {message && <div className="notice" role="status">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {loading && <div className="training-loading">{t("loading")}</div>}
      {!loading && user?.role === "coach" && !relationships.some((item) => item.is_active) && <div className="training-empty">{t("connectAthleteFirst")}</div>}

      {!loading && selectedPlan && [selectedPlan].map((plan) => (
        <section className={`manage-plan publication-${plan.publication_status}`} key={plan.id}>
          <div className="plan-head">
            <div>
              <span className="eyebrow">{user?.role === "coach" ? athletesById.get(plan.athlete) || t("athlete") : t("trainingPlan")}</span>
              <span className={`plan-sport-badge ${plan.primary_sport}`}><i>{SPORT_MARKS[plan.primary_sport]}</i>{sportLabels[plan.primary_sport]}</span>
              <h3>{plan.title}</h3>
              {plan.target_event_type && (
                <div className="plan-target-summary">
                  <span>{t("targetEvent")}</span>
                  <strong>{plan.target_event_name || translatedGoalLabel(plan.target_event_type)}</strong>
                  <small>{translatedGoalLabel(plan.target_event_type)}{plan.target_distance_km ? ` · ${plan.target_distance_km} km` : ""}</small>
                </div>
              )}
              <p>{localizeGeneratedPlanDescription(plan, t)}</p>
              <small>{plan.start_date} — {plan.end_date}</small>
            </div>
            <div className="plan-actions">
              <span className={`status publication-status ${plan.publication_status}`}>{t(plan.publication_status)}</span>
              {user?.role === "coach" && plan.publication_status === "draft" && (
                <button className="primary compact" onClick={() => void publishPlan(plan)} type="button">{t("publishToAthlete")}</button>
              )}
              {user?.role === "coach" && plan.publication_status === "published" && (
                <>
                  <button className="secondary compact" onClick={() => void returnPlanToDraft(plan)} type="button">{t("returnToDraft")}</button>
                  <button className="secondary compact" onClick={() => void archivePlan(plan)} type="button">{t("archivePlan")}</button>
                </>
              )}
              {user?.role === "coach" && plan.publication_status === "archived" && (
                <button className="secondary compact" onClick={() => void publishPlan(plan)} type="button">{t("reactivatePlan")}</button>
              )}
              {user?.role === "coach" && plan.publication_status !== "archived" && <button className="secondary compact" onClick={() => setEditor({ kind: "week", plan })} type="button">+ {t("addWeek")}</button>}
            </div>
          </div>

          {user?.role === "coach" && plan.publication_status === "draft" && (
            <div className="plan-publication-note">
              <span>PRIVATE</span>
              <div><strong>{t("draftPlanPrivate")}</strong><small>{t("draftPlanPrivateText")}</small></div>
            </div>
          )}

          {!plan.weeks.length && <div className="plan-empty">{t("noWeeks")}</div>}
          {plan.weeks.map((week) => {
            const visibleWorkouts = week.workouts.filter((workout) => sportFilter === "all" || workout.sport === sportFilter);
            const selectedWorkout = visibleWorkouts.find((workout) => workout.id === expandedWorkout);
            const scheduledDates = new Set(week.workouts.map((workout) => dateKey(workout.scheduled_at)));
            const restDays = Math.max(0, 7 - scheduledDates.size);
            const localizedWeekNote = localizeGeneratedWeekNote(plan, week, t);
            return (
              <div className="week-block calendar-week" key={week.id}>
                <div className="week-head">
                  <div><span className="eyebrow">{t("weeklyCalendar")}</span><h4>{t("week", { number: week.week_number })}{week.phase && <span className={`phase-badge ${week.phase}`}>{phaseLabels[week.phase] ?? week.phase}</span>}</h4><small>{week.start_date}{week.planned_duration_minutes ? ` · ${Math.round(week.planned_duration_minutes / 6) / 10} ${t("hoursShort")}` : ""}{localizedWeekNote ? ` · ${localizedWeekNote}` : ""}</small></div>
                  <span className="week-recovery-summary">{t("weekScheduleSummary", { workouts: week.workouts.length, restDays })}</span>
                  {user?.role === "coach" && plan.publication_status !== "archived" && <div className="week-actions"><button className="secondary compact" onClick={() => void duplicateWeek(plan, week)} type="button">{t("copyWeek")}</button><button className="secondary compact" onClick={() => setEditor({ kind: "workout", week, planSport: plan.primary_sport, athleteId: plan.athlete, scheduledDate: week.start_date })} type="button">+ {t("addWorkout")}</button></div>}
                </div>

                <div className="week-calendar">
                  {weekDays(week.start_date).map((day) => {
                    const dayWorkouts = visibleWorkouts.filter((workout) => dateKey(workout.scheduled_at) === dateKey(day));
                    const hasScheduledWorkout = scheduledDates.has(dateKey(day));
                    return (
                      <section className={`calendar-day ${hasScheduledWorkout ? "" : "is-rest"} ${dragOverDate === dateKey(day) ? "drag-over" : ""}`} key={dateKey(day)} onDragLeave={() => setDragOverDate("")} onDragOver={(event) => {
                        if (user?.role === "coach" && plan.publication_status !== "archived") {
                          event.preventDefault();
                          setDragOverDate(dateKey(day));
                        }
                      }} onDrop={(event) => {
                        if (user?.role !== "coach" || plan.publication_status === "archived") return;
                        event.preventDefault();
                        const workout = allWorkouts.find((item) => item.id === Number(event.dataTransfer.getData("text/workout-id")));
                        if (workout) void moveWorkout(workout, week, dateKey(day));
                      }}>
                        <header>
                          <div><span>{day.toLocaleDateString(dateLocale, { weekday: "short" })}</span><strong>{day.getDate()}</strong></div>
                          {user?.role === "coach" && plan.publication_status !== "archived" && <button aria-label={t("addWorkoutOnDate", { date: day.toLocaleDateString(dateLocale) })} onClick={() => setEditor({ kind: "workout", week, planSport: plan.primary_sport, athleteId: plan.athlete, scheduledDate: dateKey(day) })} type="button">+</button>}
                        </header>
                        <div className="day-workouts">
                          {dayWorkouts.map((workout) => (
                            <article className={`calendar-workout ${workout.sport} ${workout.status}`} draggable={user?.role === "coach" && plan.publication_status !== "archived"} key={workout.id} onDragEnd={() => setDragOverDate("")} onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/workout-id", String(workout.id));
                            }}>
                              <button onClick={() => setExpandedWorkout(expandedWorkout === workout.id ? null : workout.id)} type="button">
                                <span className="sport-card-label"><i>{SPORT_MARKS[workout.sport]}</i>{sportLabels[workout.sport] || workout.sport}</span>
                                <strong>{localizeGeneratedWorkoutTitle(workout, t)}</strong>
                                <small>{new Date(workout.scheduled_at).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })} · {workoutTypeLabels[workout.workout_type] || workout.workout_type} · {workout.intensity || t("openIntensity")}</small>
                                <span className="sport-card-metrics"><b>{workout.planned_duration_minutes || "—"} {t("minutes")}</b><b>{workout.planned_distance_km ? `${workout.planned_distance_km} km` : "—"}</b></span>
                                <span className={`calendar-status ${workout.status}`}>{statusLabels[workout.status] || workout.status}</span>
                              </button>
                            </article>
                          ))}
                          {!dayWorkouts.length && !hasScheduledWorkout && (
                            <span className="day-rest"><i>REST</i><strong>{t("recoveryDay")}</strong><small>{t("recoveryDayHelp")}</small></span>
                          )}
                          {!dayWorkouts.length && hasScheduledWorkout && <span className="day-filtered">{t("otherSportScheduled")}</span>}
                        </div>
                      </section>
                    );
                  })}
                </div>

                {!visibleWorkouts.length && <div className="plan-empty small">{sportFilter === "all" ? t("noWeekWorkouts") : t("noSportWorkouts")}</div>}
                {selectedWorkout && (
                  <div className={`workout-detail calendar-quick-view ${selectedWorkout.sport}`}>
                    <div className="quick-view-head">
                      <div><span className="sport-card-label"><i>{SPORT_MARKS[selectedWorkout.sport]}</i>{sportLabels[selectedWorkout.sport]} · {workoutTypeLabels[selectedWorkout.workout_type] || selectedWorkout.workout_type}</span><h4>{localizeGeneratedWorkoutTitle(selectedWorkout, t)}</h4><small>{new Date(selectedWorkout.scheduled_at).toLocaleString(dateLocale)} · {selectedWorkout.intensity || t("openIntensity")}</small></div>
                      <div className="quick-view-actions">
                        {user?.role === "coach" && plan.publication_status !== "archived" && <>
                          <button className="secondary compact" onClick={() => setEditor({ kind: "workout", week, planSport: plan.primary_sport, athleteId: plan.athlete, workout: selectedWorkout })} type="button">{t("edit")}</button>
                          <button className="secondary compact" onClick={() => void duplicateWorkout(selectedWorkout, week)} type="button">{t("duplicate")}</button>
                          <button className="secondary compact" onClick={() => void saveWorkoutTemplate(selectedWorkout)} type="button">{t("saveAsTemplate")}</button>
                          <button className="danger compact" onClick={() => void removeWorkout(selectedWorkout)} type="button">{t("delete")}</button>
                        </>}
                        <button aria-label={t("close")} className="icon-button" onClick={() => setExpandedWorkout(null)} type="button">×</button>
                      </div>
                    </div>
                    <div className="planned-metrics">
                      <span><small>{t("durationMinutes")}</small><strong>{selectedWorkout.planned_duration_minutes || "—"} {t("minutes")}</strong></span>
                      <span><small>{t("distanceKm")}</small><strong>{selectedWorkout.planned_distance_km ? `${selectedWorkout.planned_distance_km} km` : "—"}</strong></span>
                      <span><small>{t("status")}</small><strong>{statusLabels[selectedWorkout.status] || selectedWorkout.status}</strong></span>
                    </div>
                    {selectedWorkout.notes && <p className="workout-notes">{localizeGeneratedWorkoutNotes(plan, week, selectedWorkout, t)}</p>}
                    <div className="detail-columns">
                      <section>
                        <div className="detail-title"><h5>{t("exercises")}</h5>{user?.role === "coach" && plan.publication_status !== "archived" && <button className="link-action" onClick={() => setEditor({ kind: "exercise", workout: selectedWorkout })} type="button">+ {t("addExercise")}</button>}</div>
                        {selectedWorkout.exercises.length ? <ol className="exercise-list">{selectedWorkout.exercises.map((exercise) => <li className={exercise.step_type} key={exercise.id}><strong>{localizeGeneratedExerciseName(plan, exercise, t)}</strong><span>{exercise.description || t("exerciseDetails")}</span><small>{exercise.repetitions && exercise.repetitions > 1 ? `${exercise.repetitions}× · ` : ""}{exercise.duration_seconds ? `${exercise.duration_seconds} ${t("seconds")}` : ""}{exercise.distance_meters ? ` · ${exercise.distance_meters} m` : ""}{exercise.resolved_target_label ? ` · ${exercise.resolved_target_label}` : exercise.target_min ? ` · ${exercise.target_type} ${exercise.target_min}${exercise.target_max && exercise.target_max !== exercise.target_min ? `–${exercise.target_max}` : ""} ${exercise.target_unit}` : ""}{exercise.recovery_seconds ? ` · ${t("recovery")} ${exercise.recovery_seconds} ${t("seconds")}` : ""}</small></li>)}</ol> : <p className="muted">{t("noExercises")}</p>}
                      </section>
                      <section>
                        <div className="detail-title"><h5>{t("coachComments")}</h5>{user?.role === "coach" && plan.publication_status !== "archived" && <button className="link-action" onClick={() => setEditor({ kind: "comment", workout: selectedWorkout })} type="button">+ {t("addComment")}</button>}</div>
                        {selectedWorkout.coach_comments.length ? <div className="comment-list">{selectedWorkout.coach_comments.map((comment) => <blockquote key={comment.id}>{comment.body}<small>{comment.coach_name || t("coach")}</small></blockquote>)}</div> : <p className="muted">{t("noCoachComments")}</p>}
                      </section>
                    </div>

                    {selectedWorkout.log ? (
                      <section className="completion-card">
                        <div><span className="eyebrow">{t("workoutResult")}</span><strong>{t("statusCompleted")}</strong></div>
                        <span>{selectedWorkout.log.actual_duration_minutes || "—"} {t("minutes")}</span>
                        <span>{selectedWorkout.log.actual_distance_km ? `${selectedWorkout.log.actual_distance_km} km` : "—"}</span>
                        <span>RPE {selectedWorkout.log.perceived_exertion || "—"}</span>
                        {selectedWorkout.log.notes && <p>{selectedWorkout.log.notes}</p>}
                      </section>
                    ) : user?.role === "athlete" ? (
                      <button className="primary complete-button" onClick={() => setEditor({ kind: "log", workout: selectedWorkout })} type="button">{t("markComplete")}</button>
                    ) : <p className="muted completion-pending">{t("awaitingCompletion")}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {!loading && !plans.length && (user?.role === "athlete" || relationships.some((item) => item.is_active)) && <div className="training-empty">{user?.role === "coach" ? t("createFirstPlan") : t("noPlans")}</div>}
      {editor && <EditorPanel editor={editor} relationships={relationships} onClose={() => setEditor(null)} onSaved={saved} />}
    </>
  );
}
