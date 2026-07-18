import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type { AthleteThreshold, Relationship, TrainingPlan, TrainingZone, WeeklyPlan, Workout, WorkoutTemplate } from "./types";

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

export function EditorPanel({
  editor,
  relationships,
  onClose,
  onSaved,
}: {
  editor: Editor;
  relationships: Relationship[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
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
          await api.generatePlan({
            athlete: Number(planAthleteId),
            title: String(payload.title),
            primary_sport: planSport,
            start_date: String(payload.start_date),
            event_date: String(payload.event_date),
            event_name: String(payload.event_name),
            weekly_minutes: Math.round(Number(payload.weekly_hours) * 60),
            available_days: availableDays,
            recovery_every: Number(payload.recovery_every),
            taper_weeks: Number(payload.taper_weeks),
            experience_level: String(payload.experience_level),
            threshold_profile: thresholdProfile,
          });
          await onSaved(t("planGenerated"));
        } else {
          await api.createPlan({
            athlete: Number(planAthleteId),
            title: String(payload.title),
            description: String(payload.description ?? ""),
            primary_sport: planSport,
            start_date: String(payload.start_date),
            end_date: String(payload.end_date),
            is_active: true,
            threshold_profile: thresholdProfile,
          });
          await onSaved(t("planCreated"));
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
                    <label>{t("targetEvent")}<input name="event_name" placeholder={t("targetEventPlaceholder")} required /></label>
                    <div className="form-grid">
                      <label>{t("startDate")}<input name="start_date" type="date" defaultValue={nextMonday()} min={dateOffset(0)} required /></label>
                      <label>{t("eventDate")}<input name="event_date" type="date" defaultValue={dateOffset(84)} min={dateOffset(42)} required /></label>
                    </div>
                    <div className="auto-plan-grid">
                      <label>{t("currentWeeklyVolume")}<input defaultValue="6" max="30" min="2" name="weekly_hours" step="0.5" type="number" required /><small>{t("hoursPerWeek")}</small></label>
                      <label>{t("experienceLevel")}<select defaultValue="intermediate" name="experience_level"><option value="beginner">{t("experienceBeginner")}</option><option value="intermediate">{t("experienceIntermediate")}</option><option value="advanced">{t("experienceAdvanced")}</option></select></label>
                      <label>{t("recoveryCycle")}<select defaultValue="4" name="recovery_every"><option value="3">{t("everyThirdWeek")}</option><option value="4">{t("everyFourthWeek")}</option></select></label>
                      <label>{t("taperDuration")}<select defaultValue="2" name="taper_weeks"><option value="1">1 {t("weekUnit")}</option><option value="2">2 {t("weeksUnit")}</option><option value="3">3 {t("weeksUnit")}</option></select></label>
                    </div>
                    <fieldset className="training-days">
                      <legend>{t("availableTrainingDays")}</legend>
                      {[t("mondayShort"), t("tuesdayShort"), t("wednesdayShort"), t("thursdayShort"), t("fridayShort"), t("saturdayShort"), t("sundayShort")].map((label, day) => (
                        <label className={availableDays.includes(day) ? "selected" : ""} key={day}><input checked={availableDays.includes(day)} onChange={() => setAvailableDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort())} type="checkbox" />{label}</label>
                      ))}
                    </fieldset>
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
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expandedWorkout, setExpandedWorkout] = useState<number | null>(null);
  const [sportFilter, setSportFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dragOverDate, setDragOverDate] = useState("");

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

  async function saved(notice: string) {
    setEditor(null);
    setMessage(notice);
    setError("");
    await reload();
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
  const allWorkouts = plans.flatMap((plan) => plan.weeks.flatMap((week) => week.workouts));

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

      {!loading && plans.map((plan) => (
        <section className="manage-plan" key={plan.id}>
          <div className="plan-head">
            <div>
              <span className="eyebrow">{user?.role === "coach" ? athletesById.get(plan.athlete) || t("athlete") : t("trainingPlan")}</span>
              <span className={`plan-sport-badge ${plan.primary_sport}`}><i>{SPORT_MARKS[plan.primary_sport]}</i>{sportLabels[plan.primary_sport]}</span>
              <h3>{plan.title}</h3>
              <p>{plan.description || t("noDescription")}</p>
              <small>{plan.start_date} — {plan.end_date}</small>
            </div>
            <div className="plan-actions">
              <span className={`status ${plan.is_active ? "active" : ""}`}>{plan.is_active ? t("active") : t("archived")}</span>
              {user?.role === "coach" && <button className="secondary compact" onClick={() => setEditor({ kind: "week", plan })} type="button">+ {t("addWeek")}</button>}
            </div>
          </div>

          {!plan.weeks.length && <div className="plan-empty">{t("noWeeks")}</div>}
          {plan.weeks.map((week) => {
            const visibleWorkouts = week.workouts.filter((workout) => sportFilter === "all" || workout.sport === sportFilter);
            const selectedWorkout = visibleWorkouts.find((workout) => workout.id === expandedWorkout);
            return (
              <div className="week-block calendar-week" key={week.id}>
                <div className="week-head">
                  <div><span className="eyebrow">{t("weeklyCalendar")}</span><h4>{t("week", { number: week.week_number })}{week.phase && <span className={`phase-badge ${week.phase}`}>{phaseLabels[week.phase] ?? week.phase}</span>}</h4><small>{week.start_date}{week.planned_duration_minutes ? ` · ${Math.round(week.planned_duration_minutes / 6) / 10} ${t("hoursShort")}` : ""}{week.notes ? ` · ${week.notes}` : ""}</small></div>
                  {user?.role === "coach" && <div className="week-actions"><button className="secondary compact" onClick={() => void duplicateWeek(plan, week)} type="button">{t("copyWeek")}</button><button className="secondary compact" onClick={() => setEditor({ kind: "workout", week, planSport: plan.primary_sport, athleteId: plan.athlete, scheduledDate: week.start_date })} type="button">+ {t("addWorkout")}</button></div>}
                </div>

                <div className="week-calendar">
                  {weekDays(week.start_date).map((day) => {
                    const dayWorkouts = visibleWorkouts.filter((workout) => dateKey(workout.scheduled_at) === dateKey(day));
                    return (
                      <section className={`calendar-day ${dragOverDate === dateKey(day) ? "drag-over" : ""}`} key={dateKey(day)} onDragLeave={() => setDragOverDate("")} onDragOver={(event) => {
                        if (user?.role === "coach") {
                          event.preventDefault();
                          setDragOverDate(dateKey(day));
                        }
                      }} onDrop={(event) => {
                        if (user?.role !== "coach") return;
                        event.preventDefault();
                        const workout = allWorkouts.find((item) => item.id === Number(event.dataTransfer.getData("text/workout-id")));
                        if (workout) void moveWorkout(workout, week, dateKey(day));
                      }}>
                        <header>
                          <div><span>{day.toLocaleDateString(dateLocale, { weekday: "short" })}</span><strong>{day.getDate()}</strong></div>
                          {user?.role === "coach" && <button aria-label={t("addWorkoutOnDate", { date: day.toLocaleDateString(dateLocale) })} onClick={() => setEditor({ kind: "workout", week, planSport: plan.primary_sport, athleteId: plan.athlete, scheduledDate: dateKey(day) })} type="button">+</button>}
                        </header>
                        <div className="day-workouts">
                          {dayWorkouts.map((workout) => (
                            <article className={`calendar-workout ${workout.sport} ${workout.status}`} draggable={user?.role === "coach"} key={workout.id} onDragEnd={() => setDragOverDate("")} onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/workout-id", String(workout.id));
                            }}>
                              <button onClick={() => setExpandedWorkout(expandedWorkout === workout.id ? null : workout.id)} type="button">
                                <span className="sport-card-label"><i>{SPORT_MARKS[workout.sport]}</i>{sportLabels[workout.sport] || workout.sport}</span>
                                <strong>{workout.title}</strong>
                                <small>{new Date(workout.scheduled_at).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })} · {workoutTypeLabels[workout.workout_type] || workout.workout_type} · {workout.intensity || t("openIntensity")}</small>
                                <span className="sport-card-metrics"><b>{workout.planned_duration_minutes || "—"} {t("minutes")}</b><b>{workout.planned_distance_km ? `${workout.planned_distance_km} km` : "—"}</b></span>
                                <span className={`calendar-status ${workout.status}`}>{statusLabels[workout.status] || workout.status}</span>
                              </button>
                            </article>
                          ))}
                          {!dayWorkouts.length && <span className="day-rest">{t("restDay")}</span>}
                        </div>
                      </section>
                    );
                  })}
                </div>

                {!visibleWorkouts.length && <div className="plan-empty small">{sportFilter === "all" ? t("noWeekWorkouts") : t("noSportWorkouts")}</div>}
                {selectedWorkout && (
                  <div className={`workout-detail calendar-quick-view ${selectedWorkout.sport}`}>
                    <div className="quick-view-head">
                      <div><span className="sport-card-label"><i>{SPORT_MARKS[selectedWorkout.sport]}</i>{sportLabels[selectedWorkout.sport]} · {workoutTypeLabels[selectedWorkout.workout_type] || selectedWorkout.workout_type}</span><h4>{selectedWorkout.title}</h4><small>{new Date(selectedWorkout.scheduled_at).toLocaleString(dateLocale)} · {selectedWorkout.intensity || t("openIntensity")}</small></div>
                      <div className="quick-view-actions">
                        {user?.role === "coach" && <>
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
                    {selectedWorkout.notes && <p className="workout-notes">{selectedWorkout.notes}</p>}
                    <div className="detail-columns">
                      <section>
                        <div className="detail-title"><h5>{t("exercises")}</h5>{user?.role === "coach" && <button className="link-action" onClick={() => setEditor({ kind: "exercise", workout: selectedWorkout })} type="button">+ {t("addExercise")}</button>}</div>
                        {selectedWorkout.exercises.length ? <ol className="exercise-list">{selectedWorkout.exercises.map((exercise) => <li className={exercise.step_type} key={exercise.id}><strong>{exercise.name}</strong><span>{exercise.description || t("exerciseDetails")}</span><small>{exercise.repetitions && exercise.repetitions > 1 ? `${exercise.repetitions}× · ` : ""}{exercise.duration_seconds ? `${exercise.duration_seconds} ${t("seconds")}` : ""}{exercise.distance_meters ? ` · ${exercise.distance_meters} m` : ""}{exercise.resolved_target_label ? ` · ${exercise.resolved_target_label}` : exercise.target_min ? ` · ${exercise.target_type} ${exercise.target_min}${exercise.target_max && exercise.target_max !== exercise.target_min ? `–${exercise.target_max}` : ""} ${exercise.target_unit}` : ""}{exercise.recovery_seconds ? ` · ${t("recovery")} ${exercise.recovery_seconds} ${t("seconds")}` : ""}</small></li>)}</ol> : <p className="muted">{t("noExercises")}</p>}
                      </section>
                      <section>
                        <div className="detail-title"><h5>{t("coachComments")}</h5>{user?.role === "coach" && <button className="link-action" onClick={() => setEditor({ kind: "comment", workout: selectedWorkout })} type="button">+ {t("addComment")}</button>}</div>
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
