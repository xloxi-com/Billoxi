import { useEffect, useRef, useState } from "react";
import {
  BlockStack,
  Box,
  ColorPicker,
  Popover,
  TextField,
  hexToRgb,
  hsbToHex,
  rgbToHsb,
} from "@shopify/polaris";
import type { HSBAColor } from "@shopify/polaris";

function normalizeHexColor(value: string, fallback: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((ch) => ch + ch)
      .join("")}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

function hexToHsba(value: string, fallback: string): HSBAColor {
  const hex = normalizeHexColor(value, fallback);
  return { ...rgbToHsb(hexToRgb(hex)), alpha: 1 };
}

/** Polaris TextField + ColorPicker swatch (Header / Accent style colors). */
export function AppearanceColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (next: string) => void;
}) {
  const hex = normalizeHexColor(value, fallback);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hsb, setHsb] = useState<HSBAColor>(() => hexToHsba(hex, fallback));
  const [draft, setDraft] = useState(hex);
  const rafRef = useRef<number | null>(null);
  const pendingHexRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (pickerOpen) return;
    setDraft(hex);
    setHsb(hexToHsba(hex, fallback));
  }, [hex, fallback, pickerOpen]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const commitHex = (next: string, immediate = false) => {
    const normalized = normalizeHexColor(next, fallback);
    setDraft(normalized);
    setHsb(hexToHsba(normalized, fallback));
    if (immediate) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingHexRef.current = null;
      onChangeRef.current(normalized);
      return;
    }
    pendingHexRef.current = normalized;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingHexRef.current;
      pendingHexRef.current = null;
      if (pending) onChangeRef.current(pending);
    });
  };

  return (
    <TextField
      label={label}
      value={draft}
      autoComplete="off"
      onChange={(next) => {
        setDraft(next);
        const trimmed = next.trim();
        const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
        if (
          /^#[0-9a-fA-F]{6}$/i.test(withHash) ||
          /^#[0-9a-fA-F]{3}$/i.test(withHash)
        ) {
          commitHex(withHash);
        }
      }}
      onBlur={() => commitHex(draft, true)}
      prefix={
        <Popover
          active={pickerOpen}
          preferredAlignment="left"
          onClose={() => {
            if (pendingHexRef.current) {
              commitHex(pendingHexRef.current, true);
            }
            setPickerOpen(false);
          }}
          activator={
            <button
              type="button"
              className="appearance-color-field__swatch"
              style={{ backgroundColor: draft }}
              aria-label={`Pick ${label} color`}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            />
          }
        >
          <Box padding="300">
            <BlockStack gap="200">
              <ColorPicker
                color={hsb}
                onChange={(color) => {
                  setHsb(color);
                  const next = hsbToHex(color).toUpperCase();
                  setDraft(next);
                  commitHex(next);
                }}
              />
              <TextField
                label="Hex"
                labelHidden
                value={draft}
                autoComplete="off"
                onChange={(next) => {
                  setDraft(next);
                  const trimmed = next.trim();
                  const withHash = trimmed.startsWith("#")
                    ? trimmed
                    : `#${trimmed}`;
                  if (
                    /^#[0-9a-fA-F]{6}$/i.test(withHash) ||
                    /^#[0-9a-fA-F]{3}$/i.test(withHash)
                  ) {
                    commitHex(withHash);
                  }
                }}
              />
            </BlockStack>
          </Box>
        </Popover>
      }
    />
  );
}
