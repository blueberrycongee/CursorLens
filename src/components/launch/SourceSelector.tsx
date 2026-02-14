import { useState, useEffect, useCallback } from "react";
import { Button } from "../ui/button";
import { MdCheck } from "react-icons/md";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Card } from "../ui/card";
import styles from "./SourceSelector.module.css";
import { useI18n } from "@/i18n";
import { reportUserActionError } from "@/lib/userErrorFeedback";
import { isScreenCaptureAccessBlocked, type ScreenCaptureAccessStatus } from "@/lib/screenCaptureAccess";

interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string | null;
  display_id: string;
  appIcon: string | null;
}

export function SourceSelector() {
  const { t } = useI18n();
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadErrorDetail, setLoadErrorDetail] = useState<string>("");
  const [screenCaptureAccessStatus, setScreenCaptureAccessStatus] = useState<ScreenCaptureAccessStatus>("unknown");
  const [canOpenSystemSettings, setCanOpenSystemSettings] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setLoadErrorDetail("");
    let accessStatus: ScreenCaptureAccessStatus = "unknown";
    try {
      try {
        const statusResult = await window.electronAPI.getScreenCaptureAccessStatus();
        accessStatus = statusResult.status;
        setScreenCaptureAccessStatus(statusResult.status);
        setCanOpenSystemSettings(Boolean(statusResult.canOpenSystemSettings));
      } catch {
        setScreenCaptureAccessStatus("unknown");
        setCanOpenSystemSettings(false);
      }

      if (isScreenCaptureAccessBlocked(accessStatus)) {
        setLoadFailed(true);
        setLoadErrorDetail(t("source.screenPermissionHint"));
        return;
      }

      const rawSources = await window.electronAPI.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
      setSources(
        rawSources.map(source => ({
          id: source.id,
          name:
            source.id.startsWith('window:') && source.name.includes(' — ')
              ? source.name.split(' — ')[1] || source.name
              : source.name,
          thumbnail: source.thumbnail,
          display_id: source.display_id,
          appIcon: source.appIcon
        }))
      );
    } catch (error) {
      setLoadFailed(true);
      const fallbackDetail = isScreenCaptureAccessBlocked(accessStatus) ? t("source.screenPermissionHint") : "";
      const errorDetail = error instanceof Error ? error.message : String(error);
      setLoadErrorDetail(errorDetail);
      if (fallbackDetail) {
        setLoadErrorDetail(errorDetail || fallbackDetail);
      }
      if (!isScreenCaptureAccessBlocked(accessStatus)) {
        reportUserActionError({
          t,
          userMessage: t("source.loadFailed"),
          error,
          context: "source-selector.fetch-sources",
          dedupeKey: "source-selector.fetch-sources",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  const screenSources = sources.filter(s => s.id.startsWith('screen:'));
  const windowSources = sources.filter(s => s.id.startsWith('window:'));

  const handleSourceSelect = (source: DesktopSource) => setSelectedSource(source);
  const handleOpenSystemSettings = async () => {
    try {
      const result = await window.electronAPI.openScreenCaptureSettings();
      if (!result.success) {
        reportUserActionError({
          t,
          userMessage: t("source.openSystemSettingsFailed"),
          error: result.message || "openScreenCaptureSettings returned unsuccessful result",
          context: "source-selector.open-system-settings",
          dedupeKey: "source-selector.open-system-settings",
        });
      }
    } catch (error) {
      reportUserActionError({
        t,
        userMessage: t("source.openSystemSettingsFailed"),
        error,
        context: "source-selector.open-system-settings",
        dedupeKey: "source-selector.open-system-settings",
      });
    }
  };
  const handleOpenPermissionChecker = async () => {
    try {
      await window.electronAPI.openPermissionChecker();
    } catch (error) {
      reportUserActionError({
        t,
        userMessage: t("permission.openSettingsFailed"),
        error,
        context: "source-selector.open-permission-checker",
        dedupeKey: "source-selector.open-permission-checker",
      });
    }
  };
  const handleShare = async () => {
    if (!selectedSource) {
      return;
    }

    try {
      await window.electronAPI.selectSource(selectedSource);
    } catch (error) {
      reportUserActionError({
        t,
        userMessage: t("source.shareFailed"),
        error,
        context: "source-selector.share",
        details: {
          sourceId: selectedSource.id,
          sourceName: selectedSource.name,
        },
        dedupeKey: `source-selector.share:${selectedSource.id}`,
      });
    }
  };

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${styles.glassContainer}`} style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-600 mx-auto mb-2" />
          <p className="text-xs text-zinc-300">{t("source.loading")}</p>
        </div>
      </div>
    );
  }

  if (loadFailed) {
    const showSystemSettingsAction = canOpenSystemSettings && isScreenCaptureAccessBlocked(screenCaptureAccessStatus);
    return (
      <div className={`h-full flex items-center justify-center ${styles.glassContainer}`} style={{ minHeight: '100vh' }}>
        <div className="text-center px-6">
          <p className="text-sm text-zinc-100 mb-3">{t("source.loadFailed")}</p>
          {loadErrorDetail ? (
            <p className="text-xs text-zinc-400 mb-3 whitespace-pre-wrap break-all max-w-[560px]">
              {loadErrorDetail}
            </p>
          ) : null}
          <div className="flex items-center justify-center gap-2">
            {showSystemSettingsAction ? (
              <Button
                onClick={() => void handleOpenSystemSettings()}
                className="bg-zinc-700 text-white hover:bg-zinc-600"
              >
                {t("source.openSystemSettings")}
              </Button>
            ) : null}
            <Button
              onClick={() => void handleOpenPermissionChecker()}
              className="bg-zinc-700 text-white hover:bg-zinc-600"
            >
              {t("source.checkPermissions")}
            </Button>
            <Button onClick={() => void fetchSources()} className="bg-[#34B27B] text-white hover:bg-[#34B27B]/85">
              {t("source.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center ${styles.glassContainer}`}>
      <div className="flex-1 flex flex-col w-full max-w-xl" style={{ padding: 0 }}>
        <Tabs defaultValue="screens">
          <TabsList className="grid grid-cols-2 mb-3 bg-zinc-900/40 rounded-full">
            <TabsTrigger value="screens" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-zinc-200 rounded-full text-xs py-1">{t("source.screens")}</TabsTrigger>
            <TabsTrigger value="windows" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-zinc-200 rounded-full text-xs py-1">{t("source.windows")}</TabsTrigger>
          </TabsList>
            <div className="h-72 flex flex-col justify-stretch">
            <TabsContent value="screens" className="h-full">
              <div className="grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative">
                {screenSources.map(source => (
                  <Card
                    key={source.id}
                    className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''} cursor-pointer h-fit p-2 scale-95`}
                    style={{ margin: 8, width: '90%', maxWidth: 220 }}
                    onClick={() => handleSourceSelect(source)}
                  >
                    <div className="p-1">
                      <div className="relative mb-1">
                        <img
                          src={source.thumbnail || ''}
                          alt={source.name}
                          className="w-full aspect-video object-cover rounded border border-zinc-800"
                        />
                        {selectedSource?.id === source.id && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-4 h-4 bg-[#34B27B] rounded-full flex items-center justify-center shadow-md">
                              <MdCheck className={styles.icon} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className={styles.name + " truncate"}>{source.name}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="windows" className="h-full">
              <div className="grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative">
                {windowSources.map(source => (
                  <Card
                    key={source.id}
                    className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''} cursor-pointer h-fit p-2 scale-95`}
                    style={{ margin: 8, width: '90%', maxWidth: 220 }}
                    onClick={() => handleSourceSelect(source)}
                  >
                    <div className="p-1">
                      <div className="relative mb-1">
                        <img
                          src={source.thumbnail || ''}
                          alt={source.name}
                          className="w-full aspect-video object-cover rounded border border-gray-700"
                        />
                        {selectedSource?.id === source.id && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center shadow-md">
                              <MdCheck className={styles.icon} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {source.appIcon && (
                          <img
                            src={source.appIcon}
                            alt={t("source.appIcon")}
                            className={styles.icon + " flex-shrink-0"}
                          />
                        )}
                        <div className={styles.name + " truncate"}>{source.name}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
      <div className="border-t border-zinc-800 p-2 w-full max-w-xl">
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => window.close()} className="px-4 py-1 text-xs bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">{t("source.cancel")}</Button>
          <Button onClick={handleShare} disabled={!selectedSource} className="px-4 py-1 text-xs bg-[#34B27B] text-white hover:bg-[#34B27B]/80 disabled:opacity-50 disabled:bg-zinc-700">{t("source.share")}</Button>
        </div>
      </div>
    </div>
  );
}
