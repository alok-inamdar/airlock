/**
 * Firebase bootstrap. Every service here is optional: when the VITE_FIREBASE_*
 * environment variables are absent, Airlock runs entirely in Local Demo Mode.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  type Firestore,
} from "firebase/firestore";
import { getRemoteConfig, type RemoteConfig } from "firebase/remote-config";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { logRequest } from "../services/telemetry";

const env = import.meta.env;

const firebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

const appCheckSiteKey = env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined;
const appCheckDebugToken = env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN as string | undefined;

export const firebaseEnabled = Boolean(
  firebaseOptions.apiKey && firebaseOptions.projectId && firebaseOptions.appId
);

export const firebaseProjectId = firebaseOptions.projectId ?? null;

export interface FirebaseRuntime {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  remoteConfig: RemoteConfig;
  appCheck: AppCheck | null;
  appCheckError: string | null;
  authError: string | null;
  uid: string | null;
}

let runtime: FirebaseRuntime | null = null;
let initPromise: Promise<FirebaseRuntime | null> | null = null;

export function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function getFirebaseRuntime(): FirebaseRuntime | null {
  return runtime;
}

export function isAppCheckError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /app[-_ ]?check|appcheck|recaptcha|permission[-_ ]denied|\b403\b/i.test(message);
}

export function describeFirebaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  if (isAppCheckError(error)) {
    return "App Check rejected this request. An ad blocker or privacy extension may be blocking reCAPTCHA. Disable it for this site, reload, then retry — or use the cached demo result.";
  }
  if (/auth\/operation-not-allowed/i.test(message)) {
    return "Anonymous sign-in is disabled in Firebase Authentication. Enable the Anonymous provider in the Firebase console.";
  }
  if (/auth\/unauthorized-domain/i.test(message)) {
    return "This domain is not authorized for Firebase Authentication. Add it under Authentication → Settings → Authorized domains.";
  }
  if (/auth\/network-request-failed|offline|failed to fetch/i.test(message)) {
    return "Airlock could not reach Firebase. Check your connection and retry.";
  }
  if (/api[-_ ]?not[-_ ]?enabled|AI Logic/i.test(message)) {
    return "Firebase AI Logic is not enabled for this project, or the Gemini API is not available. Enable AI Logic in the Firebase console.";
  }
  return message;
}

function configureRemoteConfig(app: FirebaseApp): RemoteConfig {
  const remoteConfig = getRemoteConfig(app);
  remoteConfig.defaultConfig = {
    redaction_strictness: "strict",
    cloud_auditor_model: "gemini-4-hydrogen",
    max_chunk_chars: 1600,
    rule_pack_version: "2026.1",
    enable_search_grounding: false,
  };
  // Zero in every environment so the in-app "Refresh Policy" button works live.
  remoteConfig.settings.minimumFetchIntervalMillis = 0;
  remoteConfig.settings.fetchTimeoutMillis = 10_000;
  return remoteConfig;
}

/**
 * Initialize Firebase once. Throws on failure so the UI can surface actionable
 * console-setup guidance; returns null when credentials are absent.
 */
export async function initFirebase(): Promise<FirebaseRuntime | null> {
  if (!firebaseEnabled) return null;
  if (runtime) return runtime;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const start = Date.now();
      const app = getApps().length > 0 ? getApp() : initializeApp({
        apiKey: firebaseOptions.apiKey,
        authDomain: firebaseOptions.authDomain,
        projectId: firebaseOptions.projectId,
        storageBucket: firebaseOptions.storageBucket,
        messagingSenderId: firebaseOptions.messagingSenderId,
        appId: firebaseOptions.appId,
      });

      let appCheck: AppCheck | null = null;
      let appCheckError: string | null = null;

      if (appCheckSiteKey) {
        try {
          if (isLocalhost()) {
            const debugToken = appCheckDebugToken?.trim();
            if (debugToken) {
              window.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
            } else {
              // Local-only auto token; the SDK prints it to the console. Never shipped.
              window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
            }
          }
          appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
        } catch (error) {
          appCheckError = describeFirebaseError(error);
        }
      } else {
        appCheckError =
          "App Check is not configured (VITE_FIREBASE_APPCHECK_SITE_KEY missing). Cloud calls may be rejected until you register a Google Cloud Fraud Defense (reCAPTCHA Enterprise) site key.";
      }

      const auth = getAuth(app);
      let uid: string | null = null;
      let authError: string | null = null;
      try {
        const credential = await signInAnonymously(auth);
        uid = credential.user.uid;
      } catch (error) {
        authError = describeFirebaseError(error);
      }

      let db: Firestore;
      try {
        db = initializeFirestore(app, {
          localCache: persistentLocalCache(),
          // Optional finding fields (e.g. tokenizedEvidence) may be undefined.
          ignoreUndefinedProperties: true,
        });
      } catch {
        // Firestore was already initialized (hot module replacement/dev refresh).
        db = getFirestore(app);
      }

      const remoteConfig = configureRemoteConfig(app);

      runtime = {
        app,
        auth,
        db,
        remoteConfig,
        appCheck,
        appCheckError,
        authError,
        uid,
      };

      logRequest({
        kind: "auth",
        label: uid ? "Anonymous sign-in" : "Anonymous sign-in failed",
        detail: uid ? `uid ${uid.slice(0, 8)}…` : (authError ?? "unknown"),
        status: uid ? "ok" : "error",
        durationMs: Date.now() - start,
      });
      logRequest({
        kind: "app_check",
        label: appCheck ? "App Check initialized" : "App Check not initialized",
        detail: appCheckError ?? "Fraud Defense (reCAPTCHA Enterprise) token refresh enabled",
        status: appCheck ? "ok" : "error",
      });
      logRequest({
        kind: "firestore",
        label: "Firestore persistent cache ready",
        detail: "persistentLocalCache() — audits queue offline",
        status: "ok",
      });

      return runtime;
    } catch (error) {
      logRequest({
        kind: "auth",
        label: "Firebase initialization failed",
        detail: describeFirebaseError(error),
        status: "error",
      });
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function ensureAnonymousAuth(): Promise<string | null> {
  if (!runtime) return null;
  if (runtime.auth.currentUser) {
    runtime.uid = runtime.auth.currentUser.uid;
    return runtime.uid;
  }
  try {
    const credential = await signInAnonymously(runtime.auth);
    runtime.uid = credential.user.uid;
    runtime.authError = null;
    logRequest({
      kind: "auth",
      label: "Anonymous sign-in",
      detail: `uid ${runtime.uid.slice(0, 8)}…`,
      status: "ok",
    });
    return runtime.uid;
  } catch (error) {
    runtime.authError = describeFirebaseError(error);
    logRequest({
      kind: "auth",
      label: "Anonymous sign-in failed",
      detail: runtime.authError,
      status: "error",
    });
    return null;
  }
}
