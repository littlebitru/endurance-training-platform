import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { localizeApiError, useLanguage } from "./i18n";
import type { AthleteThreshold, Relationship, TrainingZone } from "./types";

const SPORTS = ["running", "cycling", "swimming", "triathlon"] as const;
const today = new Date().toISOString().slice(0, 10);

function athleteName(relationship: Relationship): string {
  const athlete = relationship.athlete;
  return `${athlete.first_name} ${athlete.last_name}`.trim() || athlete.username;
}

function formatSeconds(value: number | null): string {
  if (!value) return "";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

function parsePace(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[2]) > 59) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function AthleteThresholdPanel({
  relationship,
  onClose,
}: {
  relationship: Relationship;
  onClose: () => void;
}) {
  const { locale, t } = useLanguage();
  const profileSport = relationship.athlete.profile?.sport;
  const [sport, setSport] = useState<(typeof SPORTS)[number]>(
    SPORTS.includes(profileSport as (typeof SPORTS)[number]) ? profileSport as (typeof SPORTS)[number] : "running",
  );
  const [thresholds, setThresholds] = useState<AthleteThreshold[]>([]);
  const [thresholdHeartRate, setThresholdHeartRate] = useState("");
  const [maximumHeartRate, setMaximumHeartRate] = useState("");
  const [ftp, setFtp] = useState("");
  const [thresholdPace, setThresholdPace] = useState("");
  const [css, setCss] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [source, setSource] = useState("manual");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api.thresholds(relationship.athlete.id)
      .then((response) => setThresholds(response.results))
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [relationship.athlete.id, t]);

  const sportHistory = thresholds.filter((threshold) => threshold.sport === sport);
  const current = sportHistory.find((threshold) => threshold.is_current);
  const selectedMeasurement = sportHistory.find((threshold) => threshold.effective_from === effectiveFrom);

  useEffect(() => {
    setThresholdHeartRate(current?.threshold_heart_rate ? String(current.threshold_heart_rate) : "");
    setMaximumHeartRate(current?.maximum_heart_rate ? String(current.maximum_heart_rate) : "");
    setFtp(current?.functional_threshold_power ? String(current.functional_threshold_power) : "");
    setThresholdPace(formatSeconds(current?.threshold_pace_seconds_per_km ?? null));
    setCss(formatSeconds(current?.critical_swim_speed_seconds_per_100m ?? null));
    setEffectiveFrom(current?.effective_from ?? today);
    setSource(current?.source ?? "manual");
    setNotes(current?.notes ?? "");
    setMessage("");
    setError("");
  }, [current, sport]);

  const zoneGroups = useMemo(() => {
    const groups = new Map<string, TrainingZone[]>();
    (current?.zones ?? []).forEach((zone) => groups.set(zone.metric, [...(groups.get(zone.metric) ?? []), zone]));
    return [...groups.entries()];
  }, [current]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const paceSeconds = parsePace(thresholdPace);
    const cssSeconds = parsePace(css);
    if (Number.isNaN(paceSeconds) || Number.isNaN(cssSeconds)) {
      setError(t("paceFormatError"));
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      athlete: relationship.athlete.id,
      sport,
      threshold_heart_rate: thresholdHeartRate ? Number(thresholdHeartRate) : null,
      maximum_heart_rate: maximumHeartRate ? Number(maximumHeartRate) : null,
      effective_from: effectiveFrom,
      source,
      notes,
      functional_threshold_power: sport === "cycling" && ftp ? Number(ftp) : null,
      threshold_pace_seconds_per_km: sport === "running" ? paceSeconds : null,
      critical_swim_speed_seconds_per_100m: sport === "swimming" ? cssSeconds : null,
    };

    try {
      if (selectedMeasurement) {
        await api.updateThreshold(selectedMeasurement.id, payload);
      } else {
        await api.createThreshold(payload);
      }
      const refreshed = await api.thresholds(relationship.athlete.id);
      setThresholds(refreshed.results);
      setMessage(t("zonesCalculated"));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setSaving(false);
    }
  }

  const sportLabels = {
    running: t("sportRunning"),
    cycling: t("sportCycling"),
    swimming: t("sportSwimming"),
    triathlon: t("sportTriathlon"),
  };
  const metricLabels: Record<string, string> = {
    heart_rate: t("targetHeartRate"),
    pace: t("targetPace"),
    power: t("targetPower"),
  };
  const sourceLabels: Record<string, string> = {
    manual: t("sourceManual"),
    field_test: t("sourceFieldTest"),
    lab_test: t("sourceLabTest"),
    device_import: t("sourceDeviceImport"),
  };

  function loadMeasurement(threshold: AthleteThreshold) {
    setEffectiveFrom(threshold.effective_from);
    setSource(threshold.source);
    setNotes(threshold.notes);
    setThresholdHeartRate(threshold.threshold_heart_rate ? String(threshold.threshold_heart_rate) : "");
    setMaximumHeartRate(threshold.maximum_heart_rate ? String(threshold.maximum_heart_rate) : "");
    setFtp(threshold.functional_threshold_power ? String(threshold.functional_threshold_power) : "");
    setThresholdPace(formatSeconds(threshold.threshold_pace_seconds_per_km));
    setCss(formatSeconds(threshold.critical_swim_speed_seconds_per_100m));
    setMessage("");
    setError("");
  }

  return (
    <div className="editor-backdrop threshold-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-modal="true" className="editor-panel threshold-panel" role="dialog">
        <div className="editor-head">
          <div><span className="eyebrow">{t("athleteSettings")}</span><h2>{t("thresholdsAndZones")}</h2><p>{athleteName(relationship)}</p></div>
          <button aria-label={t("close")} className="icon-button" onClick={onClose} type="button">×</button>
        </div>

        <div className="threshold-intro">
          <span>_AUTO</span>
          <div><strong>{t("automaticZoneTitle")}</strong><p>{t("automaticZoneText")}</p></div>
        </div>

        <nav aria-label={t("selectSport")} className="threshold-sports">
          {SPORTS.map((item) => (
            <button className={sport === item ? `active ${item}` : item} key={item} onClick={() => setSport(item)} type="button">
              {sportLabels[item]}
            </button>
          ))}
        </nav>

        {loading ? <div className="training-loading">{t("loading")}</div> : (
          <form onSubmit={save}>
            <div className="threshold-form-grid">
              <label>{t("thresholdEffectiveDate")}<input max={today} onChange={(event) => setEffectiveFrom(event.target.value)} required type="date" value={effectiveFrom} /><small>{t("thresholdEffectiveDateHelp")}</small></label>
              <label>{t("thresholdSource")}<select onChange={(event) => setSource(event.target.value)} value={source}><option value="manual">{t("sourceManual")}</option><option value="field_test">{t("sourceFieldTest")}</option><option value="lab_test">{t("sourceLabTest")}</option><option value="device_import">{t("sourceDeviceImport")}</option></select><small>{t("thresholdSourceHelp")}</small></label>
              <label>{t("thresholdHeartRate")}<input max="240" min="80" onChange={(event) => setThresholdHeartRate(event.target.value)} placeholder="172" type="number" value={thresholdHeartRate} /><small>{t("thresholdHeartRateHelp")}</small></label>
              <label>{t("maximumHeartRate")}<input max="240" min="100" onChange={(event) => setMaximumHeartRate(event.target.value)} placeholder="190" type="number" value={maximumHeartRate} /><small>{t("maximumHeartRateHelp")}</small></label>
              {sport === "cycling" && <label>{t("functionalThresholdPower")}<input max="1000" min="50" onChange={(event) => setFtp(event.target.value)} placeholder="250" type="number" value={ftp} /><small>{t("functionalThresholdPowerHelp")}</small></label>}
              {sport === "running" && <label>{t("thresholdRunningPace")}<input onChange={(event) => setThresholdPace(event.target.value)} pattern="[0-9]{1,2}:[0-9]{2}" placeholder="4:20" value={thresholdPace} /><small>{t("thresholdRunningPaceHelp")}</small></label>}
              {sport === "swimming" && <label>{t("criticalSwimSpeed")}<input onChange={(event) => setCss(event.target.value)} pattern="[0-9]{1,2}:[0-9]{2}" placeholder="1:40" value={css} /><small>{t("criticalSwimSpeedHelp")}</small></label>}
            </div>
            <label className="threshold-notes">{t("thresholdNotes")}<textarea onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} /></label>
            {sport === "triathlon" && <p className="discipline-note">{t("triathlonThresholdHelp")}</p>}
            {error && <div className="error" role="alert">{error}</div>}
            {message && <div className="notice" role="status">{message}</div>}
            <div className="editor-actions"><button className="secondary" onClick={onClose} type="button">{t("cancel")}</button><button className="primary" disabled={saving} type="submit">{saving ? t("calculatingZones") : t("calculateZones")}</button></div>
          </form>
        )}

        {!loading && sportHistory.length > 0 && (
          <section className="threshold-history">
            <div><span className="eyebrow">{t("measurementHistory")}</span><h3>{t("thresholdHistory")}</h3></div>
            <div className="threshold-history-list">
              {sportHistory.map((threshold) => (
                <button className={threshold.effective_from === effectiveFrom ? "active" : ""} key={threshold.id} onClick={() => loadMeasurement(threshold)} type="button">
                  <strong>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${threshold.effective_from}T00:00:00`))}</strong>
                  <small>{sourceLabels[threshold.source] ?? threshold.source}{threshold.is_current ? ` · ${t("currentThreshold")}` : ""}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {!loading && (
          <section className="calculated-zones">
            <div className="zone-section-title"><div><span className="eyebrow">{t("automaticTargets")}</span><h3>{t("calculatedZones")}</h3></div>{current && <small>{t("zonesUpdateAutomatically")}</small>}</div>
            {!zoneGroups.length && <div className="zone-empty">{t("enterThresholds")}</div>}
            {zoneGroups.map(([metric, zones]) => (
              <article className={`zone-group ${metric}`} key={metric}>
                <header><strong>{metricLabels[metric] ?? metric}</strong><small>{metric === "heart_rate" && current?.heart_rate_basis === "max_hr" ? t("basedOnMaximumHeartRate") : t(`basedOn${metric === "power" ? "Ftp" : metric === "pace" ? (sport === "swimming" ? "Css" : "ThresholdPace") : "Lthr"}` as "basedOnLthr")}</small></header>
                <div>{zones.map((zone) => <span className={`zone z${zone.zone_number}`} key={zone.id}><b>Z{zone.zone_number}</b><strong>{zone.display_range}</strong><small>{zone.name}</small></span>)}</div>
              </article>
            ))}
          </section>
        )}
      </section>
    </div>
  );
}
