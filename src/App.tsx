import { useEffect, useState } from "react";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import VideoEditor from "./components/video-editor/VideoEditor";
import { GlobalErrorObserver } from "./components/app/GlobalErrorObserver";
import { Toaster } from "./components/ui/sonner";
import { loadAllCustomFonts } from "./lib/customFonts";
import { useI18n } from "./i18n";

export default function App() {
  const { t } = useI18n();
  const [windowType, setWindowType] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('windowType') || '';
    setWindowType(type);
    if (type === 'hud-overlay' || type === 'source-selector') {
      document.body.style.background = 'transparent';
      document.documentElement.style.background = 'transparent';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      document.getElementById('root')?.style.setProperty('background', 'transparent');
      document.getElementById('root')?.style.setProperty('overflow', 'hidden');
    }

    // Load custom fonts on app initialization
    loadAllCustomFonts().catch((error) => {
      console.error('Failed to load custom fonts:', error);
    });
  }, []);

  let content: JSX.Element;
  switch (windowType) {
    case 'hud-overlay':
      content = <LaunchWindow />;
      break;
    case 'source-selector':
      content = <SourceSelector />;
      break;
    case 'editor':
      content = <VideoEditor />;
      break;
    default:
      content = (
        <div className="w-full h-full bg-background text-foreground">
          <h1>{t("app.name")}</h1>
        </div>
      );
      break;
  }

  return (
    <>
      <GlobalErrorObserver />
      {content}
      <Toaster theme="dark" className="pointer-events-auto" />
    </>
  );
}
