"use client";
import type { Model } from "@/lib/types";
import { useLanguage } from "./language-provider";

export function ModelMeasurements({ model }: { model: Model }) {
  const { t } = useLanguage();
  const source = model.measurementSource;
  const pdf = model.pdfSource;
  if (!source && !pdf) return null;
  return <div className="field-help" style={{ marginTop: 12 }}>
    {!model.verified && <p>{pdf
      ? t("Codes de profondeur relevés dans le PDF. Nombre de goupilles à confirmer pour votre cylindre.")
      : t("Import Excel : 5 goupilles par défaut, modifiables. Numérotation provisoire des profondeurs à partir de 0, à confirmer.")}</p>}
    {pdf && <details>
      <summary>{t("Mesures du PDF")} · {pdf.depths.length} {t("tailles de profondeur")}</summary>
      <p>{pdf.label} · {t("Page")} {pdf.page} · {t("Fiche")} {pdf.card}</p>
      <p style={{ overflowWrap: "anywhere" }}>{pdf.file}</p>
      <p>{t("Code : profondeur en pouces")}</p>
      <p>{pdf.depths.map((depth, index) => `${pdf.codes[index]} : ${depth}`).join(" · ")}</p>
      <p>{t("Profondeurs en mm (conversion)")}</p>
      <p>{pdf.depths.map((depth, index) => `${pdf.codes[index]} : ${Number((depth * 25.4).toFixed(4))}`).join(" · ")}</p>
      <p>{t("Première position")} : {pdf.firstPin} inch · {t("Espacement")} : {pdf.pinSpacing} inch</p>
      {pdf.readDirection && <p>{t("Sens de lecture")} : {pdf.readDirection === "Bow to tip" ? t("De la tête vers la pointe") : t("De la pointe vers la tête")}</p>}
      {pdf.notes.map((note, index) => <p key={index}>{note}</p>)}
    </details>}
    {source && <details>
      <summary>{t("Mesures du fichier source")} · {source.depths.length} {t("tailles de profondeur")}</summary>
      <p>{source.label} · {source.unit} · {t("Ligne")} {source.row}</p>
      <p style={{ overflowWrap: "anywhere" }}>{source.file}</p>
      {pdf && <p>{t("Indices des colonnes Excel, distincts des codes du PDF.")}</p>}
      <p>{source.depths.map((depth, index) => `${index} : ${depth}`).join(" · ")}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>MACS : {source.macs ?? t("Inconnu")}</p>
      <p>{t("Mesures optimisées pour impression : elles peuvent différer des tailles d’origine.")}</p>
    </details>}
  </div>;
}
