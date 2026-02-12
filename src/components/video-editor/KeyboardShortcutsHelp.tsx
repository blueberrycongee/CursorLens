import { HelpCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { formatShortcut } from "@/utils/platformUtils";
import { useI18n } from "@/i18n";

export function KeyboardShortcutsHelp() {
  const { t } = useI18n();
  const [shortcuts, setShortcuts] = useState({
    delete: 'Ctrl + D',
    pan: 'Shift + Ctrl + Scroll',
    zoom: 'Ctrl + Scroll'
  });

  useEffect(() => {
    Promise.all([
      formatShortcut(['mod', 'D']),
      formatShortcut(['shift', 'mod', 'Scroll']),
      formatShortcut(['mod', 'Scroll'])
    ]).then(([deleteKey, panKey, zoomKey]) => {
      setShortcuts({
        delete: deleteKey,
        pan: panKey,
        zoom: zoomKey
      });
    });
  }, []);

  return (
    <div className="relative group">
      <HelpCircle className="w-4 h-4 text-slate-500 hover:text-[#34B27B] transition-colors cursor-help" />
      <div className="absolute right-0 top-full mt-2 w-64 bg-[#09090b] border border-white/10 rounded-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 shadow-xl z-50">
        <div className="text-xs font-semibold text-slate-200 mb-2">{t("shortcut.title")}</div>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.addZoom")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">Z</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.addAnnotation")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">A</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.addKeyframe")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">F</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.addTrim")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">T</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.deleteSelected")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">{shortcuts.delete}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.panTimeline")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">{shortcuts.pan}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.zoomTimeline")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">{shortcuts.zoom}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t("shortcut.playPause")}</span>
            <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-mono">Space</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
