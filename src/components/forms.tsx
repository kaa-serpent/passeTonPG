"use client";
import { useLanguage } from "./language-provider";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, KeyRound, LockKeyhole, AlertCircle, Check, LoaderCircle } from "lucide-react";
import { cylinderTypes, cylinderTypeLabels, cylinderTypeLabel, pinCounts, pinCountValid, normalizeCylinderSettings, type CylinderType } from "@/lib/types";
import type { Entry, Model, PinCount, Position, Project, Settings } from "@/lib/types";
import { ModelMeasurements } from "./model-measurements";

export const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]/gu, "");
export async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "L’opération a échoué. Réessayez.");
  return payload as T;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("input:not([type=checkbox]), textarea, select")?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t("Fermer")}><X size={21} /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
export function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: ReactNode }) {
  const { t } = useLanguage();
  return <div className="field"><label className="field-label">{label}{optional && <span className="optional">{t(" · facultatif")}</span>}{children}</label>{hint && <span className="field-help">{hint}</span>}</div>;
}
export function ErrorMessage({ error }: { error: string | null }) { const { t } = useLanguage(); return error ? <p role="alert" className="form-error">{t(error)}</p> : null; }
export function Submit({ busy, children }: { busy?: boolean; children: ReactNode }) { return <button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{children}</button>; }

type CylinderSettings = Settings & { cylinderType: CylinderType | null };
function SettingsFields({ settings, setSettings: onChange }: { settings: CylinderSettings; setSettings(value: CylinderSettings): void }) {
  const setSettings = (value: CylinderSettings) => onChange(normalizeCylinderSettings(value));
  const { t } = useLanguage();
  return <>
    <Field label={t("Type de cylindre")} optional><select value={settings.cylinderType ?? ""} onChange={(event) => { const cylinderType = event.target.value === "" ? null : event.target.value as CylinderType; setSettings({ ...settings, cylinderType, pinCount: pinCountValid(settings.pinCount, cylinderType) ? settings.pinCount : 6 }); }}><option value="">{t("Non renseigné")}</option>{cylinderTypes.map((type) => <option key={type} value={type}>{t(cylinderTypeLabels[type])}</option>)}</select></Field>
    <div className="form-row"><Field label={settings.cylinderType === "disque" ? t("Nombre de disques") : t("Nombre de goupilles")}><select value={settings.pinCount} onChange={(event) => setSettings({ ...settings, pinCount: Number(event.target.value) as PinCount })}>{pinCounts(settings.cylinderType).map((count) => <option key={count} value={count}>{count} {settings.cylinderType === "disque" ? t("disques") : t("goupilles")}</option>)}</select></Field>
      {settings.cylinderType !== "disque" && <Field label="MACS" optional hint={t("Écart maximal entre deux valeurs voisines.")}><input type="number" min="0" max="9" value={settings.macs ?? ""} placeholder={t("Inconnu")} onChange={(event) => setSettings({ ...settings, macs: event.target.value === "" ? null : Number(event.target.value) })} /></Field>}</div>
    <div className="form-row"><Field label={t("Valeur minimale")}><input type="number" min="0" max="9" required value={settings.min} onChange={(event) => setSettings({ ...settings, min: Number(event.target.value) })} /></Field><Field label={t("Valeur maximale")}><input type="number" min="0" max="9" required value={settings.max} onChange={(event) => setSettings({ ...settings, max: Number(event.target.value) })} /></Field></div>
  </>;
}
export const settingsValid = (settings: Settings & { cylinderType?: CylinderType | null }) => pinCountValid(settings.pinCount, settings.cylinderType) && Number.isInteger(settings.min) && Number.isInteger(settings.max) && settings.min >= 0 && settings.max <= 9 && settings.min <= settings.max && (settings.cylinderType === "disque" || settings.macs === null || (Number.isInteger(settings.macs) && settings.macs >= 0 && settings.macs <= 9));
const settingsNames: Record<keyof CylinderSettings, string> = { cylinderType: "Type de cylindre", pinCount: "Goupilles", min: "Minimum", max: "Maximum", macs: "MACS" };
const settingKeys = ["cylinderType", "pinCount", "min", "max", "macs"] as const;

export function ProjectForm({ project, models, onSave, onClose }: { project?: Project; models: Model[]; onSave(project: Project): void; onClose(): void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const initialModel = models.find((model) => model.id === project?.modelId);
  const [brand, setBrand] = useState(initialModel?.brand ?? "");
  const [modelName, setModelName] = useState(initialModel?.name ?? "");
  const [modelId, setModelId] = useState(project?.modelId ?? null);
  const [modelVersion, setModelVersion] = useState(project?.modelVersion ?? null);
  const [settings, setSettings] = useState<CylinderSettings>(project ? { cylinderType: project.cylinderType ?? null, pinCount: project.pinCount, min: project.min, max: project.max, macs: normalizeCylinderSettings(project).macs } : { cylinderType: null, pinCount: 5, min: 0, max: 9, macs: null });
  const [keyCorrections, setKeyCorrections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmResize, setConfirmResize] = useState(false);
  const [updateSelection, setUpdateSelection] = useState<string[]>([]);
  const brands = [...new Set(models.map((model) => model.brand))].filter((value) => normalize(value).includes(normalize(brand))).slice(0, 30);
  const matchingModels = models.filter((model) => normalize(model.brand) === normalize(brand));
  const currentModel = models.find((model) => model.id === modelId);
  const update = !!(project && currentModel && project.modelVersion !== currentModel.version);
  const changedFields = currentModel ? settingKeys.filter((key) => (key !== "macs" || (settings.cylinderType !== "disque" && currentModel.cylinderType !== "disque")) && settings[key] !== currentModel[key]) : [];
  const needsResize = !!project?.entries.length && (settings.pinCount !== project.pinCount || settings.min !== project.min || settings.max !== project.max);
  const keyInvalid = (entry: Entry) => entry.positions.length !== settings.pinCount || entry.positions.some((position) => !position || position.length !== 1 || position[0] < settings.min || position[0] > settings.max);
  const invalidKeys = project?.entries.filter((entry) => entry.type === "key" && keyInvalid(entry)) ?? [];
  const correctedCode = (entry: Entry) => keyCorrections[entry.id] ?? entry.positions.slice(0, settings.pinCount).map((position) => position?.[0] ?? "").join("");
  const listId = useId();
  const selectModel = (model: Model) => { setBrand(model.brand); setModelName(model.name); setModelId(model.id); setModelVersion(model.version); setSettings({ cylinderType: model.cylinderType ?? null, pinCount: model.pinCount, min: model.min, max: model.max, macs: normalizeCylinderSettings(model).macs }); };
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (!name.trim()) return setError("Donnez un nom à votre projet.");
    if (!settingsValid(settings)) return setError("Vérifiez la plage de 0 à 9 et le MACS. Le minimum ne peut pas dépasser le maximum.");
    if (needsResize && !confirmResize) return setError("Confirmez l’adaptation des cartes aux nouveaux réglages.");
    for (const key of invalidKeys) { const code = correctedCode(key); if (code.length !== settings.pinCount || !/^\d+$/.test(code) || [...code].some((digit) => Number(digit) < settings.min || Number(digit) > settings.max)) return setError(t("Complétez le code de « {name} » avec {count} valeurs de {min} à {max}.", { name: key.name, count: settings.pinCount, min: settings.min, max: settings.max })); }
    const entries = (project?.entries ?? []).map((entry) => {
      if (entry.type === "key") return invalidKeys.some((key) => key.id === entry.id) ? { ...entry, positions: [...correctedCode(entry)].map((value) => [Number(value)]) } : entry;
      const positions: Position[] = Array.from({ length: settings.pinCount }, (_, index) => { const values = entry.positions[index]?.filter((value) => value >= settings.min && value <= settings.max); return values?.length ? values : null; });
      return { ...entry, positions };
    });
    onSave({ id: project?.id ?? crypto.randomUUID(), name: name.trim(), description: description.trim(), ...normalizeCylinderSettings(settings), modelId, modelVersion, entries, revision: project?.revision ?? 0, updatedAt: new Date().toISOString() }); onClose();
  }
  return <form className="form" onSubmit={submit}>
    <Field label={t("Nom du projet")}><input autoFocus required maxLength={120} placeholder={t("Ex. Résidence des Lilas")} value={name} onChange={(event) => setName(event.target.value)} /></Field>
    <Field label={t("Description")} optional><textarea maxLength={2000} placeholder={t("Quelques repères pour retrouver ce projet…")} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
    <div className="form-row"><Field label={t("Marque")} optional><input autoComplete="off" list={`${listId}-brands`} placeholder={t("Rechercher une marque")} value={brand} onChange={(event) => { setBrand(event.target.value); setModelName(""); setModelId(null); setModelVersion(null); }} /><datalist id={`${listId}-brands`}>{brands.map((value) => <option key={value} value={value} />)}</datalist></Field>
      <Field label={t("Modèle")} optional><input autoComplete="off" list={`${listId}-models`} placeholder={t("Rechercher un modèle")} value={modelName} onChange={(event) => { const value = event.target.value; setModelName(value); const model = matchingModels.find((item) => normalize(item.name) === normalize(value)); if (model) selectModel(model); else { setModelId(null); setModelVersion(null); } }} /><datalist id={`${listId}-models`}>{matchingModels.map((model) => <option key={model.id} value={model.name} />)}</datalist></Field></div>
    {!modelId && <p className="field-help">{t("Choisissez un modèle du catalogue, ou utilisez des réglages libres. Vous pouvez proposer un modèle dans l’onglet Catalogue.")}</p>}
    {currentModel && !currentModel.verified && <p className="pill pending">{t("Caractéristiques du modèle à valider")}</p>}
    {currentModel && <ModelMeasurements model={currentModel} />}
    {update && <div className="notice blue"><AlertCircle size={18} /><div className="notice-text"><strong>{t("Une nouvelle fiche est disponible")}</strong><p>{t("Choisissez les caractéristiques à reprendre. Les autres réglages restent inchangés.")}</p><div className="update-fields" style={{ marginTop: 10 }}>{changedFields.map((key) => <label className="check-row" key={key}><input type="checkbox" checked={updateSelection.includes(key)} onChange={(event) => setUpdateSelection((selected) => event.target.checked ? [...selected, key] : selected.filter((item) => item !== key))} />{key === "pinCount" && settings.cylinderType === "disque" ? t("Disques") : t(settingsNames[key])} : {key === "cylinderType" ? t(cylinderTypeLabel(settings.cylinderType)) : String(settings[key] ?? t("inconnu"))} → {key === "cylinderType" ? t(cylinderTypeLabel(currentModel!.cylinderType)) : String(currentModel![key] ?? t("inconnu"))}</label>)}{changedFields.length === 0 && <p>{t("Aucune différence dans les caractéristiques.")}</p>}</div><button type="button" className="button secondary" style={{ marginTop: 10 }} onClick={() => { const next = { ...settings }; for (const key of settingKeys) if (updateSelection.includes(key)) (next as unknown as Record<string, unknown>)[key] = currentModel![key]; setSettings(normalizeCylinderSettings(next)); setModelVersion(currentModel!.version); setUpdateSelection([]); }}>{t("Appliquer la sélection")}</button></div></div>}
    <SettingsFields settings={settings} setSettings={(value) => { setSettings(value); setConfirmResize(false); }} />
    {needsResize && <div className="notice warm"><AlertCircle size={18} /><div className="notice-text"><p>{t("Les positions communes seront conservées. Toute position nouvelle ou sans valeur autorisée sera marquée inconnue sur les cylindres.")}</p><label className="check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={confirmResize} onChange={(event) => setConfirmResize(event.target.checked)} />{t("Confirmer l’adaptation des cartes")}</label></div></div>}
    {invalidKeys.map((key) => <Field key={key.id} label={t("Nouveau code — {name}", { name: key.name })} hint={t("{count} chiffres, de {min} à {max}.", { count: settings.pinCount, min: settings.min, max: settings.max })}><input className="mono" inputMode="numeric" pattern="[0-9]*" maxLength={settings.pinCount} required value={keyCorrections[key.id] ?? key.positions.slice(0, settings.pinCount).map((position) => position?.[0] ?? "").join("")} onChange={(event) => setKeyCorrections({ ...keyCorrections, [key.id]: event.target.value.replace(/\D/g, "") })} onFocus={() => { if (keyCorrections[key.id] === undefined) setKeyCorrections({ ...keyCorrections, [key.id]: key.positions.slice(0, settings.pinCount).map((position) => position?.[0] ?? "").join("") }); }} /></Field>)}
    <ErrorMessage error={error} /><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>{t("Annuler")}</button><Submit>{project ? t("Appliquer les modifications") : t("Créer le projet")}</Submit></div>
  </form>;
}

export function EntryForm({ project, entry, onSave, onClose }: { project: Project; entry?: Entry; onSave(entry: Entry): void; onClose(): void }) {
  const { t } = useLanguage();
  const [type, setType] = useState<Entry["type"]>(entry?.type ?? "cylinder");
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [code, setCode] = useState(entry?.type === "key" ? entry.positions.map((p) => p?.[0] ?? "").join("") : "");
  const [positions, setPositions] = useState<Position[]>(entry?.type === "cylinder" ? entry.positions : Array.from({ length: project.pinCount }, () => null));
  const [error, setError] = useState<string | null>(null);
  const values = Array.from({ length: project.max - project.min + 1 }, (_, index) => project.min + index);
  const fallbackName = `${type === "key" ? t("Clé") : t("Cylindre")} ${project.entries.filter((item) => item.type === type).length + 1}`;
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (type === "key" && (code.length !== project.pinCount || !/^\d+$/.test(code) || [...code].some((digit) => Number(digit) < project.min || Number(digit) > project.max))) return setError(t("Saisissez exactement {count} chiffres de {min} à {max}.", { count: project.pinCount, min: project.min, max: project.max }));
    onSave({ id: entry?.id ?? crypto.randomUUID(), type, name: name.trim() || fallbackName, description: description.trim(), positions: type === "key" ? [...code].map((digit) => [Number(digit)]) : positions }); onClose();
  }
  return <form onSubmit={submit} className="form">
    {!entry && <div className="tabs" aria-label={t("Type de carte")}><button type="button" className={`tab ${type === "cylinder" ? "active" : ""}`} aria-pressed={type === "cylinder"} onClick={() => setType("cylinder")}><LockKeyhole size={17} />{t("Cylindre")}</button><button type="button" className={`tab ${type === "key" ? "active" : ""}`} aria-pressed={type === "key"} onClick={() => setType("key")}><KeyRound size={17} />{t("Clé")}</button></div>}
    <Field label={t("Nom de la carte")} optional><input autoFocus maxLength={120} placeholder={fallbackName} value={name} onChange={(event) => setName(event.target.value)} /></Field>
    <Field label={t("Description")} optional><textarea maxLength={2000} value={description} placeholder={t("Étiquette, emplacement, particularité…")} onChange={(event) => setDescription(event.target.value)} /></Field>
    {type === "key" ? <Field label={t("Code de la clé")} hint={t("{count} chiffres de {min} à {max}. Les zéros initiaux sont conservés.", { count: project.pinCount, min: project.min, max: project.max })}><input className="code-input" style={project.pinCount > 6 ? { fontSize: "clamp(16px, 4vw, 24px)", letterSpacing: 2 } : undefined} aria-label={t("Code de la clé")} inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={project.pinCount} placeholder={"0".repeat(project.pinCount)} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required /></Field> : <><p className="field-help">{t("Sélectionnez toutes les valeurs acceptées par position. Laissez « Inconnu » si vous n’avez pas encore l’information.")}</p>{positions.map((position, index) => <fieldset className="pin-fieldset" key={index}><legend>{t("Position ")}{index + 1}</legend><div className="pin-options">{values.map((value) => <button key={value} type="button" aria-label={t("Position {position}, valeur {value}", { position: index + 1, value })} aria-pressed={!!position?.includes(value)} className={`pin-option ${position?.includes(value) ? "selected" : ""}`} onClick={() => setPositions((all) => all.map((item, at) => { if (at !== index) return item; const next = item?.includes(value) ? item.filter((digit) => digit !== value) : [...(item ?? []), value].sort((a, b) => a - b); return next.length ? next : null; }))}>{value}</button>)}<button type="button" className={`pin-option unknown-option ${position === null ? "selected" : ""}`} aria-pressed={position === null} aria-label={t("Position {position} inconnue", { position: index + 1 })} onClick={() => setPositions((all) => all.map((item, at) => at === index ? null : item))}>{t("Inconnu")}</button></div></fieldset>)}</>}
    {type === "key" && <p className="field-help">{t("Cette clé sera comparée à chaque cylindre, même si elle n’est pas un passe général.")}</p>}<ErrorMessage error={error} /><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>{t("Annuler")}</button><Submit>{entry ? t("Modifier la carte") : t("Ajouter la carte")}</Submit></div>
  </form>;
}

export function ModelForm({ model, onSaved, onClose }: { model?: Model; onSaved(): Promise<void>; onClose(): void }) {
  const { t } = useLanguage();
  const [brand, setBrand] = useState(model?.brand ?? "");
  const [name, setName] = useState(model?.name ?? "");
  const [settings, setSettings] = useState<CylinderSettings>(model ? { cylinderType: model.cylinderType ?? null, pinCount: model.pinCount, min: model.min, max: model.max, macs: normalizeCylinderSettings(model).macs } : { cylinderType: null, pinCount: 5, min: 0, max: 9, macs: null });
  const [verify, setVerify] = useState(model?.verified ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (!settingsValid(settings)) return setError("Vérifiez la plage de valeurs et le MACS.");
    setBusy(true);
    try { await request(model ? `/api/catalog/${model.id}` : "/api/catalog", model ? "PATCH" : "POST", { brand: brand.trim(), name: name.trim(), cylinderType: settings.cylinderType, pinCount: settings.pinCount, min: settings.min, max: settings.max, macs: normalizeCylinderSettings(settings).macs, ...(model ? { verify } : {}) }); await onSaved(); onClose(); } catch (err) { setError(err instanceof Error ? err.message : t("Impossible d’enregistrer la fiche.")); } finally { setBusy(false); }
  }
  return <form className="form" onSubmit={submit}><Field label={t("Marque")}><input autoFocus required maxLength={100} placeholder={t("Nom de la marque")} value={brand} onChange={(event) => setBrand(event.target.value)} /></Field><Field label={t("Modèle")}><input required maxLength={100} placeholder={t("Nom du modèle")} value={name} onChange={(event) => setName(event.target.value)} /></Field><SettingsFields settings={settings} setSettings={setSettings} />{model ? <label className="check-row"><input type="checkbox" checked={verify} onChange={(event) => setVerify(event.target.checked)} />{t("Valider les caractéristiques de cette fiche")}</label> : <p className="field-help">{t("La fiche sera utilisable immédiatement. Un indicateur discret restera visible jusqu’à sa validation par un administrateur.")}</p>}<ErrorMessage error={error} /><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>{t("Annuler")}</button><Submit busy={busy}>{model ? t("Enregistrer la fiche") : t("Proposer ce modèle")}</Submit></div></form>;
}
