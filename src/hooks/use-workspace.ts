"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Model, Project, User } from "@/lib/types";
import { clearAccountStorage, deleteLocal, readLocal, writeLocal, writeLocals } from "@/lib/local-store";

type SaveState = "idle" | "saving" | "saved" | "error" | "offline";
type CachedAccount = { user: User; projects: Project[]; drafts: Project[]; held: string[] };
type Conflict = { local: Project; remote: Project };
const GUEST_KEY = "passetonpg-guests";

class ApiError extends Error {
  constructor(message: string, public status: number, public project?: Project) { super(message); }
}

export async function request<T>(path: string, body?: unknown, method = "POST", expectedUserId?: string): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined && method === "POST" ? "GET" : method,
    credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(expectedUserId ? { "X-Account-Id": expectedUserId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || "La demande a échoué.", response.status, data.project);
  return data as T;
}

export function useWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [guestProjects, setGuestProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [online, setOnline] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const userRef = useRef<User | null>(null);
  const projectsRef = useRef<Project[]>([]);
  const guestRef = useRef<Project[]>([]);
  const drafts = useRef(new Map<string, Project>());
  const held = useRef(new Set<string>());
  const conflictRef = useRef<Conflict | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const deleted = useRef(new Set<string>());
  const authEpoch = useRef(0);
  const persistence = useRef<Promise<boolean>>(Promise.resolve(true));
  const importIds = useRef(new Map<string, string>());
  const channel = useRef<BroadcastChannel | null>(null);

  const showError = useCallback((err: unknown) => {
    if (mounted.current) setError(err instanceof Error ? err.message : "Une erreur est survenue.");
  }, []);

  const persist = useCallback(async () => {
    const current = userRef.current;
    if (!current) return false;
    const epoch = authEpoch.current;
    const snapshot: CachedAccount = {
      user: current, projects: projectsRef.current,
      drafts: [...drafts.current.values()], held: [...held.current],
    };
    const pending = persistence.current.then(async () => {
      // A response or queued write from a previous account must never restore it.
      if (epoch !== authEpoch.current || userRef.current?.id !== current.id) return false;
      try {
        await writeLocals([[`account:${current.id}`, snapshot], ["active-user", current]]);
        return true;
      } catch {
        showError("Le stockage local est indisponible. Gardez cet onglet ouvert tant que vos modifications ne sont pas enregistrées sur le serveur.");
        return false;
      }
    });
    persistence.current = pending;
    return pending;
  }, [showError]);

  const updateProjects = useCallback((next: Project[]) => {
    projectsRef.current = next;
    if (mounted.current) setProjects(next);
  }, []);

  const storeGuests = useCallback((next: Project[]) => {
    guestRef.current = next;
    setGuestProjects(next);
    if (!userRef.current) updateProjects(next);
    try { sessionStorage.setItem(GUEST_KEY, JSON.stringify(next)); }
    catch { showError("La conservation dans cet onglet est indisponible ; une fermeture ou un rechargement perdra vos données invité."); }
  }, [showError, updateProjects]);

  const flush = useCallback(async () => {
    if (running.current) return running.current;
    const execute = async () => {
      const current = userRef.current;
      if (!current || !navigator.onLine || conflictRef.current || current.mustChangePassword) return;
      let failed = false;
      while (navigator.onLine && userRef.current?.id === current.id && !conflictRef.current) {
        const eligible = [...drafts.current].find(([id]) => !held.current.has(id) && !deleted.current.has(id));
        if (!eligible) break;
        const [id, sent] = eligible;
        setSaveState("saving");
        try {
          const { project: saved } = await request<{ project: Project }>(
            sent.revision === 0 ? "/api/projects" : `/api/projects/${id}`,
            { project: sent }, sent.revision === 0 ? "POST" : "PUT", current.id,
          );
          if (userRef.current?.id !== current.id) break;
          const latest = drafts.current.get(id);
          if (latest === sent) {
            drafts.current.delete(id);
            updateProjects(projectsRef.current.map(p => p.id === id ? saved : p));
          } else if (latest) {
            const rebased = { ...latest, revision: saved.revision };
            drafts.current.set(id, rebased);
            updateProjects(projectsRef.current.map(p => p.id === id ? rebased : p));
          }
          setPendingCount(drafts.current.size);
          await persist();
        } catch (err) {
          failed = true;
          held.current.add(id);
          if (err instanceof ApiError && err.status === 409 && err.project) {
            const next = { local: drafts.current.get(id) || sent, remote: err.project };
            conflictRef.current = next;
            setConflict(next);
          } else {
            showError(navigator.onLine ? err : new Error("Modification conservée en brouillon. Vous pourrez l’envoyer au retour du réseau."));
          }
          setSaveState(navigator.onLine ? "error" : "offline");
          await persist();
          break;
        }
      }
      if (!failed && mounted.current) setSaveState(drafts.current.size ? "offline" : "saved");
    };
    running.current = execute().finally(() => { running.current = null; });
    await running.current;
  }, [persist, showError, updateProjects]);

  const refreshCatalog = useCallback(async () => {
    try {
      const data = await request<{ models: Model[] }>("/api/catalog");
      setModels(data.models);
      await writeLocal("catalog", data.models).catch(() => {});
    } catch (err) { if (navigator.onLine) showError(err); }
  }, [showError]);

  const activateUser = useCallback(async (nextUser: User, fetchServer: boolean, epoch = ++authEpoch.current) => {
    const active = () => mounted.current && authEpoch.current === epoch;
    const cached = await readLocal<CachedAccount>(`account:${nextUser.id}`).catch(() => undefined);
    if (!active()) return;
    userRef.current = nextUser;
    setUser(nextUser);
    drafts.current = new Map((cached?.drafts || []).map(p => [p.id, p]));
    // Restored drafts always require an explicit send, even after an interrupted autosave.
    held.current = new Set(drafts.current.keys());
    conflictRef.current = null;
    setConflict(null);
    updateProjects(cached?.projects || []);
    setPendingCount(drafts.current.size);
    if (fetchServer) {
      try {
        const data = await request<{ projects: Project[] }>("/api/projects", undefined, "GET", nextUser.id);
        if (!active()) return;
        const merged = new Map(data.projects.map(p => [p.id, p]));
        for (const [id, draft] of drafts.current) merged.set(id, draft);
        updateProjects([...merged.values()]);
      } catch (err) { if (active()) showError(err); }
    }
    if (!active()) return;
    setSaveState(drafts.current.size || !navigator.onLine ? "offline" : "idle");
    await persist();
  }, [persist, showError, updateProjects]);

  useEffect(() => {
    mounted.current = true;
    const epoch = ++authEpoch.current;
    const active = () => mounted.current && authEpoch.current === epoch;
    const accountChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("passetonpg-session");
    channel.current = accountChannel;
    if (accountChannel) accountChannel.onmessage = (event: MessageEvent<{ type?: string; userId?: string }>) => {
      const message = event.data;
      if (!message || !["signed-in", "signed-out"].includes(message.type ?? "") || typeof message.userId !== "string") return;
      const previous = userRef.current;
      if (message.type === "signed-out" && previous && previous.id !== message.userId) return;
      if (message.type === "signed-in" && previous?.id === message.userId) return;
      // Cookies are shared between tabs, but in-memory projects are not. Invalidate
      // the old workspace before it can send a project under the new session.
      authEpoch.current += 1;
      clearTimeout(timer.current);
      userRef.current = null;
      drafts.current.clear();
      held.current.clear();
      conflictRef.current = null;
      setUser(null);
      setConflict(null);
      setPendingCount(0);
      setSaveState("idle");
      setAuthLoading(false);
      updateProjects(guestRef.current);
      if (message.type === "signed-in") {
        showError("Le compte a changé dans un autre onglet. Rechargez la page pour utiliser la session actuelle ; les brouillons de l’ancien compte restent conservés pour sa prochaine connexion.");
        void persistence.current.then(async () => {
          const pointer = await readLocal<User>("active-user").catch(() => undefined);
          if (previous && pointer?.id === previous.id) await deleteLocal("active-user").catch(() => {});
        });
      } else {
        showError("Vous avez été déconnecté depuis un autre onglet. Les copies locales du compte ont été effacées.");
        void persistence.current.then(() => clearAccountStorage(message.userId)).catch(showError);
      }
    };
    const initialize = async () => {
      setOnline(navigator.onLine);
      try {
        const raw = sessionStorage.getItem(GUEST_KEY);
        const initial = raw ? JSON.parse(raw) : [];
        if (Array.isArray(initial)) storeGuests(initial);
      } catch { /* A damaged guest session starts empty. */ }
      const catalog = await readLocal<Model[]>("catalog").catch(() => undefined);
      if (!active()) return;
      if (catalog) setModels(catalog);
      try {
        const data = await request<{ user: User | null }>("/api/auth/me");
        if (!active()) return;
        if (data.user) await activateUser(data.user, true, epoch);
        else await deleteLocal("active-user").catch(() => {});
      } catch {
        const cachedUser = await readLocal<User>("active-user").catch(() => undefined);
        if (cachedUser && active()) await activateUser(cachedUser, false, epoch);
      }
      if (active()) { setAuthLoading(false); void refreshCatalog(); }
    };
    void initialize();
    const onOnline = () => { setOnline(true); void refreshCatalog(); };
    const onOffline = () => { setOnline(false); setSaveState("offline"); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (userRef.current && drafts.current.size) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      authEpoch.current += 1;
      clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeunload", beforeUnload);
      accountChannel?.close();
      if (channel.current === accountChannel) channel.current = null;
    };
  }, [activateUser, refreshCatalog, showError, storeGuests, updateProjects]);

  const saveProject = useCallback((project: Project) => {
    const existing = projectsRef.current.find(p => p.id === project.id);
    const next = { ...project, revision: existing?.revision ?? project.revision, updatedAt: new Date().toISOString() };
    const list = existing ? projectsRef.current.map(p => p.id === next.id ? next : p) : [next, ...projectsRef.current];
    if (!userRef.current) { storeGuests(list); setSaveState("saved"); return; }
    updateProjects(list);
    drafts.current.set(next.id, next);
    if (!navigator.onLine) held.current.add(next.id);
    setPendingCount(drafts.current.size);
    setSaveState(navigator.onLine && !held.current.has(next.id) ? "saving" : "offline");
    void persist();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 650);
  }, [flush, persist, storeGuests, updateProjects]);

  const login = useCallback(async (username: string, password: string, register = false) => {
    setError(null);
    const epoch = ++authEpoch.current;
    const data = await request<{ user: User }>(`/api/auth/${register ? "register" : "login"}`, { username, password });
    await running.current;
    await persistence.current;
    await activateUser(data.user, true, epoch);
    if (authEpoch.current === epoch) channel.current?.postMessage({ type: "signed-in", userId: data.user.id });
  }, [activateUser]);

  const logout = useCallback(async (discardDrafts = false) => {
    const previous = userRef.current;
    if (drafts.current.size && !discardDrafts) return false;
    clearTimeout(timer.current);
    await running.current;
    if (drafts.current.size && !discardDrafts) return false;
    if (previous?.id !== userRef.current?.id) return false;
    if (!navigator.onLine) {
      showError(new Error("Reconnectez-vous au réseau pour fermer aussi la session sur le serveur."));
      return false;
    }
    await request("/api/auth/logout", {}, "POST", previous?.id);
    // Editing can continue while the network request is pending. Never discard
    // those last-minute drafts without the explicit discard confirmation.
    if (drafts.current.size && !discardDrafts) {
      for (const id of drafts.current.keys()) held.current.add(id);
      setSaveState("offline");
      await persist();
      return false;
    }
    authEpoch.current += 1;
    userRef.current = null;
    drafts.current.clear();
    held.current.clear();
    conflictRef.current = null;
    setConflict(null);
    setUser(null);
    setPendingCount(0);
    setSaveState("idle");
    updateProjects(guestRef.current);
    await persistence.current;
    await clearAccountStorage(previous?.id);
    if (previous) channel.current?.postMessage({ type: "signed-out", userId: previous.id });
    return true;
  }, [persist, showError, updateProjects]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const current = userRef.current;
    if (!current) throw new Error("Connectez-vous pour modifier votre mot de passe.");
    const epoch = authEpoch.current;
    const data = await request<{ user: User }>("/api/auth/password", { currentPassword, newPassword }, "POST", current.id);
    if (authEpoch.current !== epoch) return;
    userRef.current = data.user;
    setUser(data.user);
    await persist();
  }, [persist]);

  const deleteProject = useCallback(async (id: string) => {
    if (!userRef.current) { storeGuests(guestRef.current.filter(p => p.id !== id)); return; }
    const currentId = userRef.current.id;
    deleted.current.add(id);
    try {
      await running.current;
      if (userRef.current?.id !== currentId) throw new Error("Le compte a changé. Rechargez la page avant de continuer.");
      if (!navigator.onLine) throw new Error("La suppression d’un projet du compte nécessite une connexion. Vos brouillons restent disponibles.");
      try { await request(`/api/projects/${id}`, undefined, "DELETE", currentId); }
      catch (err) { if (!(err instanceof ApiError && err.status === 404)) throw err; }
      drafts.current.delete(id);
      held.current.delete(id);
      updateProjects(projectsRef.current.filter(p => p.id !== id));
      setPendingCount(drafts.current.size);
      await persist();
    } finally { deleted.current.delete(id); }
  }, [persist, storeGuests, updateProjects]);

  const importGuests = useCallback(async () => {
    if (!userRef.current || userRef.current.mustChangePassword) throw new Error("Connectez-vous avec un compte actif pour sauvegarder vos projets invités.");
    const currentId = userRef.current.id;
    for (const guest of guestRef.current) {
      const importKey = `${currentId}:${guest.id}`;
      const id = importIds.current.get(importKey) ?? crypto.randomUUID();
      importIds.current.set(importKey, id);
      saveProject({ ...guest, id, revision: 0 });
    }
    // Drafts are persisted before removing the temporary session copy.
    if (!await persist() || userRef.current?.id !== currentId) {
      throw new Error("La copie locale du compte n’a pas pu être conservée. Votre travail invité est toujours disponible ; réessayez sans fermer cet onglet.");
    }
    storeGuests([]);
    importIds.current.clear();
    await flush();
  }, [flush, persist, saveProject, storeGuests]);

  const dismissGuests = useCallback(() => storeGuests([]), [storeGuests]);

  const syncDrafts = useCallback(async () => {
    setError(null);
    if (!navigator.onLine) throw new Error("Le réseau est toujours indisponible.");
    held.current.clear();
    await flush();
  }, [flush]);

  const resolveConflict = useCallback(async (asCopy: boolean) => {
    const current = conflictRef.current;
    if (!current) return;
    const local = drafts.current.get(current.local.id) || current.local;
    drafts.current.delete(local.id);
    held.current.delete(local.id);
    updateProjects(projectsRef.current.map(p => p.id === local.id ? current.remote : p));
    conflictRef.current = null;
    setConflict(null);
    if (asCopy) saveProject({ ...local, id: crypto.randomUUID(), name: `${local.name} (copie)`, revision: 0 });
    setPendingCount(drafts.current.size);
    await persist();
    await flush();
  }, [flush, persist, saveProject, updateProjects]);

  return {
    user, authLoading, projects, models, online, saveState, error, guestProjects, pendingCount, conflict,
    login, logout, changePassword, saveProject, deleteProject, importGuests, dismissGuests,
    syncDrafts, resolveConflict, refreshCatalog, clearError: () => setError(null),
  };
}
