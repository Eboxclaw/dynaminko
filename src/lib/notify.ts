// Browser notifications. Permission can only be requested from a user gesture,
// so nothing here fires on its own — the UI calls request() from a button.
//
// Scope, honestly: this delivers notifications while the app is open or the
// installed PWA is in the background. Real push (app fully closed) needs a
// push service with VAPID keys and a server, which this app does not have.

export type PermissionState = "unsupported" | "default" | "granted" | "denied";

export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permission(): PermissionState {
  if (!notifySupported()) return "unsupported";
  return Notification.permission as PermissionState;
}

export async function request(): Promise<PermissionState> {
  if (!notifySupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result as PermissionState;
  } catch {
    return permission();
  }
}

/** True when the browser can keep the notification alive outside the tab. */
export function backgroundCapable(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export async function show(title: string, body: string, tag?: string): Promise<boolean> {
  if (permission() !== "granted") return false;
  const options: NotificationOptions = {
    body,
    tag,
    icon: "/pot-mark.svg",
    badge: "/pot-mark.svg",
  };
  try {
    if (backgroundCapable()) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
