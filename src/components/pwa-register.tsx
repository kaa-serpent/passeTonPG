"use client";
import { useLanguage } from "./language-provider";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }>; }
export default function PwaRegister() {
  const { t } = useLanguage();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const listener = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", listener);
    return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  if (!install) return null;
  return <button className="button secondary install-button" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}><Download size={17} />{t(" Installer l’application")}</button>;
}
