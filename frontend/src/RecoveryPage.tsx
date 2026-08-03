import { FormEvent, useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type {
  RecoveryInsights,
  RecoveryPoint,
  RecoveryRoster,
  RecoveryRosterEntry,
  Relationship,
  WellnessCheckIn,
} from "./types";

type CheckInDraft = {
  sleepHours: string;
  sleepQuality: number;
  fatigue: number;
  stress: number;
  muscleSoreness: number;
  overallFeeling: number;
  restingHeartRate: string;
  hrv: string;
  illnessSeverity: number;
  injurySeverity: number;
  notes: string;
  shareWithCoach: boolean;
};

const initialDraft: CheckInDraft = {
  sleepHours: "8",
  sleepQuality: 3,
  fatigue: 3,
  stress: 3,
  muscleSoreness: 3,
  overallFeeling: 3,
  restingHeartRate: "",
  hrv: "",
  illnessSeverity: 0,
  injurySeverity: 0,
  notes: "",
  shareWithCoach: true,
};

const statusTranslationKeys = {
  ready: "recoveryReady",
  monitor: "recoveryMonitor",
  recovery_focus: "recoveryFocus",
  missing: "recoveryMissing",
} as const;

const signalTranslationKeys = {
  short_sleep: "signalShortSleep",
  poor_sleep: "signalPoorSleep",
  high_fatigue: "signalHighFatigue",
  high_stress: "signalHighStress",
  high_soreness: "signalHighSoreness",
  illness_reported: "signalIllness",
  injury_reported: "signalInjury",
  elevated_resting_hr: "signalElevatedRestingHr",
  suppressed_hrv: "signalSuppressedHrv",
  check_in_overdue: "signalCheckInOverdue",
  no_check_in: "signalNoCheckIn",
} as const;

const adviceTranslationKeys = {
  ready: "recoveryAdviceReady",
  monitor: "recoveryAdviceMonitor",
  recovery_focus: "recoveryAdviceFocus",
} as const;

export function RecoveryPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [roster, setRoster] = useState<RecoveryRoster | null>(null);
  const [insights, setInsights] = useState<RecoveryInsights | null>(null);
  const [todayCheckIn, setTodayCheckIn] = useState<WellnessCheckIn | null>(null);
  const [days, setDays] = useState<14 | 28 | 90>(28);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isCoach = user?.role === "coach";
  const selectedAthleteId = Number(searchParams.get("athlete_id")) || undefined;

  useEffect(() => {
    if (!user) return;
    if (user.role === "coach") {
      setLoading(true);
      Promise.all([api.athletes(), api.recoveryRoster()])
        .then(([athleteResponse, rosterResponse]) => {
          setRelationships(athleteResponse.results);
          setRoster(rosterResponse);
          if (!selectedAthleteId && rosterResponse.athletes.length) {
            setSearchParams({ athlete_id: String(rosterResponse.athletes[0].athlete.id) }, { replace: true });
          }
        })
        .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
        .finally(() => setLoading(false));
      return;
    }
    const today = localDateKey(new Date());
    api.wellnessCheckIns(today, today)
      .then((response) => setTodayCheckIn(response.results[0] ?? null))
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)));
  }, [refreshVersion, selectedAthleteId, setSearchParams, t, user]);

  useEffect(() => {
    if (!user || (user.role === "coach" && !selectedAthleteId)) {
      setInsights(null);
      return;
    }
    setLoading(true);
    setError("");
    api.recoveryInsights(selectedAthleteId, days)
      .then(setInsights)
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [days, refreshVersion, selectedAthleteId, t, user]);

  const selectedRelationship = relationships.find(
    (relationship) => relationship.athlete.id === selectedAthleteId,
  );

  return (
    <div className="recovery-page">
      <div className="section-title recovery-title">
        <div>
          <span className="eyebrow">{t("recoveryWorkspace")}</span>
          <h2>{t("recoveryTitle")}</h2>
          <p>{isCoach ? t("coachRecoveryIntro") : t("athleteRecoveryIntro")}</p>
        </div>
        <div className="recovery-period" role="group" aria-label={t("analysisPeriod")}>
          {([14, 28, 90] as const).map((value) => (
            <button
              className={days === value ? "active" : ""}
              key={value}
              onClick={() => setDays(value)}
              type="button"
            >
              {value} {t("daysShort")}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {isCoach && roster && (
        <CoachRecoveryRoster
          onSelect={(athleteId) => setSearchParams({ athlete_id: String(athleteId) })}
          roster={roster}
          selectedAthleteId={selectedAthleteId}
        />
      )}
      {isCoach && selectedRelationship && (
        <div className="recovery-athlete-context">
          <div>
            <span>{athleteName(selectedRelationship).slice(0, 1).toUpperCase()}</span>
            <div><small>{t("selectedAthlete")}</small><strong>{athleteName(selectedRelationship)}</strong></div>
          </div>
          <NavLink to={`/performance?athlete_id=${selectedAthleteId}`}>{t("openLoadAnalysis")} →</NavLink>
        </div>
      )}
      {!isCoach && (
        <AthleteCheckIn
          checkIn={todayCheckIn}
          onSaved={() => setRefreshVersion((value) => value + 1)}
        />
      )}
      {loading && !insights ? <div className="loader"><span />{t("loadingRecovery")}</div> : null}
      {insights && <RecoveryInsightsWorkspace insights={insights} />}
    </div>
  );
}

function AthleteCheckIn({
  checkIn,
  onSaved,
}: {
  checkIn: WellnessCheckIn | null;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<CheckInDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!checkIn) {
      setDraft(initialDraft);
      return;
    }
    setDraft({
      sleepHours: checkIn.sleep_duration_minutes === null
        ? ""
        : String(Math.round(checkIn.sleep_duration_minutes / 6) / 10),
      sleepQuality: checkIn.sleep_quality,
      fatigue: checkIn.fatigue,
      stress: checkIn.stress,
      muscleSoreness: checkIn.muscle_soreness,
      overallFeeling: checkIn.overall_feeling,
      restingHeartRate: checkIn.resting_heart_rate === null ? "" : String(checkIn.resting_heart_rate),
      hrv: checkIn.hrv_rmssd ?? "",
      illnessSeverity: checkIn.illness_severity,
      injurySeverity: checkIn.injury_severity,
      notes: checkIn.notes,
      shareWithCoach: checkIn.share_with_coach,
    });
  }, [checkIn]);

  function update<K extends keyof CheckInDraft>(key: K, value: CheckInDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      check_in_date: localDateKey(new Date()),
      sleep_duration_minutes: draft.sleepHours === "" ? null : Math.round(Number(draft.sleepHours) * 60),
      sleep_quality: draft.sleepQuality,
      fatigue: draft.fatigue,
      stress: draft.stress,
      muscle_soreness: draft.muscleSoreness,
      overall_feeling: draft.overallFeeling,
      resting_heart_rate: optionalNumber(draft.restingHeartRate),
      hrv_rmssd: draft.hrv === "" ? null : draft.hrv,
      illness_severity: draft.illnessSeverity,
      injury_severity: draft.injurySeverity,
      notes: draft.notes,
      share_with_coach: draft.shareWithCoach,
    };
    try {
      if (checkIn) await api.updateWellnessCheckIn(checkIn.id, payload);
      else await api.createWellnessCheckIn(payload);
      setMessage(t(checkIn ? "checkInUpdated" : "checkInSaved"));
      onSaved();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="check-in-card">
      <div className="check-in-heading">
        <div>
          <span className="eyebrow">{t("dailyCheckIn")}</span>
          <h3>{checkIn ? t("updateTodayCheckIn") : t("howDoYouFeel")}</h3>
          <p>{t("checkInHelp")}</p>
        </div>
        <time>{new Date().toLocaleDateString(undefined, { day: "2-digit", month: "long" })}</time>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <div className="check-in-subjectives">
          <MetricSlider
            highLabel={t("excellent")}
            label={t("sleepQuality")}
            lowLabel={t("poor")}
            onChange={(value) => update("sleepQuality", value)}
            value={draft.sleepQuality}
          />
          <MetricSlider
            highLabel={t("veryHigh")}
            label={t("fatigueLevel")}
            lowLabel={t("low")}
            onChange={(value) => update("fatigue", value)}
            value={draft.fatigue}
          />
          <MetricSlider
            highLabel={t("veryHigh")}
            label={t("stressLevel")}
            lowLabel={t("low")}
            onChange={(value) => update("stress", value)}
            value={draft.stress}
          />
          <MetricSlider
            highLabel={t("veryHigh")}
            label={t("muscleSoreness")}
            lowLabel={t("low")}
            onChange={(value) => update("muscleSoreness", value)}
            value={draft.muscleSoreness}
          />
          <MetricSlider
            highLabel={t("excellent")}
            label={t("overallFeeling")}
            lowLabel={t("poor")}
            onChange={(value) => update("overallFeeling", value)}
            value={draft.overallFeeling}
          />
        </div>
        <div className="check-in-objectives">
          <label>
            {t("sleepDuration")}
            <div className="input-unit"><input min="0" max="24" step="0.1" type="number" value={draft.sleepHours} onChange={(event) => update("sleepHours", event.target.value)} /><span>{t("hours")}</span></div>
          </label>
          <label>
            {t("restingHeartRate")}
            <div className="input-unit"><input min="30" max="220" type="number" value={draft.restingHeartRate} onChange={(event) => update("restingHeartRate", event.target.value)} /><span>bpm</span></div>
          </label>
          <label>
            {t("hrvRmssd")}
            <div className="input-unit"><input min="1" max="500" step="0.1" type="number" value={draft.hrv} onChange={(event) => update("hrv", event.target.value)} /><span>ms</span></div>
          </label>
          <label>{t("illness")}
            <select value={draft.illnessSeverity} onChange={(event) => update("illnessSeverity", Number(event.target.value))}>
              <SeverityOptions />
            </select>
          </label>
          <label>{t("injury")}
            <select value={draft.injurySeverity} onChange={(event) => update("injurySeverity", Number(event.target.value))}>
              <SeverityOptions />
            </select>
          </label>
        </div>
        <label className="check-in-notes">{t("recoveryNotes")}<textarea maxLength={2000} rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} placeholder={t("recoveryNotesPlaceholder")} /></label>
        <div className="check-in-footer">
          <label className="sharing-control"><input checked={draft.shareWithCoach} type="checkbox" onChange={(event) => update("shareWithCoach", event.target.checked)} /><span><strong>{t("shareWithCoach")}</strong><small>{t("shareWithCoachHelp")}</small></span></label>
          <button className="primary" disabled={saving} type="submit">{saving ? t("savingCheckIn") : (checkIn ? t("updateCheckIn") : t("saveCheckIn"))}</button>
        </div>
      </form>
    </section>
  );
}

function MetricSlider({
  label,
  lowLabel,
  highLabel,
  value,
  onChange,
}: {
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="metric-slider">
      <span><strong>{label}</strong><b>{value}/5</b></span>
      <input aria-label={label} min="1" max="5" step="1" type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <small><span>{lowLabel}</span><span>{highLabel}</span></small>
    </label>
  );
}

function SeverityOptions() {
  const { t } = useLanguage();
  return (
    <>
      <option value="0">{t("severityNone")}</option>
      <option value="1">{t("severityMild")}</option>
      <option value="2">{t("severityModerate")}</option>
      <option value="3">{t("severitySevere")}</option>
    </>
  );
}

function CoachRecoveryRoster({
  roster,
  selectedAthleteId,
  onSelect,
}: {
  roster: RecoveryRoster;
  selectedAthleteId?: number;
  onSelect: (athleteId: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="recovery-roster">
      <div className="recovery-roster-head">
        <div><span className="eyebrow">{t("recoveryRoster")}</span><h3>{t("morningOverview")}</h3></div>
        <div className="roster-totals">
          <span><b>{roster.summary.checked_in_today}</b>{t("checkedInToday")}</span>
          <span className={roster.summary.attention_count ? "attention" : ""}><b>{roster.summary.attention_count}</b>{t("needReview")}</span>
          <span><b>{roster.summary.athletes_count}</b>{t("athletes")}</span>
        </div>
      </div>
      {roster.athletes.length ? (
        <div className="recovery-roster-grid">
          {roster.athletes.map((entry) => (
            <RosterCard
              entry={entry}
              key={entry.athlete.id}
              onClick={() => onSelect(entry.athlete.id)}
              selected={entry.athlete.id === selectedAthleteId}
            />
          ))}
        </div>
      ) : <div className="empty">{t("noAthletes")}</div>}
    </section>
  );
}

function RosterCard({
  entry,
  selected,
  onClick,
}: {
  entry: RecoveryRosterEntry;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const statusKey = statusTranslationKeys[entry.status];
  return (
    <button className={`recovery-roster-card ${entry.status} ${selected ? "selected" : ""}`} onClick={onClick} type="button">
      <span className="roster-avatar">{entry.athlete.name.slice(0, 1).toUpperCase()}</span>
      <span className="roster-athlete"><strong>{entry.athlete.name}</strong><small>{entry.latest_date ? `${t("lastCheckIn")}: ${formatShortDate(entry.latest_date)}` : t("noCheckInYet")}</small></span>
      <span className="roster-readiness"><b>{entry.readiness_score ?? "—"}</b><small>{t(statusKey)}</small></span>
      <span className="roster-load"><small>{t("loadSevenDays")}</small><b>{formatNumber(entry.completed_load_7d)}</b></span>
      {entry.attention_required && <i>{entry.signals.length}</i>}
    </button>
  );
}

function RecoveryInsightsWorkspace({ insights }: { insights: RecoveryInsights }) {
  const { t } = useLanguage();
  const latest = insights.summary.latest;
  const status = latest?.status ?? "missing";
  return (
    <>
      <section className="recovery-summary-grid">
        <article className={`recovery-score-card ${status}`}>
          <small>{t("latestReadiness")}</small>
          <strong>{latest?.readiness_score ?? "—"}<span>{latest ? "/100" : ""}</span></strong>
          <b>{t(statusTranslationKeys[status])}</b>
        </article>
        <SummaryMetric label={t("averageReadiness")} value={insights.summary.average_readiness ?? "—"} />
        <SummaryMetric label={t("checkInConsistency")} value={`${insights.summary.completion_rate}%`} />
        <SummaryMetric label={t("completedLoadSevenDays")} value={formatNumber(insights.load_context.completed_load_7d)} />
        <SummaryMetric label={t("plannedLoadNextSevenDays")} value={formatNumber(insights.load_context.planned_load_next_7d)} />
        <SummaryMetric label={t("trainingForm")} value={formatSigned(insights.load_context.form)} />
      </section>
      {latest ? (
        <>
          <RecoveryTrend points={insights.points} />
          <section className="recovery-decision-grid">
            <article className={`recovery-decision ${latest.status}`}>
              <span className="eyebrow">{t("todayRecoveryContext")}</span>
              <div className="recovery-decision-heading"><strong>{latest.readiness_score}</strong><div><small>{t("readinessScore")}</small><h3>{t(statusTranslationKeys[latest.status])}</h3></div></div>
              <p>{t(adviceTranslationKeys[latest.status])}</p>
              <RecoverySignals signals={latest.signals} />
            </article>
            <article className="recovery-vitals">
              <span className="eyebrow">{t("physiologicalContext")}</span>
              <VitalRow baseline={latest.resting_heart_rate_baseline} deviation={latest.resting_heart_rate_deviation_pct} label={t("restingHeartRate")} samples={latest.resting_heart_rate_baseline_samples} unit="bpm" value={latest.resting_heart_rate} />
              <VitalRow baseline={latest.hrv_baseline} deviation={latest.hrv_deviation_pct} label={t("hrvRmssd")} samples={latest.hrv_baseline_samples} unit="ms" value={latest.hrv_rmssd === null ? null : Number(latest.hrv_rmssd)} />
              <small>{t("personalBaselineHelp")}</small>
            </article>
            <article className="recovery-method">
              <span className="eyebrow">{t("howReadinessWorks")}</span>
              <p>{t("readinessMethodText")}</p>
              <small>{t("recoveryDisclaimer")}</small>
            </article>
          </section>
        </>
      ) : (
        <section className="recovery-empty">
          <span>○</span><div><h3>{t("noRecoveryHistory")}</h3><p>{t("noRecoveryHistoryText")}</p></div>
        </section>
      )}
    </>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return <article className="recovery-summary-metric"><small>{label}</small><strong>{value}</strong></article>;
}

function RecoveryTrend({ points }: { points: RecoveryPoint[] }) {
  const { locale, t } = useLanguage();
  const [selectedId, setSelectedId] = useState(points[points.length - 1]?.id);
  const selected = points.find((point) => point.id === selectedId) ?? points[points.length - 1];
  const chart = useMemo(() => recoveryChart(points), [points]);
  if (!selected) return null;
  return (
    <section className="recovery-trend">
      <header>
        <div><span className="eyebrow">{t("recoveryTrend")}</span><h3>{t("readinessAndSleep")}</h3></div>
        <div className="recovery-legend"><span className="readiness">{t("readiness")}</span><span className="sleep">{t("sleepDuration")}</span></div>
      </header>
      <div className="recovery-trend-readout">
        <div><small>{t("selectedDay")}</small><strong>{formatLongDate(selected.date, locale)}</strong></div>
        <div><small>{t("readiness")}</small><strong>{selected.readiness_score}</strong></div>
        <div><small>{t("sleepDuration")}</small><strong>{selected.sleep_duration_minutes === null ? "—" : `${Math.round(selected.sleep_duration_minutes / 6) / 10} ${t("hoursShort")}`}</strong></div>
        <div><small>{t("overallFeeling")}</small><strong>{selected.overall_feeling}/5</strong></div>
        <div><small>{t("fatigueLevel")}</small><strong>{selected.fatigue}/5</strong></div>
      </div>
      <div className="recovery-chart-wrap">
        <svg aria-label={t("recoveryTrend")} className="recovery-chart" role="img" viewBox="0 0 960 280">
          {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1="44" x2="940" y1={chart.y(tick)} y2={chart.y(tick)} /><text x="34" y={chart.y(tick) + 4}>{tick}</text></g>)}
          {points.map((point, index) => {
            const sleepHeight = point.sleep_duration_minutes === null ? 0 : Math.min(100, point.sleep_duration_minutes / 540 * 100);
            return <rect className="sleep-bar" height={chart.bottom - chart.y(sleepHeight)} key={`sleep-${point.id}`} width={Math.max(5, chart.step * 0.36)} x={chart.x(index) - Math.max(2.5, chart.step * 0.18)} y={chart.y(sleepHeight)} />;
          })}
          <path className="readiness-line" d={chart.path} />
          {points.map((point, index) => (
            <circle
              className={`readiness-point ${point.status} ${point.id === selected.id ? "selected" : ""}`}
              cx={chart.x(index)}
              cy={chart.y(point.readiness_score)}
              key={point.id}
              onClick={() => setSelectedId(point.id)}
              onFocus={() => setSelectedId(point.id)}
              onMouseEnter={() => setSelectedId(point.id)}
              r={point.id === selected.id ? 7 : 5}
              role="button"
              tabIndex={0}
            />
          ))}
          {chart.labels.map((index) => <text className="date-label" key={`label-${points[index].id}`} x={chart.x(index)} y="270">{formatShortDate(points[index].date, locale)}</text>)}
        </svg>
      </div>
    </section>
  );
}

function RecoverySignals({ signals }: { signals: string[] }) {
  const { t } = useLanguage();
  if (!signals.length) return <div className="recovery-signals clear"><span>✓</span>{t("noRecoverySignals")}</div>;
  return (
    <div className="recovery-signals">
      {signals.map((signal) => {
        const key = signalTranslationKeys[signal as keyof typeof signalTranslationKeys];
        return <span key={signal}>{key ? t(key) : signal}</span>;
      })}
    </div>
  );
}

function VitalRow({
  label,
  value,
  unit,
  baseline,
  deviation,
  samples,
}: {
  label: string;
  value: number | null;
  unit: string;
  baseline: number | null;
  deviation: number | null;
  samples: number;
}) {
  const { t } = useLanguage();
  return (
    <div className="vital-row">
      <div><small>{label}</small><strong>{value === null ? "—" : `${value} ${unit}`}</strong></div>
      <div><small>{t("personalBaseline")}</small><strong>{baseline === null ? t("buildingBaseline") : `${baseline} ${unit}`}</strong></div>
      <div><small>{t("deviation")}</small><strong className={deviation !== null && Math.abs(deviation) >= 10 ? "attention" : ""}>{deviation === null ? "—" : `${deviation > 0 ? "+" : ""}${deviation}%`}</strong></div>
      <i>{samples}/7</i>
    </div>
  );
}

function recoveryChart(points: RecoveryPoint[]) {
  const left = 44;
  const right = 20;
  const top = 20;
  const bottom = 242;
  const width = 960;
  const innerWidth = width - left - right;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
  const x = (index: number) => left + (points.length > 1 ? index * step : innerWidth / 2);
  const y = (value: number) => top + (100 - value) / 100 * (bottom - top);
  const path = points.map((point, index) => `${index ? "L" : "M"} ${x(index).toFixed(2)} ${y(point.readiness_score).toFixed(2)}`).join(" ");
  const labelCount = Math.min(7, points.length);
  const labels = labelCount <= 1 ? [0] : Array.from(new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (points.length - 1) / (labelCount - 1)))));
  return { bottom, labels, path, step, x, y };
}

function athleteName(relationship: Relationship) {
  return `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim()
    || relationship.athlete.username;
}

function optionalNumber(value: string) {
  return value === "" ? null : Number(value);
}

function localDateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatNumber(value: string) {
  return String(Math.round(Number(value) * 10) / 10);
}

function formatSigned(value: string) {
  const number = Number(formatNumber(value));
  return `${number > 0 ? "+" : ""}${number}`;
}

function formatShortDate(value: string, locale = "en") {
  return new Date(`${value}T12:00:00`).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", { day: "2-digit", month: "short" });
}

function formatLongDate(value: string, locale: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" });
}
