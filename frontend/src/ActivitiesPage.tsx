import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type { Activity, ActivityStreamPoint, Relationship } from "./types";

const sportKeys = {
  running: "sportRunning",
  cycling: "sportCycling",
  swimming: "sportSwimming",
  triathlon: "sportTriathlon",
} as const;

export function ActivitiesPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [athleteId, setAthleteId] = useState("");
  const [sport, setSport] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const isCoach = user?.role === "coach";

  const loadActivities = useCallback(async (selectedAthlete?: number) => {
    const response = await api.activities(selectedAthlete);
    setActivities(response.results);
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const requests: Promise<unknown>[] = [loadActivities()];
    if (isCoach) {
      requests.push(api.athletes().then((response) => {
        setRelationships(response.results.filter((item) => item.is_active));
        if (response.results.length === 1) setAthleteId(String(response.results[0].athlete.id));
      }));
    }
    Promise.all(requests)
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [isCoach, loadActivities, t, user]);

  async function filterByAthlete(value: string) {
    setAthleteId(value);
    setLoading(true);
    try {
      await loadActivities(value ? Number(value) : undefined);
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    setMessage("");
    const data = new FormData();
    data.append("file", file);
    if (sport) data.append("sport", sport);
    if (isCoach && athleteId) data.append("athlete", athleteId);
    try {
      const imported = await api.importActivity(data);
      setMessage(t("activityImported"));
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadActivities(isCoach && athleteId ? Number(athleteId) : undefined);
      setSelected(await api.activity(imported.id));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setUploading(false);
    }
  }

  async function openActivity(activity: Activity) {
    setError("");
    try {
      setSelected(await api.activity(activity.id));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  async function removeActivity(activity: Activity) {
    if (!window.confirm(t("deleteActivityConfirm"))) return;
    try {
      await api.deleteActivity(activity.id);
      setSelected(null);
      await loadActivities();
      setMessage(t("activityDeleted"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    }
  }

  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  return (
    <>
      <div className="section-title activity-title">
        <div><span className="eyebrow">{t("completedTraining")}</span><h2>{t("activityAnalysis")}</h2><p>{t("activityAnalysisIntro")}</p></div>
        {isCoach && (
          <label className="activity-filter">{t("athlete")}
            <select value={athleteId} onChange={(event) => void filterByAthlete(event.target.value)}>
              <option value="">{t("allAthletes")}</option>
              {relationships.map((item) => <option key={item.id} value={item.athlete.id}>{athleteName(item)}</option>)}
            </select>
          </label>
        )}
      </div>
      <section className="activity-import-card">
        <div className="import-copy"><span className="import-icon">↥</span><div><h3>{t("importActivity")}</h3><p>{t("importActivityHelp")}</p></div></div>
        <form onSubmit={submit}>
          {isCoach && (
            <label>{t("completedBy")}
              <select required value={athleteId} onChange={(event) => setAthleteId(event.target.value)}>
                <option value="">{t("selectAthlete")}</option>
                {relationships.map((item) => <option key={item.id} value={item.athlete.id}>{athleteName(item)}</option>)}
              </select>
            </label>
          )}
          <label>{t("sportOverride")}
            <select value={sport} onChange={(event) => setSport(event.target.value)}>
              <option value="">{t("detectAutomatically")}</option>
              {Object.entries(sportKeys).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
            </select>
          </label>
          <label className={`file-drop ${file ? "ready" : ""}`}>
            <input ref={fileInput} accept=".fit,.tcx,.gpx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required type="file" />
            <strong>{file?.name || t("chooseActivityFile")}</strong><small>{file ? formatBytes(file.size) : t("activityFileFormats")}</small>
          </label>
          <button className="primary" disabled={!file || uploading} type="submit">{uploading ? t("analyzingActivity") : t("importAndAnalyze")}</button>
        </form>
      </section>
      {message && <div className="notice" role="status">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="activity-list-heading"><div><span className="eyebrow">{t("trainingHistory")}</span><h3>{t("recentActivities")}</h3></div><span>{activities.length} {t(activityCountKey(activities.length, locale))}</span></div>
      {loading ? <div className="activity-loading">{t("loading")}</div> : (
        <section className="activity-grid">
          {activities.map((activity) => (
            <button className="activity-card" key={activity.id} onClick={() => void openActivity(activity)} type="button">
              <div className="activity-card-head"><span className={`activity-sport ${activity.sport}`}>{sportGlyph(activity.sport)}</span><div><strong>{activity.workout_title || t("unplannedActivity")}</strong><small>{new Date(activity.started_at).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short" })}{isCoach ? ` · ${activity.athlete_name || t("athlete")}` : ""}</small></div><ComplianceBadge activity={activity} /></div>
              <div className="activity-card-metrics"><Metric label={t("duration")} value={formatDuration(activity.duration_seconds)} /><Metric label={t("distance")} value={formatDistance(activity.distance_meters)} /><Metric label={t("trainingLoad")} value={activity.training_load_score ? Math.round(Number(activity.training_load_score)) : "—"} /><Metric label={t("averageHeartRateShort")} value={activity.average_heart_rate ? `${activity.average_heart_rate} bpm` : "—"} /></div>
              <div className="activity-source"><span>{activity.file_type.toUpperCase()}</span>{activity.source_file_name}<i>→</i></div>
            </button>
          ))}
        </section>
      )}
      {!loading && !activities.length && <div className="empty">{t("noActivities")}</div>}
      {selected && <ActivityDetail activity={selected} isAthlete={!isCoach} onClose={() => setSelected(null)} onDelete={() => void removeActivity(selected)} />}
    </>
  );
}

function ActivityDetail({ activity, isAthlete, onClose, onDelete }: { activity: Activity; isAthlete: boolean; onClose: () => void; onDelete: () => void }) {
  const { locale, t } = useLanguage();
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const zones = activity.zone_distribution.zones ?? [];
  return (
    <div className="editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="editor-panel activity-detail-panel">
        <button className="close" onClick={onClose} aria-label={t("close")} type="button">×</button>
        <div className="activity-detail-head"><span className={`activity-sport ${activity.sport}`}>{sportGlyph(activity.sport)}</span><div><span className="eyebrow">{t("completedActivity")}</span><h2>{activity.workout_title || t("unplannedActivity")}</h2><p>{new Date(activity.started_at).toLocaleString(dateLocale, { dateStyle: "long", timeStyle: "short" })} · {activity.source_file_name}</p></div><ComplianceBadge activity={activity} /></div>
        <section className="analysis-kpis">
          <Metric label={t("duration")} value={formatDuration(activity.duration_seconds)} />
          <Metric label={t("distance")} value={formatDistance(activity.distance_meters)} />
          <Metric label={t("averagePace")} value={formatPace(activity.average_pace_seconds_per_km)} />
          <Metric label={t("elevationGain")} value={activity.elevation_gain_meters ? `${Math.round(Number(activity.elevation_gain_meters))} m` : "—"} />
          <Metric label={t("heartRate") } value={activity.average_heart_rate ? `${activity.average_heart_rate} / ${activity.maximum_heart_rate ?? "—"} bpm` : "—"} />
          <Metric label={t("power") } value={activity.average_power ? `${activity.average_power} / ${activity.maximum_power ?? "—"} W` : "—"} />
          <Metric label={t("normalizedPower")} value={activity.normalized_power ? `${activity.normalized_power} W` : "—"} />
          <Metric label={t("trainingLoad")} value={activity.training_load_score ? `${Math.round(Number(activity.training_load_score))} · ${activity.training_load_method}` : "—"} />
        </section>
        <ActivityChart points={activity.stream?.points ?? []} />
        <div className="analysis-columns">
          <section className="planned-actual"><span className="eyebrow">{t("planVsExecution")}</span><h3>{t("compliance")}</h3>{activity.workout ? <><Comparison label={t("duration")} planned={activity.planned_duration_minutes ? `${activity.planned_duration_minutes} min` : "—"} actual={formatDuration(activity.duration_seconds)} /><Comparison label={t("distance")} planned={activity.planned_distance_km ? `${activity.planned_distance_km} km` : "—"} actual={formatDistance(activity.distance_meters)} /><div className="match-note"><strong>{activity.compliance_score ?? "—"}%</strong><span>{t("matchConfidence")}: {t(matchKey(activity.match_confidence))}</span></div></> : <p className="analysis-empty">{t("activityNotMatched")}</p>}</section>
          <section className="zone-analysis"><span className="eyebrow">{t("intensityDistribution")}</span><h3>{zones.length ? `${t("timeInZones")} · ${activity.zone_distribution.metric}` : t("zonesUnavailable")}</h3>{zones.length ? zones.map((zone) => <div className="activity-zone" key={zone.zone}><span>Z{zone.zone}</span><div><i style={{ width: `${zone.percentage}%` }} /></div><strong>{zone.percentage}%</strong><small>{formatDuration(zone.seconds)}</small></div>) : <p className="analysis-empty">{t("zonesUnavailableHelp")}</p>}</section>
        </div>
        <div className="activity-detail-actions"><small>{t("privacyNote")}</small>{isAthlete && <button className="danger" onClick={onDelete} type="button">{t("deleteActivity")}</button>}</div>
      </section>
    </div>
  );
}

function ActivityChart({ points }: { points: ActivityStreamPoint[] }) {
  const { t } = useLanguage();
  const available = useMemo(() => ([
    ["heart_rate", t("heartRate")], ["power", t("power")], ["speed", t("speed")], ["elevation", t("elevation")],
  ] as const).filter(([key]) => points.some((point) => point[key] !== undefined)), [points, t]);
  const [metric, setMetric] = useState(available[0]?.[0] ?? "heart_rate");
  useEffect(() => { if (available.length && !available.some(([key]) => key === metric)) setMetric(available[0][0]); }, [available, metric]);
  const values = points.map((point) => ({ x: point.elapsed, y: Number(point[metric as keyof ActivityStreamPoint]) })).filter((point) => Number.isFinite(point.y));
  const maximumX = Math.max(1, ...values.map((point) => point.x));
  const minimumY = values.length ? Math.min(...values.map((point) => point.y)) : 0;
  const maximumY = values.length ? Math.max(...values.map((point) => point.y)) : 1;
  const rangeY = Math.max(1, maximumY - minimumY);
  const polyline = values.map((point) => `${(point.x / maximumX) * 760 + 20},${190 - ((point.y - minimumY) / rangeY) * 150}`).join(" ");
  if (!available.length) return <section className="activity-chart"><p className="analysis-empty">{t("streamUnavailable")}</p></section>;
  return <section className="activity-chart"><div><span className="eyebrow">{t("activityStream")}</span><div className="chart-metric-tabs">{available.map(([key, label]) => <button className={metric === key ? "active" : ""} key={key} onClick={() => setMetric(key)} type="button">{label}</button>)}</div></div><svg viewBox="0 0 800 220" role="img" aria-label={t("activityStream")}><defs><linearGradient id="stream-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b9677" stopOpacity=".32"/><stop offset="1" stopColor="#2b9677" stopOpacity="0"/></linearGradient></defs><path d={`M ${polyline} L 780 205 L 20 205 Z`} fill="url(#stream-fill)"/><polyline points={polyline} fill="none" stroke="#23775f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><text x="20" y="216">0:00</text><text x="740" y="216">{formatDuration(maximumX)}</text><text x="22" y="30">{Math.round(maximumY)}</text></svg></section>;
}

function ComplianceBadge({ activity }: { activity: Activity }) {
  const { t } = useLanguage();
  return <span className={`compliance-badge ${activity.compliance_status}`}>{t(complianceKey(activity.compliance_status))}{activity.compliance_score !== null ? ` · ${activity.compliance_score}%` : ""}</span>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="analysis-metric"><small>{label}</small><strong>{value}</strong></div>; }
function Comparison({ label, planned, actual }: { label: string; planned: string; actual: string }) { const { t } = useLanguage(); return <div className="comparison-row"><span>{label}</span><small>{t("plannedLabel")}<strong>{planned}</strong></small><i>→</i><small>{t("actualLabel")}<strong>{actual}</strong></small></div>; }
function athleteName(relationship: Relationship) { return `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim() || relationship.athlete.username; }
function sportGlyph(sport: string) { return ({ running: "RUN", cycling: "BIKE", swimming: "SWIM", triathlon: "TRI" } as Record<string, string>)[sport] || "ACT"; }
function formatBytes(bytes: number) { return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function formatDistance(value: string | null) { return value ? `${(Number(value) / 1000).toFixed(2)} km` : "—"; }
function formatDuration(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = Math.round(seconds % 60); return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
function formatPace(seconds: number | null) { return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km` : "—"; }
function activityCountKey(count: number, locale: string): "activityOne" | "activityFew" | "activitiesCount" { if (locale !== "ru") return count === 1 ? "activityOne" : "activitiesCount"; const lastTwo = count % 100; const last = count % 10; if (lastTwo >= 11 && lastTwo <= 14) return "activitiesCount"; if (last === 1) return "activityOne"; if (last >= 2 && last <= 4) return "activityFew"; return "activitiesCount"; }
function complianceKey(value: string): "onTarget" | "belowTarget" | "aboveTarget" | "unplanned" | "insufficientData" { return ({ on_target: "onTarget", under: "belowTarget", over: "aboveTarget", unplanned: "unplanned", insufficient_data: "insufficientData" } as const)[value as "on_target"] || "unplanned"; }
function matchKey(value: string): "matchHigh" | "matchMedium" | "matchLow" | "matchManual" | "matchNone" { return ({ high: "matchHigh", medium: "matchMedium", low: "matchLow", manual: "matchManual", none: "matchNone" } as const)[value as "high"] || "matchNone"; }
