"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "./api";
import { clearAuthTokens, getAccessToken, getRefreshToken } from "./session";

function hasStoredAuthToken(): boolean {
  return !!(getAccessToken() || getRefreshToken());
}

export function hasCurrentEducationalUseConsent(user: {
  accepted_educational_use?: boolean;
  educational_use_consent_current?: boolean;
}): boolean {
  return user.educational_use_consent_current ?? !!user.accepted_educational_use;
}

export function useRequireAuth(options: { allowPendingConsent?: boolean } = {}): boolean {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const allowPendingConsent = options.allowPendingConsent ?? false;

  useEffect(() => {
    let cancelled = false;

    if (!hasStoredAuthToken()) {
      router.replace("/login");
      return () => {
        cancelled = true;
      };
    }

    async function verifyUser() {
      try {
        const user = await api.auth.me() as { accepted_educational_use?: boolean };
        if (cancelled) return;

        const consentCurrent = hasCurrentEducationalUseConsent(user);
        if (!consentCurrent && !allowPendingConsent) {
          router.replace("/consent");
          return;
        }
        if (consentCurrent && pathname === "/consent") {
          router.replace("/cases");
          return;
        }

        setChecking(false);
      } catch {
        clearAuthTokens();
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    void verifyUser();

    return () => {
      cancelled = true;
    };
  }, [allowPendingConsent, pathname, router]);

  return checking;
}

export function useRedirectIfAuthenticated(path = "/cases"): boolean {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (hasStoredAuthToken()) {
      async function redirectKnownUser() {
        try {
          const user = await api.auth.me() as { accepted_educational_use?: boolean };
          if (cancelled) return;
          router.replace(hasCurrentEducationalUseConsent(user) ? path : "/consent");
        } catch {
          clearAuthTokens();
          if (!cancelled) {
            setChecking(false);
          }
        }
      }

      void redirectKnownUser();
      return () => {
        cancelled = true;
      };
    }

    setChecking(false);
  }, [path, router]);

  return checking;
}
