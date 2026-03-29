"use client";

import { cn } from "@/lib/utils";

interface RangeEditorProps {
  min: number;
  max: number;
  sweetSpot?: number;
  onChange: (range: { min: number; max: number; sweetSpot?: number }) => void;
  disabled?: boolean;
}

const SIZE_PRESETS = [
  { label: "1-10", min: 1, max: 10 },
  { label: "11-50", min: 11, max: 50 },
  { label: "51-200", min: 51, max: 200 },
  { label: "201-500", min: 201, max: 500 },
  { label: "501-1K", min: 501, max: 1000 },
  { label: "1K-5K", min: 1001, max: 5000 },
  { label: "5K+", min: 5001, max: 100000 },
];

export function RangeEditor({ min, max, sweetSpot, onChange, disabled }: RangeEditorProps) {
  // Determine which presets are active
  const isActive = (preset: typeof SIZE_PRESETS[0]) =>
    min <= preset.min && max >= preset.max;

  const togglePreset = (preset: typeof SIZE_PRESETS[0]) => {
    if (disabled) return;
    if (isActive(preset)) {
      // Remove this range
      const newMin = preset.min === min ? preset.max + 1 : min;
      const newMax = preset.max === max ? preset.min - 1 : max;
      onChange({ min: Math.max(1, newMin), max: Math.max(newMin, newMax), sweetSpot });
    } else {
      // Expand range to include this preset
      onChange({
        min: Math.min(min, preset.min),
        max: Math.max(max, preset.max),
        sweetSpot,
      });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {SIZE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => togglePreset(preset)}
            disabled={disabled}
            className={cn(
              "text-[10px] px-2 py-1 rounded-md border font-medium transition-colors",
              isActive(preset)
                ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                : "text-muted-foreground border-border hover:border-foreground/30",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Range: <strong className="text-foreground">{min.toLocaleString()}</strong> - <strong className="text-foreground">{max.toLocaleString()}</strong></span>
        {sweetSpot && <span>Sweet spot: <strong className="text-foreground">{sweetSpot.toLocaleString()}</strong></span>}
      </div>
    </div>
  );
}
