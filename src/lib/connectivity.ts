/** Connectivity checks: navigator.onLine plus a same-origin probe. */

import { useEffect, useState } from "react";

export function browserReportsOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export async function probeNetwork(timeoutMs = 3500): Promise<boolean> {
  if (!browserReportsOnline()) return false;
  if (typeof window === "undefined") return true;
  if (window.location.protocol === "file:") return true;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${window.location.origin}/index.html?airlock_probe=1`, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    // Any HTTP response means the network path is alive.
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(browserReportsOnline());

  useEffect(() => {
    const update = () => setOnline(browserReportsOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
