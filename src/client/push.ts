import { api } from "./api";

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Must be called from a tap (iOS only shows the permission prompt on a user gesture). */
export async function enablePush() {
  const { publicKey } = await api.get<{ publicKey: string | null }>("/push/key");
  if (!publicKey) throw new Error("Push isn't configured on the server yet");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this app. Allow them in your phone's settings and try again.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.post("/push/subscription", sub.toJSON());
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post("/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Keeps the server in sync if this device is already subscribed (e.g. after signing in as someone else). */
export async function resyncPush() {
  const sub = await currentSubscription().catch(() => null);
  if (sub && Notification.permission === "granted") await api.post("/push/subscription", sub.toJSON()).catch(() => undefined);
}

// Android/desktop Chrome: keep the install prompt so a button can trigger it.
type InstallPrompt = Event & { prompt: () => Promise<void> };
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  listeners.forEach((l) => l());
});
export const canPromptInstall = () => !!deferred;
export const onInstallAvailable = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export async function promptInstall() {
  await deferred?.prompt();
  deferred = null;
  listeners.forEach((l) => l());
}
