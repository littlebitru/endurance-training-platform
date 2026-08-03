import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type {
  GarminFitIssue,
  GarminFitPreview,
  Relationship,
  TrainingPlan,
  TrainingZone,
  WorkoutTemplate,
  WorkoutTemplateStep,
} from "./types";

type DurationMode = "time" | "distance" | "open";
type DistanceUnit = "km" | "m";

interface StepDraft {
  id: number;
  name: string;
  stepType: string;
  durationMode: DurationMode;
  durationValue: string;
  repetitions: string;
  recoverySeconds: string;
  targetType: string;
  targetMin: string;
  targetMax: string;
  description: string;
}

interface TemplateDraft {
  id: number | null;
  source: "new" | "system" | "coach";
  title: string;
  sport: string;
  workoutType: string;
  description: string;
  objective: string;
  difficulty: string;
  tags: string;
  equipment: string;
  intensity: string;
  steps: StepDraft[];
}

const SPORTS = ["running", "cycling", "swimming", "triathlon"];
const SPORT_MARKS: Record<string, string> = { running: "RUN", cycling: "BIKE", swimming: "SWIM", triathlon: "TRI" };
const WORKOUT_TYPES = ["recovery", "endurance", "long", "tempo", "threshold", "intervals", "vo2_max", "technique", "brick", "race", "strength"];
const TYPE_KEYS: Record<string, "typeRecovery" | "typeEndurance" | "typeLong" | "typeTempo" | "typeThreshold" | "typeIntervals" | "typeVo2Max" | "typeTechnique" | "typeBrick" | "typeRace" | "typeStrength"> = {
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
const SPORT_KEYS: Record<string, "sportRunning" | "sportCycling" | "sportSwimming" | "sportTriathlon"> = {
  running: "sportRunning",
  cycling: "sportCycling",
  swimming: "sportSwimming",
  triathlon: "sportTriathlon",
};

let draftId = 0;

function newStep(values: Partial<StepDraft> = {}): StepDraft {
  draftId += 1;
  return {
    id: draftId,
    name: "",
    stepType: "work",
    durationMode: "time",
    durationValue: "5",
    repetitions: "1",
    recoverySeconds: "",
    targetType: "free",
    targetMin: "",
    targetMax: "",
    description: "",
    ...values,
  };
}

function distanceUnitForSport(sport: string): DistanceUnit {
  return sport === "swimming" ? "m" : "km";
}

function distanceValueFromMeters(distanceMeters: number, sport: string): string {
  return String(distanceUnitForSport(sport) === "km" ? distanceMeters / 1000 : distanceMeters);
}

function distanceMetersFromDraft(step: StepDraft, sport: string): number {
  const value = Number(step.durationValue) || 0;
  return distanceUnitForSport(sport) === "km" ? value * 1000 : value;
}

function formatStepDistance(distanceMeters: number, sport: string): string {
  if (distanceUnitForSport(sport) === "m") return `${distanceMeters} m`;
  const kilometers = distanceMeters / 1000;
  return `${Number(kilometers.toFixed(3))} km`;
}

function stepToDraft(step: WorkoutTemplateStep, locale: "en" | "ru", sport: string): StepDraft {
  const durationMode: DurationMode = step.duration_seconds ? "time" : step.distance_meters ? "distance" : "open";
  return newStep({
    name: locale === "ru" ? step.name_ru || step.name : step.name,
    stepType: step.step_type,
    durationMode,
    durationValue: step.duration_seconds
      ? String(Number(step.duration_seconds) / 60)
      : step.distance_meters
        ? distanceValueFromMeters(step.distance_meters, sport)
        : "",
    repetitions: String(step.repetitions || 1),
    recoverySeconds: step.recovery_seconds ? String(step.recovery_seconds) : "",
    targetType: step.target_type || "free",
    targetMin: step.target_min == null ? "" : String(step.target_min),
    targetMax: step.target_max == null ? "" : String(step.target_max),
    description: locale === "ru" ? step.description_ru || step.description || "" : step.description || "",
  });
}

function emptyDraft(): TemplateDraft {
  return {
    id: null,
    source: "new",
    title: "",
    sport: "running",
    workoutType: "endurance",
    description: "",
    objective: "",
    difficulty: "all",
    tags: "",
    equipment: "",
    intensity: "Z2",
    steps: [
      newStep({ name: "Warm-up", stepType: "warmup", durationValue: "10", targetType: "heart_rate", targetMin: "1", targetMax: "2" }),
      newStep({ name: "Main set", stepType: "work", durationValue: "30", targetType: "heart_rate", targetMin: "2", targetMax: "2" }),
      newStep({ name: "Cool-down", stepType: "cooldown", durationValue: "10", targetType: "heart_rate", targetMin: "1", targetMax: "1" }),
    ],
  };
}

function templateDraft(template: WorkoutTemplate, locale: "en" | "ru"): TemplateDraft {
  return {
    id: template.id,
    source: template.source,
    title: locale === "ru" ? template.title_ru || template.title : template.title,
    sport: template.sport,
    workoutType: template.workout_type,
    description: locale === "ru" ? template.description_ru || template.description : template.description,
    objective: locale === "ru" ? template.objective_ru || template.objective : template.objective,
    difficulty: template.difficulty,
    tags: template.tags.join(", "),
    equipment: template.equipment.join(", "),
    intensity: template.intensity,
    steps: template.structured_steps.map((step) => stepToDraft(step, locale, template.sport)),
  };
}

function stepPayload(step: StepDraft, sport: string): WorkoutTemplateStep {
  const targetUsesZone = ["heart_rate", "pace", "power"].includes(step.targetType);
  return {
    name: step.name.trim(),
    step_type: step.stepType,
    description: step.description.trim(),
    repetitions: Math.max(1, Number(step.repetitions) || 1),
    duration_seconds: step.durationMode === "time" ? Math.round((Number(step.durationValue) || 0) * 60) || null : null,
    distance_meters: step.durationMode === "distance" ? Math.round(distanceMetersFromDraft(step, sport)) || null : null,
    recovery_seconds: Number(step.recoverySeconds) || null,
    target_type: step.targetType,
    target_min: step.targetMin || null,
    target_max: step.targetMax || step.targetMin || null,
    target_unit: targetUsesZone ? "zone" : step.targetType === "cadence" ? "rpm" : step.targetType === "rpe" ? "RPE" : "",
  };
}

function structureSummary(steps: StepDraft[], sport: string) {
  let seconds = 0;
  let meters = 0;
  let intervals = 0;
  steps.forEach((step) => {
    const repetitions = Math.max(1, Number(step.repetitions) || 1);
    if (step.durationMode === "time") seconds += (Number(step.durationValue) || 0) * 60 * repetitions;
    if (step.durationMode === "distance") meters += distanceMetersFromDraft(step, sport) * repetitions;
    seconds += (Number(step.recoverySeconds) || 0) * Math.max(0, repetitions - 1);
    if (step.stepType === "work") intervals += repetitions;
  });
  return { minutes: Math.round(seconds / 6) / 10, meters, intervals };
}

function athleteName(relationship: Relationship): string {
  return `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim() || relationship.athlete.username;
}

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateTime(date).slice(0, 10);
}

export function WorkoutLibraryPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sportFilter, setSportFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [selected, setSelected] = useState<WorkoutTemplate | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewAthleteId, setPreviewAthleteId] = useState("");
  const [previewZones, setPreviewZones] = useState<TrainingZone[]>([]);
  const [scheduleTemplate, setScheduleTemplate] = useState<WorkoutTemplate | null>(null);
  const [schedulePlanId, setSchedulePlanId] = useState("");
  const [scheduleWeekId, setScheduleWeekId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [garminAthleteId, setGarminAthleteId] = useState("");
  const [garminPreview, setGarminPreview] = useState<GarminFitPreview | null>(null);
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminDownloading, setGarminDownloading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [templatePage, planPage, athletePage] = await Promise.all([
        api.workoutTemplates(),
        api.plans(),
        api.athletes(),
      ]);
      setTemplates(templatePage.results);
      setPlans(planPage.results.filter((plan) => plan.publication_status !== "archived"));
      setRelationships(athletePage.results.filter((item) => item.is_active));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!previewAthleteId || !draft?.sport) {
      setPreviewZones([]);
      return;
    }
    api.trainingZones(Number(previewAthleteId), draft.sport)
      .then((response) => setPreviewZones(response.results))
      .catch(() => setPreviewZones([]));
  }, [draft?.sport, previewAthleteId]);

  useEffect(() => {
    if (!selected || !garminAthleteId) {
      setGarminPreview(null);
      return;
    }
    let cancelled = false;
    setGarminPreview(null);
    setGarminLoading(true);
    api.previewGarminFit(selected.id, Number(garminAthleteId), locale)
      .then((preview) => {
        if (!cancelled) setGarminPreview(preview);
      })
      .catch((caught) => {
        if (!cancelled) {
          setGarminPreview(null);
          setError(localizeApiError((caught as Error).message, t));
        }
      })
      .finally(() => {
        if (!cancelled) setGarminLoading(false);
      });
    return () => { cancelled = true; };
  }, [garminAthleteId, locale, selected, t]);

  const visibleTemplates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return templates.filter((template) => {
      if (sportFilter !== "all" && template.sport !== sportFilter) return false;
      if (sourceFilter !== "all" && template.source !== sourceFilter) return false;
      if (difficultyFilter !== "all" && template.difficulty !== difficultyFilter) return false;
      const title = locale === "ru" ? template.title_ru || template.title : template.title;
      const description = locale === "ru" ? template.description_ru || template.description : template.description;
      return !normalized || `${title} ${description} ${template.tags.join(" ")}`.toLocaleLowerCase(locale).includes(normalized);
    });
  }, [difficultyFilter, locale, query, sourceFilter, sportFilter, templates]);

  const selectedPlan = plans.find((plan) => String(plan.id) === schedulePlanId);
  const selectedWeek = selectedPlan?.weeks.find((week) => String(week.id) === scheduleWeekId);
  const draftSummary = draft ? structureSummary(draft.steps, draft.sport) : null;
  const previewRelationship = relationships.find((item) => String(item.athlete.id) === previewAthleteId);
  const garminRelationship = relationships.find((item) => String(item.athlete.id) === garminAthleteId);

  function openTemplate(template: WorkoutTemplate) {
    setSelected(template);
    setDraft(null);
    setGarminAthleteId("");
    setGarminPreview(null);
    setMessage("");
  }

  function startBuilder(template?: WorkoutTemplate) {
    setSelected(null);
    setDraft(template ? templateDraft(template, locale) : emptyDraft());
    setPreviewAthleteId("");
    setPreviewZones([]);
    setMessage("");
  }

  function changeDraftSport(sport: string) {
    setDraft((current) => {
      if (!current || current.sport === sport) return current;
      const currentUnit = distanceUnitForSport(current.sport);
      const nextUnit = distanceUnitForSport(sport);
      const steps = currentUnit === nextUnit ? current.steps : current.steps.map((step) => {
        if (step.durationMode !== "distance") return step;
        const meters = distanceMetersFromDraft(step, current.sport);
        return { ...step, durationValue: distanceValueFromMeters(meters, sport) };
      });
      return { ...current, sport, steps };
    });
  }

  function garminIssueLabel(issue: GarminFitIssue): string {
    if (issue.code === "missing_training_zone") {
      return t("garminMissingZone", {
        metric: issue.target_type?.replaceAll("_", " ") ?? "",
        zone: issue.zone_from === issue.zone_to ? `Z${issue.zone_from}` : `Z${issue.zone_from}–Z${issue.zone_to}`,
      });
    }
    if (issue.code === "rpe_target_not_supported" || issue.code === "guidance_only_target") {
      return t("garminRpeBlocked");
    }
    if (issue.code === "multisport_session_structure_required") return t("garminMultisportBlocked");
    if (issue.code === "missing_target_range") return t("garminMissingTarget");
    if (issue.code === "open_duration_step") return t("garminOpenDurationWarning");
    return t("garminCompatibilityIssue");
  }

  async function downloadGarminFit() {
    if (!selected || !garminAthleteId || !garminPreview?.can_export) return;
    setGarminDownloading(true);
    setError("");
    try {
      const file = await api.downloadGarminFit(selected.id, Number(garminAthleteId), locale);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(t("garminDownloadReady"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setGarminDownloading(false);
    }
  }

  function updateDraft<K extends keyof TemplateDraft>(field: K, value: TemplateDraft[K]) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function updateStep(id: number, field: keyof StepDraft, value: string) {
    setDraft((current) => current ? {
      ...current,
      steps: current.steps.map((step) => step.id === id ? { ...step, [field]: value } : step),
    } : current);
  }

  function changeStepDurationMode(id: number, durationMode: DurationMode) {
    setDraft((current) => current ? {
      ...current,
      steps: current.steps.map((step) => step.id === id ? {
        ...step,
        durationMode,
        durationValue: durationMode === "time" ? "5" : durationMode === "distance" ? (distanceUnitForSport(current.sport) === "km" ? "1" : "100") : "",
      } : step),
    } : current);
  }

  function moveStep(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const destination = index + direction;
      if (destination < 0 || destination >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[destination]] = [steps[destination], steps[index]];
      return { ...current, steps };
    });
  }

  function zoneLabel(step: StepDraft): string {
    if (!["heart_rate", "pace", "power"].includes(step.targetType)) return "";
    const lowerZone = Number(step.targetMin);
    const upperZone = Number(step.targetMax || step.targetMin);
    const zones = previewZones.filter(
      (zone) => zone.metric === step.targetType && zone.zone_number >= lowerZone && zone.zone_number <= upperZone,
    );
    if (!zones.length) return t("builderThresholdMissing");
    const lower = zones[0].display_range.split("–")[0];
    const upper = zones[zones.length - 1].display_range.split("–").at(-1);
    return `Z${lowerZone}${upperZone !== lowerZone ? `–Z${upperZone}` : ""} · ${lower}–${upper}`;
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draft.title.trim() || !draft.steps.length || draft.steps.some((step) => !step.name.trim())) return;
    setSaving(true);
    setError("");
    try {
      const summary = structureSummary(draft.steps, draft.sport);
      const payload = {
        title: draft.title.trim(),
        sport: draft.sport,
        workout_type: draft.workoutType,
        description: draft.description.trim(),
        objective: draft.objective.trim(),
        difficulty: draft.difficulty,
        tags: draft.tags.split(",").map((item) => item.trim()).filter(Boolean),
        equipment: draft.equipment.split(",").map((item) => item.trim()).filter(Boolean),
        intensity: draft.intensity.trim(),
        planned_duration_minutes: summary.minutes ? Math.max(1, Math.round(summary.minutes)) : null,
        planned_distance_km: summary.meters ? (summary.meters / 1000).toFixed(2) : null,
        structured_steps: draft.steps.map((step) => stepPayload(step, draft.sport)),
      };
      const saved = draft.source === "coach" && draft.id
        ? await api.updateWorkoutTemplate(draft.id, payload)
        : await api.createWorkoutTemplate(payload);
      await load();
      setDraft(null);
      setSelected(saved);
      setGarminAthleteId(previewAthleteId);
      setGarminPreview(null);
      setMessage(t("builderTemplateSaved"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setSaving(false);
    }
  }

  async function copyTemplate(template: WorkoutTemplate) {
    setError("");
    try {
      const copied = await api.duplicateWorkoutTemplate(template.id);
      await load();
      setSelected(null);
      setDraft(templateDraft(copied, locale));
      setMessage(t("builderCopyReady"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  function openSchedule(template: WorkoutTemplate) {
    const matchingPlan = plans.find((plan) => plan.primary_sport === template.sport) || plans[0];
    const week = matchingPlan?.weeks[0];
    setScheduleTemplate(template);
    setSchedulePlanId(matchingPlan ? String(matchingPlan.id) : "");
    setScheduleWeekId(week ? String(week.id) : "");
    setScheduledAt(week ? `${week.start_date}T07:00` : "");
    setMessage("");
  }

  function changeSchedulePlan(planId: string) {
    const plan = plans.find((item) => String(item.id) === planId);
    const week = plan?.weeks[0];
    setSchedulePlanId(planId);
    setScheduleWeekId(week ? String(week.id) : "");
    setScheduledAt(week ? `${week.start_date}T07:00` : "");
  }

  function changeScheduleWeek(weekId: string) {
    const week = selectedPlan?.weeks.find((item) => String(item.id) === weekId);
    setScheduleWeekId(weekId);
    setScheduledAt(week ? `${week.start_date}T07:00` : "");
  }

  async function assignTemplate(event: FormEvent) {
    event.preventDefault();
    if (!scheduleTemplate || !selectedWeek || !scheduledAt) return;
    setScheduling(true);
    setError("");
    try {
      await api.assignWorkoutTemplate(scheduleTemplate.id, {
        weekly_plan: selectedWeek.id,
        scheduled_at: new Date(scheduledAt).toISOString(),
        locale,
      });
      const targetPlanId = selectedPlan?.id;
      setScheduleTemplate(null);
      setMessage(t("builderWorkoutScheduled"));
      if (targetPlanId) navigate(`/plans?plan_id=${targetPlanId}`);
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setScheduling(false);
    }
  }

  if (user?.role !== "coach") return <Navigate replace to="/plans" />;

  return (
    <main className="workout-library-page">
      <section className="library-command-card">
        <div>
          <span className="eyebrow">{t("builderEyebrow")}</span>
          <h2>{t("builderTitle")}</h2>
          <p>{t("builderSubtitle")}</p>
        </div>
        <div className="library-command-metrics">
          <span><strong>{templates.filter((item) => item.source === "system").length}</strong><small>{t("builderCurated")}</small></span>
          <span><strong>{templates.filter((item) => item.source === "coach").length}</strong><small>{t("builderCoachTemplates")}</small></span>
          <span className="fit-foundation"><strong>FIT</strong><small>{t("builderGarminFoundation")}</small></span>
        </div>
        <button className="primary" onClick={() => startBuilder()} type="button">+ {t("builderCreateTemplate")}</button>
      </section>

      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}

      {!draft && !selected && (
        <>
          <section className="library-toolbar" aria-label={t("builderFilters")}>
            <label className="library-search"><span>{t("search")}</span><input onChange={(event) => setQuery(event.target.value)} placeholder={t("builderSearchPlaceholder")} value={query} /></label>
            <label><span>{t("sport")}</span><select onChange={(event) => setSportFilter(event.target.value)} value={sportFilter}><option value="all">{t("allSports")}</option>{SPORTS.map((sport) => <option key={sport} value={sport}>{t(SPORT_KEYS[sport])}</option>)}</select></label>
            <label><span>{t("builderSource")}</span><select onChange={(event) => setSourceFilter(event.target.value)} value={sourceFilter}><option value="all">{t("all")}</option><option value="system">{t("builderCurated")}</option><option value="coach">{t("builderMine")}</option></select></label>
            <label><span>{t("builderDifficulty")}</span><select onChange={(event) => setDifficultyFilter(event.target.value)} value={difficultyFilter}><option value="all">{t("all")}</option><option value="beginner">{t("experienceBeginner")}</option><option value="intermediate">{t("experienceIntermediate")}</option><option value="advanced">{t("experienceAdvanced")}</option></select></label>
          </section>

          {loading ? <div className="loading-card">{t("loading")}</div> : (
            <section className="template-catalog" aria-live="polite">
              {visibleTemplates.map((template) => {
                const title = locale === "ru" ? template.title_ru || template.title : template.title;
                const objective = locale === "ru" ? template.objective_ru || template.objective : template.objective;
                return (
                  <article className={`template-catalog-card ${template.sport}`} key={template.id}>
                    <header>
                      <span className="template-sport"><i>{SPORT_MARKS[template.sport]}</i>{t(SPORT_KEYS[template.sport])}</span>
                      <span className={`compatibility-pill ${template.compatibility.status}`}>{template.compatibility.garmin_ready ? t("builderGarminReady") : t("builderAdaptationRequired")}</span>
                    </header>
                    <div className="template-source-line"><span>{template.source === "system" ? t("builderProfessionalTemplate") : t("builderCoachTemplate")}</span><b>{t(TYPE_KEYS[template.workout_type])}</b></div>
                    <h3>{title}</h3>
                    <p>{objective}</p>
                    <div className="template-dose">
                      <span><strong>{template.structure_summary.total_duration_minutes || "—"}</strong><small>{t("minutes")}</small></span>
                      <span><strong>{template.structure_summary.total_distance_meters ? `${template.structure_summary.total_distance_km}` : "—"}</strong><small>km</small></span>
                      <span><strong>{template.structure_summary.work_intervals}</strong><small>{t("builderIntervals")}</small></span>
                    </div>
                    <div className="template-tags">{template.tags.slice(0, 3).map((tag) => <span key={tag}>{tag.replaceAll("_", " ")}</span>)}</div>
                    <footer><button className="secondary compact" onClick={() => openTemplate(template)} type="button">{t("builderPreview")}</button><button className="primary compact" onClick={() => openSchedule(template)} type="button">{t("builderSchedule")}</button></footer>
                  </article>
                );
              })}
              {!visibleTemplates.length && <div className="training-empty">{t("builderNoTemplates")}</div>}
            </section>
          )}
        </>
      )}

      {selected && (
        <section className={`template-detail-workspace ${selected.sport}`}>
          <button className="back-link" onClick={() => setSelected(null)} type="button">← {t("builderBackToLibrary")}</button>
          <div className="template-detail-header">
            <div><span className="template-sport"><i>{SPORT_MARKS[selected.sport]}</i>{t(SPORT_KEYS[selected.sport])} · {t(TYPE_KEYS[selected.workout_type])}</span><h2>{locale === "ru" ? selected.title_ru || selected.title : selected.title}</h2><p>{locale === "ru" ? selected.description_ru || selected.description : selected.description}</p></div>
            <div className="template-detail-actions"><button className="secondary" onClick={() => void copyTemplate(selected)} type="button">{t("builderCopyAndEdit")}</button>{selected.source === "coach" && <button className="secondary" onClick={() => startBuilder(selected)} type="button">{t("edit")}</button>}<button className="primary" onClick={() => openSchedule(selected)} type="button">{t("builderSchedule")}</button></div>
          </div>
          <div className="template-detail-summary"><span><small>{t("builderObjective")}</small><strong>{locale === "ru" ? selected.objective_ru || selected.objective : selected.objective}</strong></span><span><small>{t("builderDifficulty")}</small><strong>{selected.difficulty === "all" ? t("builderAllLevels") : t(selected.difficulty === "beginner" ? "experienceBeginner" : selected.difficulty === "intermediate" ? "experienceIntermediate" : "experienceAdvanced")}</strong></span><span><small>{t("builderCompatibility")}</small><strong>{selected.compatibility.garmin_ready ? t("builderGarminReady") : t("builderAdaptationRequired")}</strong></span></div>
          <section className="garmin-export-panel">
            <div className="garmin-export-intro">
              <span className="garmin-fit-mark">FIT <small>2.0</small></span>
              <div><span className="eyebrow">{t("garminExportEyebrow")}</span><h3>{t("garminExportTitle")}</h3><p>{t("garminExportHelp")}</p></div>
            </div>
            {relationships.length ? (
              <div className="garmin-export-flow">
                <div className={`garmin-export-step ${garminAthleteId ? "complete" : "active"}`}>
                  <span className="garmin-step-number">1</span>
                  <label className="garmin-athlete-select">{t("garminStepChooseAthlete")}<select onChange={(event) => setGarminAthleteId(event.target.value)} value={garminAthleteId}><option value="">{t("garminChooseAthlete")}</option>{relationships.map((item) => <option key={item.id} value={item.athlete.id}>{athleteName(item)}</option>)}</select><small>{t("garminSelectionNotAssignment")}</small></label>
                </div>
                <div className={`garmin-export-step ${garminPreview?.can_export ? "complete" : garminAthleteId ? "active" : "pending"}`}>
                  <span className="garmin-step-number">2</span>
                  <div className={`garmin-export-status ${garminPreview?.status ?? "pending"}`} aria-live="polite">
                    {garminLoading ? <strong>{t("garminChecking")}</strong> : garminPreview ? <><strong>{garminPreview.can_export ? t("garminFileReady") : t("garminNeedsAttention")}</strong><small>{t("garminExportSummary", { count: garminPreview.step_count, version: garminPreview.sdk_version })}</small>{[...garminPreview.issues, ...garminPreview.warnings].length > 0 && <ul>{[...garminPreview.issues, ...garminPreview.warnings].map((issue, index) => <li key={`${issue.code}-${issue.step_index ?? 0}-${index}`}>{garminIssueLabel(issue)}</li>)}</ul>}</> : <><strong>{t("garminStepCheckZones")}</strong><small>{t("garminChooseAthleteHelp")}</small></>}
                  </div>
                </div>
                <div className={`garmin-export-step garmin-export-action ${garminPreview?.can_export ? "active" : "pending"}`}>
                  <span className="garmin-step-number">3</span>
                  <div><strong>{t("garminStepDownload")}</strong><small>{garminRelationship ? t("garminDownloadForAthlete", { athlete: athleteName(garminRelationship) }) : t("garminDownloadAfterCheck")}</small></div>
                  <button className="primary garmin-download-button" disabled={garminDownloading || garminLoading || !garminPreview?.can_export} onClick={() => void downloadGarminFit()} type="button">{garminDownloading ? t("garminGenerating") : t("garminDownloadFit")}</button>
                </div>
              </div>
            ) : (
              <div className="garmin-no-athletes"><span>1</span><div><strong>{t("garminNoAthletesTitle")}</strong><p>{t("garminNoAthletesHelp")}</p></div><button className="secondary" onClick={() => navigate("/athletes")} type="button">{t("garminOpenAthletes")}</button></div>
            )}
          </section>
          <div className="workout-structure-preview">
            {selected.structured_steps.map((step, index) => (
              <article className={step.step_type} key={`${step.name}-${index}`}>
                <span>{index + 1}</span><div><strong>{locale === "ru" ? step.name_ru || step.name : step.name}</strong><small>{step.duration_seconds ? `${Number(step.duration_seconds) / 60} ${t("minutes")}` : step.distance_meters ? formatStepDistance(step.distance_meters, selected.sport) : t("builderOpenDuration")}{Number(step.repetitions || 1) > 1 ? ` · ${step.repetitions}× · ${t("recovery")} ${step.recovery_seconds || 0}s` : ""}</small></div><b>{step.target_unit === "zone" ? `Z${step.target_min}${step.target_max !== step.target_min ? `–Z${step.target_max}` : ""}` : step.target_type === "free" ? t("targetFree") : `${step.target_min || ""} ${step.target_unit || ""}`}</b>
              </article>
            ))}
          </div>
        </section>
      )}

      {draft && (
        <form className="template-builder-workspace" onSubmit={(event) => void saveTemplate(event)}>
          <header className="builder-workspace-header"><div><button className="back-link" onClick={() => setDraft(null)} type="button">← {t("builderBackToLibrary")}</button><span className="eyebrow">{draft.source === "coach" ? t("builderEditTemplate") : t("builderNewTemplate")}</span><h2>{draft.title || t("builderUntitled")}</h2></div><div><button className="secondary" onClick={() => setDraft(null)} type="button">{t("cancel")}</button><button className="primary" disabled={saving} type="submit">{saving ? t("saving") : t("builderSaveTemplate")}</button></div></header>
          <div className="builder-layout">
            <section className="builder-canvas">
              <fieldset className="builder-meta-card"><legend>{t("builderSessionDefinition")}</legend><div className="form-grid"><label>{t("workoutTitle")}<input onChange={(event) => updateDraft("title", event.target.value)} required value={draft.title} /></label><label>{t("sport")}<select onChange={(event) => changeDraftSport(event.target.value)} value={draft.sport}>{SPORTS.map((sport) => <option key={sport} value={sport}>{t(SPORT_KEYS[sport])}</option>)}</select></label><label>{t("workoutType")}<select onChange={(event) => updateDraft("workoutType", event.target.value)} value={draft.workoutType}>{WORKOUT_TYPES.map((type) => <option key={type} value={type}>{t(TYPE_KEYS[type])}</option>)}</select></label><label>{t("builderDifficulty")}<select onChange={(event) => updateDraft("difficulty", event.target.value)} value={draft.difficulty}><option value="all">{t("builderAllLevels")}</option><option value="beginner">{t("experienceBeginner")}</option><option value="intermediate">{t("experienceIntermediate")}</option><option value="advanced">{t("experienceAdvanced")}</option></select></label><label>{t("intensity")}<input onChange={(event) => updateDraft("intensity", event.target.value)} value={draft.intensity} /></label><label>{t("builderTags")}<input onChange={(event) => updateDraft("tags", event.target.value)} placeholder="threshold, intervals" value={draft.tags} /></label></div><label>{t("builderObjective")}<input onChange={(event) => updateDraft("objective", event.target.value)} value={draft.objective} /></label><label>{t("description")}<textarea onChange={(event) => updateDraft("description", event.target.value)} rows={3} value={draft.description} /></label><label>{t("builderEquipment")}<input onChange={(event) => updateDraft("equipment", event.target.value)} placeholder="running shoes, heart rate monitor" value={draft.equipment} /></label></fieldset>
              <section className="builder-athlete-context">
                <span className="builder-context-number">1</span>
                <div><strong>{t("builderAthleteContextTitle")}</strong><p>{t("builderAthleteContextHelp")}</p></div>
                {relationships.length ? <label>{t("builderAthletePreview")}<select onChange={(event) => setPreviewAthleteId(event.target.value)} value={previewAthleteId}><option value="">{t("builderNoAthletePreview")}</option>{relationships.map((item) => <option key={item.id} value={item.athlete.id}>{athleteName(item)}</option>)}</select></label> : <button className="secondary" onClick={() => navigate("/athletes")} type="button">{t("garminOpenAthletes")}</button>}
              </section>
              <div className="builder-step-heading"><div><span className="eyebrow">{t("builderStructure")}</span><h3>{t("builderWorkoutSteps")}</h3></div><button className="secondary compact" onClick={() => updateDraft("steps", [...draft.steps, newStep({ name: t("stepWork") })])} type="button">+ {t("addStep")}</button></div>
              <div className="professional-step-list">
                {draft.steps.map((step, index) => (
                  <article className={`professional-step ${step.stepType}`} key={step.id}>
                    <header><span>{index + 1}</span><div><strong>{step.name || t("unnamedStep")}</strong><small>{Number(step.repetitions) > 1 ? t("builderRepeatBlock", { count: Number(step.repetitions) }) : t("builderSingleStep")}</small></div><div className="step-order-actions"><button aria-label={t("builderMoveUp")} disabled={index === 0} onClick={() => moveStep(index, -1)} type="button">↑</button><button aria-label={t("builderMoveDown")} disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)} type="button">↓</button><button aria-label={t("removeStep")} disabled={draft.steps.length === 1} onClick={() => updateDraft("steps", draft.steps.filter((item) => item.id !== step.id))} type="button">×</button></div></header>
                    <div className="step-editor-grid">
                      <label>{t("stepType")}<select onChange={(event) => updateStep(step.id, "stepType", event.target.value)} value={step.stepType}><option value="warmup">{t("stepWarmup")}</option><option value="work">{t("stepWork")}</option><option value="recovery">{t("stepRecovery")}</option><option value="cooldown">{t("stepCooldown")}</option><option value="steady">{t("stepSteady")}</option><option value="drill">{t("stepDrill")}</option></select></label>
                      <label className="step-name-field">{t("stepName")}<input onChange={(event) => updateStep(step.id, "name", event.target.value)} required value={step.name} /></label>
                      <label>{t("builderDurationType")}<select onChange={(event) => changeStepDurationMode(step.id, event.target.value as DurationMode)} value={step.durationMode}><option value="time">{t("builderTime")}</option><option value="distance">{t("builderDistance")}</option><option value="open">{t("builderOpen")}</option></select></label>
                      {step.durationMode === "time" && <label>{t("stepDurationMinutes")}<input min="0.1" onChange={(event) => updateStep(step.id, "durationValue", event.target.value)} required step="0.1" type="number" value={step.durationValue} /></label>}
                      {step.durationMode === "distance" && <label className="distance-input-field">{distanceUnitForSport(draft.sport) === "km" ? t("distanceKilometers") : t("distanceMeters")}<span className="distance-input-control"><input max={distanceUnitForSport(draft.sport) === "km" ? "500" : "100000"} min={distanceUnitForSport(draft.sport) === "km" ? "0.01" : "1"} onChange={(event) => updateStep(step.id, "durationValue", event.target.value)} required step={distanceUnitForSport(draft.sport) === "km" ? "0.01" : "1"} type="number" value={step.durationValue} /><b>{distanceUnitForSport(draft.sport)}</b></span><small>{distanceUnitForSport(draft.sport) === "km" ? t("builderDistanceKmHelp") : t("builderDistanceMetersHelp")}</small></label>}
                      <label>{t("repetitions")}<input max="100" min="1" onChange={(event) => updateStep(step.id, "repetitions", event.target.value)} type="number" value={step.repetitions} /></label>
                      {Number(step.repetitions) > 1 && <label>{t("recoverySeconds")}<input min="0" onChange={(event) => updateStep(step.id, "recoverySeconds", event.target.value)} type="number" value={step.recoverySeconds} /></label>}
                      <label>{t("targetType")}<select onChange={(event) => updateStep(step.id, "targetType", event.target.value)} value={step.targetType}><option value="free">{t("targetFree")}</option><option value="heart_rate">{t("targetHeartRate")}</option><option value="pace">{t("targetPace")}</option><option value="power">{t("targetPower")}</option><option value="cadence">{t("builderCadence")}</option><option value="rpe">RPE</option></select></label>
                      {step.targetType !== "free" && <><label>{["heart_rate", "pace", "power"].includes(step.targetType) ? t("targetZoneFrom") : t("targetMin")}<input max={step.targetType === "rpe" ? 10 : step.targetType === "cadence" ? 250 : 7} min={step.targetType === "cadence" ? 20 : 1} onChange={(event) => updateStep(step.id, "targetMin", event.target.value)} type="number" value={step.targetMin} /></label><label>{["heart_rate", "pace", "power"].includes(step.targetType) ? t("targetZoneTo") : t("targetMax")}<input max={step.targetType === "rpe" ? 10 : step.targetType === "cadence" ? 250 : 7} min={step.targetType === "cadence" ? 20 : 1} onChange={(event) => updateStep(step.id, "targetMax", event.target.value)} type="number" value={step.targetMax} /></label></>}
                    </div>
                    {["heart_rate", "pace", "power"].includes(step.targetType) && <div className={`zone-resolution ${previewZones.length ? "resolved" : "pending"}`}><span>{t("automaticTarget")}</span><strong>{previewAthleteId ? zoneLabel(step) : t("builderChooseAthletePreview")}</strong></div>}
                    <label>{t("exerciseDescription")}<textarea onChange={(event) => updateStep(step.id, "description", event.target.value)} rows={2} value={step.description} /></label>
                  </article>
                ))}
              </div>
            </section>
            <aside className="builder-inspector">
              <span className="eyebrow">{t("builderLivePreview")}</span><h3>{t("builderSessionDose")}</h3>
              <div className="builder-dose-ring"><strong>{draftSummary?.minutes || "—"}</strong><small>{t("minutes")}</small></div>
              <div className="builder-dose-metrics"><span><small>{t("builderDistance")}</small><strong>{draftSummary?.meters ? formatStepDistance(draftSummary.meters, draft.sport) : "—"}</strong></span><span><small>{t("builderIntervals")}</small><strong>{draftSummary?.intervals || 0}</strong></span><span><small>{t("structuredSteps")}</small><strong>{draft.steps.length}</strong></span></div>
              <div className="builder-profile-bars">{draft.steps.map((step) => <i className={step.stepType} key={step.id} style={{ flexGrow: Math.max(1, Number(step.durationValue) * Number(step.repetitions || 1)), height: `${30 + Math.min(65, Number(step.targetMax || step.targetMin || 1) * 11)}%` }} />)}</div>
              <div className="builder-preview-subject"><small>{t("builderAthletePreview")}</small><strong>{previewRelationship ? athleteName(previewRelationship) : t("builderNoAthletePreview")}</strong><p>{previewRelationship ? t("builderPreviewOnlyHelp") : t("builderAthletePreviewHelp")}</p></div>
              <div className={`builder-compatibility ${draft.steps.some((step) => step.targetType === "rpe") ? "adaptation_required" : "ready"}`}><strong>{draft.steps.some((step) => step.targetType === "rpe") ? t("builderAdaptationRequired") : t("builderGarminReady")}</strong><p>{draft.steps.some((step) => step.targetType === "rpe") ? t("builderRpeCompatibility") : t("builderCompatibilityReadyHelp")}</p></div>
            </aside>
          </div>
        </form>
      )}

      {scheduleTemplate && (
        <div className="editor-backdrop" role="presentation">
          <section className="editor-panel schedule-template-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-template-title">
            <header><div><span className="eyebrow">{t("builderCalendarAssignment")}</span><h2 id="schedule-template-title">{locale === "ru" ? scheduleTemplate.title_ru || scheduleTemplate.title : scheduleTemplate.title}</h2></div><button className="icon-button" onClick={() => setScheduleTemplate(null)} type="button">×</button></header>
            <form onSubmit={(event) => void assignTemplate(event)}><label>{t("trainingPlan")}<select onChange={(event) => changeSchedulePlan(event.target.value)} required value={schedulePlanId}><option value="">{t("builderChoosePlan")}</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label><label>{t("weekLabel")}<select disabled={!selectedPlan} onChange={(event) => changeScheduleWeek(event.target.value)} required value={scheduleWeekId}><option value="">{t("builderChooseWeek")}</option>{selectedPlan?.weeks.map((week) => <option key={week.id} value={week.id}>{t("week", { number: week.week_number })} · {week.start_date}</option>)}</select></label><label>{t("scheduledAt")}<input disabled={!selectedWeek} max={selectedWeek ? `${addDays(selectedWeek.start_date, 6)}T23:59` : undefined} min={selectedWeek ? `${selectedWeek.start_date}T00:00` : undefined} onChange={(event) => setScheduledAt(event.target.value)} required type="datetime-local" value={scheduledAt || localDateTime(new Date())} /></label><div className="schedule-context"><span>{SPORT_MARKS[scheduleTemplate.sport]}</span><div><strong>{t("builderPersonalTargetsOnAssignment")}</strong><small>{t("builderPersonalTargetsOnAssignmentHelp")}</small></div></div><div className="form-actions"><button className="secondary" onClick={() => setScheduleTemplate(null)} type="button">{t("cancel")}</button><button className="primary" disabled={scheduling || !selectedWeek} type="submit">{scheduling ? t("saving") : t("builderAddToCalendar")}</button></div></form>
          </section>
        </div>
      )}
    </main>
  );
}
