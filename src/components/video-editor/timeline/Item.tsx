import { useItem } from "dnd-timeline";
import type { Span } from "dnd-timeline";
import { cn } from "@/lib/utils";
import { ZoomIn, Scissors, MessageSquare, Captions } from "lucide-react";
import glassStyles from "./ItemGlass.module.css";
import { useI18n } from "@/i18n";

interface ItemProps {
  id: string;
  span: Span;
  rowId: string;
  children: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  zoomDepth?: number;
  variant?: 'zoom' | 'trim' | 'annotation' | 'subtitle';
  editable?: boolean;
}

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
  1: "1.25×",
  2: "1.5×",
  3: "1.8×",
  4: "2.2×",
  5: "3.5×",
  6: "5×",
};

export default function Item({ 
  id, 
  span, 
  rowId, 
  isSelected = false, 
  onSelect, 
  zoomDepth = 1,
  variant = 'zoom',
  editable = true,
  children
}: ItemProps) {
  const { t } = useI18n();
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id,
    span,
    data: { rowId },
  });

  const isZoom = variant === 'zoom';
  const isTrim = variant === 'trim';
  const isSubtitle = variant === 'subtitle';
  
  const glassClass = isZoom 
    ? glassStyles.glassGreen 
    : isTrim 
    ? glassStyles.glassRed 
    : isSubtitle
    ? glassStyles.glassBlue
    : glassStyles.glassYellow;
    
  const endCapColor = isZoom 
    ? '#21916A' 
    : isTrim 
    ? '#ef4444' 
    : isSubtitle
    ? '#2E6EE6'
    : '#B4A046';

  return (
    <div
      ref={setNodeRef}
      style={itemStyle}
      {...(editable ? listeners : {})}
      {...(editable ? attributes : {})}
      onPointerDownCapture={() => onSelect?.()}
      className="group"
    >
      <div style={itemContentStyle}>
        <div
          className={cn(
            glassClass,
            "w-full h-full overflow-hidden flex items-center justify-center gap-1.5 relative",
            editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            isSelected && glassStyles.selected
          )}
          style={{ height: 40, color: '#fff' }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.();
          }}
        >
          <div
            className={cn(glassStyles.zoomEndCap, glassStyles.left)}
            style={{
              cursor: editable ? 'col-resize' : 'default',
              pointerEvents: editable ? 'auto' : 'none',
              width: 8,
              opacity: editable ? 0.9 : 0,
              background: endCapColor,
            }}
            title={t("timeline.resizeLeft")}
          />
          <div
            className={cn(glassStyles.zoomEndCap, glassStyles.right)}
            style={{
              cursor: editable ? 'col-resize' : 'default',
              pointerEvents: editable ? 'auto' : 'none',
              width: 8,
              opacity: editable ? 0.9 : 0,
              background: endCapColor,
            }}
            title={t("timeline.resizeRight")}
          />
          {/* Content */}
          <div className="relative z-10 flex items-center gap-1.5 text-white/90 opacity-80 group-hover:opacity-100 transition-opacity select-none">
            {isZoom ? (
              <>
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
                </span>
              </>
            ) : isTrim ? (
              <>
                <Scissors className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {t("timeline.trim")}
                </span>
              </>
            ) : isSubtitle ? (
              <>
                <Captions className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            ) : (
              <>
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
