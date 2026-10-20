"use client";

import { useEffect } from "react";
import { isStaleBuildError, reloadOnce } from "@/lib/stale-build-reload";

export function PwaRegistry() {
  // Fork: an old cached page whose <script> chunks 404 after a redeploy, or a failed dynamic import -> reload once
  useEffect(() => {
    const onError = (e: Event) => {
      const t = e.target as HTMLScriptElement | HTMLLinkElement | null;
      const src = (t as HTMLScriptElement)?.src || (t as HTMLLinkElement)?.href || '';
      if (src.includes('/_next/static/') || isStaleBuildError((e as ErrorEvent).error)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => { if (isStaleBuildError(e.reason)) reloadOnce(); };
    window.addEventListener('error', onError, true); // capture: resource load errors do not bubble
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError, true); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  useEffect(() => {
    // Only register the service worker in production builds
    if (process.env.NODE_ENV === 'production' && typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").then(
          (registration) => {
            console.log("PWA Service Worker registered.");
          },
          (err) => {
            console.error("PWA Service Worker registration failed: ", err);
          }
        );
      });
    }
  }, []);

  return null;
}