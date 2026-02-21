import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { ExternalLink, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n";
import { reportUserActionError } from "@/lib/userErrorFeedback";
import {
  getPermissionItem,
  isPermissionBlocked,
  isPermissionGranted,
  resolveRecordingPermissionReadiness,
  type CapturePermissionItem,
  type CapturePermissionKey,
  type CapturePermissionSnapshot,
  type CapturePermissionStatus,
} from "@/lib/permissions/capturePermissions";
import { resolvePermissionActionMode } from "@/lib/permissions/permissionActions";

const PERMISSION_ORDER: CapturePermissionKey[] = [
  "screen",
  "camera",
  "microphone",
  "input-monitoring",
  "accessibility",
];

function createFallbackItem(key: CapturePermissionKey): CapturePermissionItem {
  return {
    key,
    status: "unknown",
    requiredForRecording: key === "screen",
    canOpenSettings: false,
  };
}

function statusTextClass(status: CapturePermissionStatus): string {
  if (status === "granted") return "text-emerald-300";
  if (status === "denied" || status === "restricted") return "text-amber-300";
  return "text-zinc-300";
}

function statusBadgeClass(status: CapturePermissionStatus): string {
  if (status === "granted") return "bg-emerald-500/15 border-emerald-400/40";
  if (status === "denied" || status === "restricted") return "bg-amber-500/15 border-amber-400/40";
  return "bg-zinc-500/15 border-zinc-300/25";
}

function keyLabelSuffix(key: CapturePermissionKey): string {
  if (key === "screen") return "ScreenCapture";
  if (key === "camera") return "Camera";
  if (key === "microphone") return "Microphone";
  if (key === "input-monitoring") return "InputMonitoring";
  return "Accessibility";
}

export function PermissionCheckerWindow() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<CapturePermissionSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (!window.electronAPI) return;
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const result = await window.electronAPI.getCapturePermissionSnapshot();
        setSnapshot(result);
      } catch (error) {
        reportUserActionError({
          t,
          userMessage: t("permission.refreshFailed"),
          error,
          context: "permission-checker.load-snapshot",
          dedupeKey: "permission-checker.load-snapshot",
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  useEffect(() => {
    const onFocus = () => {
      void loadSnapshot(true);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [loadSnapshot]);

  const orderedItems = useMemo(() => {
    return PERMISSION_ORDER.map((key) => getPermissionItem(snapshot ?? { platform: "unknown", checkedAtMs: 0, canOpenSystemSettings: false, items: [] }, key) ?? createFallbackItem(key));
  }, [snapshot]);

  const readiness = useMemo(() => {
    if (!snapshot) {
      return { ready: false, missingRequired: [createFallbackItem("screen")] };
    }
    return resolveRecordingPermissionReadiness(snapshot);
  }, [snapshot]);

  const handlePermissionAction = useCallback(
    async (item: CapturePermissionItem) => {
      if (isPermissionGranted(item.status)) return;
      try {
        const result = await window.electronAPI.requestCapturePermissionAccess(item.key);
        if (!result.success) {
          reportUserActionError({
            t,
            userMessage: t("permission.permissionActionFailed"),
            error: result.message || "requestCapturePermissionAccess returned unsuccessful result",
            context: "permission-checker.permission-action",
            details: { key: item.key },
            dedupeKey: `permission-checker.permission-action:${item.key}`,
          });
          return;
        }
        window.setTimeout(() => {
          void loadSnapshot(true);
        }, result.openedSettings ? 700 : 350);
      } catch (error) {
        reportUserActionError({
          t,
          userMessage: t("permission.permissionActionFailed"),
          error,
          context: "permission-checker.permission-action",
          details: { key: item.key },
          dedupeKey: `permission-checker.permission-action:${item.key}`,
        });
      }
    },
    [loadSnapshot, t],
  );

  if (loading) {
    return (
      <div
        className="min-h-screen text-zinc-100 flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, rgba(28,28,34,0.92) 0%, rgba(18,18,22,0.88) 100%)',
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        }}
      >
        <div className="flex items-center gap-3 text-zinc-300">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>{t("permission.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen text-zinc-100 px-6 py-5"
      style={{
        background: 'linear-gradient(135deg, rgba(28,28,34,0.92) 0%, rgba(18,18,22,0.88) 100%)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        boxShadow: '0 4px 16px 0 rgba(0,0,0,0.32), 0 1px 3px 0 rgba(0,0,0,0.18) inset',
      }}
    >
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("permission.title")}</h1>
            <p className="text-sm text-zinc-300 mt-2 max-w-4xl leading-relaxed">{t("permission.intro")}</p>
          </div>
          <Button
            onClick={() => void loadSnapshot(true)}
            disabled={refreshing}
            className="bg-white/5 hover:bg-white/10 text-white border border-white/10 gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("permission.refresh")}
          </Button>
        </div>

        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'linear-gradient(120deg, rgba(38,38,48,0.98) 0%, rgba(24,24,32,0.96) 100%)',
            border: '1px solid rgba(60,60,80,0.22)',
            boxShadow: '0 2px 8px 0 rgba(0,0,0,0.18)',
          }}
        >
          {orderedItems.map((item) => {
            const statusText = t(`permission.status${item.status.replace(/(^|-)([a-z])/g, (_s, _dash, letter: string) => letter.toUpperCase())}`);
            const labelKey = keyLabelSuffix(item.key);
            const title = t(`permission.row${labelKey}Title`);
            const description = t(`permission.row${labelKey}Description`);
            const isGranted = isPermissionGranted(item.status);
            const isBlocked = isPermissionBlocked(item.status);
            const actionMode = resolvePermissionActionMode(item);
            const actionText = actionMode === "granted"
              ? t("permission.actionGranted")
              : actionMode === "request"
              ? t("permission.actionRequestAccess")
              : actionMode === "open-settings"
              ? t("permission.actionOpenSettings")
              : t("permission.actionManualCheck");

            return (
              <div
                key={item.key}
                className="grid grid-cols-12 gap-4 px-5 py-4"
                style={{ borderBottom: '1px solid rgba(60,60,80,0.18)' }}
              >
                <div className="col-span-7">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                    {item.requiredForRecording ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-300/40 bg-amber-300/15 text-amber-200">
                        {t("permission.required")}
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-400/30 bg-zinc-500/10 text-zinc-300">
                        {t("permission.optional")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-300 mt-1 leading-relaxed">{description}</p>
                </div>
                <div className="col-span-5 flex flex-col items-end justify-center gap-3">
                  <div
                    className={`px-3 py-1.5 rounded-full border text-xs ${statusBadgeClass(item.status)} ${statusTextClass(item.status)}`}
                  >
                    {statusText}
                  </div>
                  <Button
                    onClick={() => void handlePermissionAction(item)}
                    disabled={isGranted || !item.canOpenSettings || !item.settingsTarget}
                    className={`min-w-[260px] ${
                      isBlocked
                        ? "bg-amber-500/20 text-amber-100 border border-amber-400/40 hover:bg-amber-500/30"
                        : "bg-white/5 text-white border border-white/10 hover:bg-white/10"
                    } disabled:bg-white/5 disabled:text-zinc-400 disabled:border-white/10`}
                  >
                    {!isGranted ? <ExternalLink className="h-4 w-4 mr-1" /> : null}
                    {actionText}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="rounded-xl px-5 py-4"
          style={{
            background: 'linear-gradient(120deg, rgba(38,38,48,0.98) 0%, rgba(24,24,32,0.96) 100%)',
            border: '1px solid rgba(60,60,80,0.18)',
            boxShadow: '0 2px 8px 0 rgba(0,0,0,0.18)',
          }}
        >
          {readiness.ready ? (
            <div className="flex items-start gap-2 text-emerald-200">
              <ShieldCheck className="h-5 w-5 mt-0.5" />
              <p className="text-sm leading-relaxed">{t("permission.readyHint")}</p>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-amber-200">
              <ShieldAlert className="h-5 w-5 mt-0.5" />
              <p className="text-sm leading-relaxed">{t("permission.missingRequiredHint")}</p>
            </div>
          )}
          <p className="text-xs text-zinc-400 mt-2">{t("permission.relaunchHint")}</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            className="bg-[#34B27B] hover:bg-[#34B27B]/85 text-white min-w-[140px]"
            onClick={() => window.close()}
          >
            {t("permission.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
