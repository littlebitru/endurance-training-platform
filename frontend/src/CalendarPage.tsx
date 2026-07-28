import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type { CalendarEvent, PlanPublicationStatus, Relationship, TrainingCalendar } from "./types";

type CalendarView = "week" | "month";

const sportKeys = {
  running: "sportRunning",
  cycling: "sportCycling",
  swimming: "sportSwimming",
  triathlon: "sportTriathlon",
} as const;

const sportMarks: Record<string, string> = {
  running: "RUN",
  cycling: "BIKE",
  swimming: "SWIM",
  triathlon: "TRI",
};

export function CalendarPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const [searchParams] = useSearchParams();
  const reviewPlanId = positiveInteger(searchParams.get("plan_id"));
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => parseCalendarDate(searchParams.get("date")) ?? new Date());
  const [calendar, setCalendar] = useState<TrainingCalendar | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [athleteId, setAthleteId] = useState(() => searchParams.get("athlete_id") ?? "");
  const [sport, setSport] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [reviewPlanStatus, setReviewPlanStatus] = useState<PlanPublicationStatus | "">(
    reviewPlanId ? "draft" : "",
  );
  const [publicationMessage, setPublicationMessage] = useState("");
  const [error, setError] = useState("");
  const isCoach = user?.role === "coach";
  const range = useMemo(() => calendarRange(anchor, view), [anchor, view]);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.calendar(
        dateKey(range.start),
        dateKey(range.end),
        athleteId ? Number(athleteId) : undefined,
        sport || undefined,
      );
      setCalendar(result);
      if (reviewPlanId) {
        const reviewEvent = result.events.find((event) => event.plan_id === reviewPlanId);
        if (reviewEvent?.plan_publication_status) {
          setReviewPlanStatus(reviewEvent.plan_publication_status);
        }
      }
      setSelected((current) => current
        ? result.events.find((event) => event.event_id === current.event_id) ?? null
        : null);
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setLoading(false);
    }
  }, [athleteId, range.end, range.start, reviewPlanId, sport, t]);

  useEffect(() => {
    if (!user) return;
    void loadCalendar();
  }, [loadCalendar, user]);

  useEffect(() => {
    if (!isCoach) return;
    api.athletes()
      .then((response) => setRelationships(response.results.filter((item) => item.is_active)))
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)));
  }, [isCoach, t]);

  const days = useMemo(() => datesBetween(range.start, range.end), [range.end, range.start]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of calendar?.events ?? []) {
      const key = dateKey(new Date(event.starts_at));
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    return grouped;
  }, [calendar]);
  const attentionEvents = (calendar?.events ?? []).filter((event) => event.attention_required);
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const periodTitle = view === "month"
    ? anchor.toLocaleDateString(dateLocale, { month: "long", year: "numeric" })
    : `${range.start.toLocaleDateString(dateLocale, { day: "numeric", month: "short" })} — ${range.end.toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" })}`;

  function movePeriod(direction: number) {
    setAnchor((current) => {
      const next = new Date(current);
      if (view === "month") next.setMonth(next.getMonth() + direction, 1);
      else next.setDate(next.getDate() + direction * 7);
      return next;
    });
  }

  async function publishReviewedPlan() {
    if (!reviewPlanId) return;
    setPublishing(true);
    setError("");
    try {
      await api.publishPlan(reviewPlanId);
      setReviewPlanStatus("published");
      setPublicationMessage(t("planPublished"));
      await loadCalendar();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <section className="calendar-heading">
        <div>
          <span className="eyebrow">{t("calendarControlCenter")}</span>
          <h2>{t("trainingCalendar")}</h2>
          <p>{isCoach ? t("coachCalendarIntro") : t("athleteCalendarIntro")}</p>
        </div>
        <div className="calendar-heading-badge">
          <strong>{calendar?.summary.completion_rate ?? 0}%</strong>
          <small>{t("completionRate")}</small>
        </div>
      </section>

      {isCoach && reviewPlanId && reviewPlanStatus === "draft" && (
        <section className="plan-review-banner" role="status">
          <span className="plan-review-mark">DRAFT</span>
          <div>
            <strong>{t("reviewGeneratedPlan")}</strong>
            <p>{t("reviewGeneratedPlanText")}</p>
          </div>
          <button className="primary" disabled={publishing} onClick={() => void publishReviewedPlan()} type="button">
            {publishing ? t("publishingPlan") : t("publishToAthlete")}
          </button>
        </section>
      )}
      {publicationMessage && <div className="notice" role="status">{publicationMessage}</div>}

      <section className="calendar-kpis">
        <CalendarKpi label={t("plannedSessions")} value={calendar?.summary.planned_count ?? 0} tone="planned" />
        <CalendarKpi label={t("completedSessions")} value={calendar?.summary.completed_count ?? 0} tone="completed" />
        <CalendarKpi label={t("averageCompliance")} value={calendar?.summary.average_compliance !== null && calendar ? `${calendar.summary.average_compliance}%` : "—"} tone="compliance" />
        <CalendarKpi label={t("attentionNeeded")} value={calendar?.summary.attention_count ?? 0} tone="attention" />
        <CalendarKpi label={t("actualLoad")} value={Math.round(Number(calendar?.summary.training_load_score ?? 0))} tone="load" />
      </section>

      <section className="calendar-workspace">
        <div className="calendar-toolbar">
          <div className="calendar-period-nav">
            <button aria-label={t("previousPeriod")} onClick={() => movePeriod(-1)} type="button">←</button>
            <button className="today-button" onClick={() => setAnchor(new Date())} type="button">{t("today")}</button>
            <button aria-label={t("nextPeriod")} onClick={() => movePeriod(1)} type="button">→</button>
            <h3>{periodTitle}</h3>
          </div>
          <div className="calendar-controls">
            {isCoach && (
              <label>{t("athlete")}
                <select value={athleteId} onChange={(event) => setAthleteId(event.target.value)}>
                  <option value="">{t("allAthletes")}</option>
                  {relationships.map((relationship) => (
                    <option key={relationship.id} value={relationship.athlete.id}>{athleteName(relationship)}</option>
                  ))}
                </select>
              </label>
            )}
            <label>{t("sport")}
              <select value={sport} onChange={(event) => setSport(event.target.value)}>
                <option value="">{t("allSports")}</option>
                {Object.entries(sportKeys).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
              </select>
            </label>
            <div className="calendar-view-switch" role="group" aria-label={t("calendarView")}>
              <button className={view === "week" ? "active" : ""} onClick={() => setView("week")} type="button">{t("weekView")}</button>
              <button className={view === "month" ? "active" : ""} onClick={() => setView("month")} type="button">{t("monthView")}</button>
            </div>
          </div>
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <div className="calendar-loading"><span />{t("loading")}</div> : (
          <div className={`unified-calendar ${view}`}>
            {days.map((day) => {
              const events = eventsByDate.get(dateKey(day)) ?? [];
              const outsideMonth = view === "month" && day.getMonth() !== anchor.getMonth();
              return (
                <section className={`unified-calendar-day ${events.length ? "has-events" : ""} ${outsideMonth ? "outside" : ""} ${isSameDate(day, new Date()) ? "today" : ""}`} key={dateKey(day)}>
                  <header>
                    <span>{day.toLocaleDateString(dateLocale, { weekday: "short" })}</span>
                    <strong>{day.getDate()}</strong>
                  </header>
                  <div className="calendar-events">
                    {events.map((event) => (
                      <button className={`unified-calendar-event ${event.sport} ${event.status} ${event.plan_publication_status === "draft" ? "draft-plan" : ""} ${event.attention_required ? "needs-attention" : ""}`} key={event.event_id} onClick={() => setSelected(event)} type="button">
                        <span className="event-sport">{sportMarks[event.sport] ?? "ACT"}</span>
                        {isCoach && event.plan_publication_status === "draft" && <span className="event-draft">{t("draft")}</span>}
                        <strong>{event.title || t("unplannedActivity")}</strong>
                        {isCoach && <small className="event-athlete">{event.athlete.name}</small>}
                        <small>{new Date(event.starts_at).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })} · {eventMetrics(event, t("minutes"))}</small>
                        <EventState event={event} />
                      </button>
                    ))}
                    {!events.length && <span className="calendar-day-empty">·</span>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section className="calendar-attention">
        <div className="attention-heading">
          <div><span className="eyebrow">{t("coachReviewQueue")}</span><h3>{t("attentionNeeded")}</h3><p>{t("attentionQueueIntro")}</p></div>
          <span>{attentionEvents.length}</span>
        </div>
        {attentionEvents.length ? (
          <div className="attention-list">
            {attentionEvents.slice(0, 8).map((event) => (
              <button key={event.event_id} onClick={() => setSelected(event)} type="button">
                <span className={`attention-sport ${event.sport}`}>{sportMarks[event.sport] ?? "ACT"}</span>
                <div><strong>{event.title}</strong><small>{event.athlete.name} · {new Date(event.starts_at).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}</small></div>
                <span className="attention-reason">{t(attentionKey(event.attention_reason))}</span>
                <i>→</i>
              </button>
            ))}
          </div>
        ) : <div className="calendar-all-clear"><span>✓</span><div><strong>{t("allClear")}</strong><small>{t("allClearText")}</small></div></div>}
      </section>

      {selected && <CalendarEventDetail event={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function CalendarKpi({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return <article className={`calendar-kpi ${tone}`}><small>{label}</small><strong>{value}</strong><i /></article>;
}

function EventState({ event }: { event: CalendarEvent }) {
  const { t } = useLanguage();
  if (event.status === "completed") return <span className="event-state completed">✓ {event.compliance_score !== null ? `${event.compliance_score}%` : t("statusCompleted")}</span>;
  if (event.status === "missed") return <span className="event-state missed">! {t("missed")}</span>;
  if (event.status === "skipped") return <span className="event-state skipped">— {t("statusSkipped")}</span>;
  if (event.kind === "activity") return <span className="event-state unplanned">+ {t("unplanned")}</span>;
  return <span className="event-state planned">{t("statusPlanned")}</span>;
}

function CalendarEventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { locale, t } = useLanguage();
  const navigate = useNavigate();
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  return (
    <div className="editor-backdrop" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) onClose(); }}>
      <section className={`editor-panel calendar-event-detail ${event.sport}`} aria-modal="true" role="dialog">
        <button className="close" onClick={onClose} aria-label={t("close")} type="button">×</button>
        <header>
          <span className={`calendar-detail-sport ${event.sport}`}>{sportMarks[event.sport] ?? "ACT"}</span>
          <div>
            <span className="eyebrow">{event.plan_title || t("unplannedActivity")}</span>
            {event.plan_publication_status === "draft" && <span className="calendar-detail-draft">{t("draftPlanPrivate")}</span>}
            <h2>{event.title || t("unplannedActivity")}</h2>
            <p>{event.athlete.name} · {new Date(event.starts_at).toLocaleString(dateLocale, { dateStyle: "long", timeStyle: "short" })}</p>
          </div>
          <EventState event={event} />
        </header>
        <div className="calendar-comparison">
          <ComparisonMetric label={t("duration")} planned={minutes(event.planned_duration_minutes, t("minutes"))} actual={minutes(event.actual_duration_minutes, t("minutes"))} />
          <ComparisonMetric label={t("distance")} planned={kilometers(event.planned_distance_km)} actual={kilometers(event.actual_distance_km)} />
          <ComparisonMetric label={t("trainingLoad")} planned="—" actual={event.training_load_score ? String(Math.round(Number(event.training_load_score))) : "—"} />
          <ComparisonMetric label={t("compliance")} planned={t("targetLabel")} actual={event.compliance_score !== null ? `${event.compliance_score}%` : "—"} />
        </div>
        {event.attention_required && (
          <div className="calendar-attention-note">
            <span>!</span><div><strong>{t(attentionKey(event.attention_reason))}</strong><small>{t("reviewAndAdapt")}</small></div>
          </div>
        )}
        {event.activities.length > 0 && (
          <section className="calendar-actual-details">
            <span className="eyebrow">{t("recordedExecution")}</span>
            <div>
              <DetailMetric label={t("averageHeartRateShort")} value={event.activities[0].average_heart_rate ? `${event.activities[0].average_heart_rate} bpm` : "—"} />
              <DetailMetric label={t("power")} value={event.activities[0].average_power ? `${event.activities[0].average_power} W` : "—"} />
              <DetailMetric label={t("averagePace")} value={pace(event.activities[0].average_pace_seconds_per_km)} />
              <DetailMetric label={t("matchConfidence")} value={event.match_confidence || "—"} />
            </div>
          </section>
        )}
        <footer>
          {event.workout_id && <button className="secondary" onClick={() => navigate("/plans")} type="button">{t("openInPlan")}</button>}
          {event.activity_ids[0] && <button className="primary" onClick={() => navigate(`/activities?activity=${event.activity_ids[0]}`)} type="button">{t("openFullAnalysis")}</button>}
        </footer>
      </section>
    </div>
  );
}

function ComparisonMetric({ label, planned, actual }: { label: string; planned: string; actual: string }) {
  const { t } = useLanguage();
  return <article><span>{label}</span><div><small>{t("plannedLabel")}</small><strong>{planned}</strong></div><i>→</i><div><small>{t("actualLabel")}</small><strong>{actual}</strong></div></article>;
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <article><small>{label}</small><strong>{value}</strong></article>;
}

function calendarRange(anchor: Date, view: CalendarView) {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start: startOfWeek(monthStart), end: addDays(startOfWeek(addDays(monthEnd, 7)), -1) };
}

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function datesBetween(start: Date, end: Date) {
  const dates: Date[] = [];
  for (let date = new Date(start); date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function isSameDate(left: Date, right: Date) {
  return dateKey(left) === dateKey(right);
}

function parseCalendarDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return dateKey(parsed) === value ? parsed : null;
}

function positiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function athleteName(relationship: Relationship) {
  return `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim() || relationship.athlete.username;
}

function eventMetrics(event: CalendarEvent, minuteUnit: string) {
  const duration = event.actual_duration_minutes ?? event.planned_duration_minutes;
  const distance = event.actual_distance_km ?? event.planned_distance_km;
  return `${duration ? `${Math.round(Number(duration))} ${minuteUnit}` : "—"}${distance ? ` · ${Number(distance).toFixed(1)} km` : ""}`;
}

function minutes(value: string | number | null, unit: string) {
  return value !== null && value !== "" ? `${Math.round(Number(value))} ${unit}` : "—";
}

function kilometers(value: string | null) {
  return value ? `${Number(value).toFixed(2)} km` : "—";
}

function pace(value: number | null) {
  return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")} /km` : "—";
}

function attentionKey(reason: string): "missedWorkout" | "skippedWorkout" | "lowCompliance" | "belowTargetReason" | "aboveTargetReason" {
  return ({
    missed: "missedWorkout",
    skipped: "skippedWorkout",
    low_compliance: "lowCompliance",
    below_target: "belowTargetReason",
    above_target: "aboveTargetReason",
  } as const)[reason as "missed"] || "lowCompliance";
}
