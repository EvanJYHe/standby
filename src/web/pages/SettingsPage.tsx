import { useEffect, useState } from "react";

import { Button } from "../components/ui.js";
import type { StandbyApi, SchedulingSettings } from "../types.js";

interface SettingsPageProps {
  api: StandbyApi;
  refreshKey: number;
  onReset: () => Promise<void>;
}

function PolicyToggle({ label, detail, checked, disabled, onChange }: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-5 border-b border-line py-4 last:border-b-0">
      <span>
        <strong className="block text-sm font-medium">{label}</strong>
        <span className="mt-1 block max-w-xl text-xs leading-5 text-muted">{detail}</span>
      </span>
      <input
        aria-label={label}
        checked={checked}
        className="mt-0.5 h-4 w-4 accent-standby"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function SettingsPage({ api, refreshKey, onReset }: SettingsPageProps) {
  const [settings, setSettings] = useState<SchedulingSettings>();
  const [status, setStatus] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getSettings().then((nextSettings) => {
      if (active) setSettings(nextSettings);
    }).catch(() => {
      if (active) setStatus("Settings could not be loaded.");
    });
    return () => { active = false; };
  }, [api, refreshKey]);

  const save = async (patch: Partial<SchedulingSettings>) => {
    setSaving(true);
    setStatus("Saving…");
    try {
      setSettings(await api.patchSettings(patch));
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That setting could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveNumber = (key: "moveLimit" | "maxDiscountPercent", raw: string, current: number, min: number, max: number) => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) return;
    const value = Math.max(min, Math.min(max, parsed));
    if (value === current) return;
    void save({ [key]: value });
  };

  const reset = async () => {
    setSaving(true);
    setStatus("Resetting…");
    try {
      await api.resetDemo();
      await onReset();
      setSettings(await api.getSettings());
      setConfirmingReset(false);
      setStatus("Demo week reset");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The demo week could not be reset.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto max-w-[1760px]">
      <div className="mb-4 flex items-start justify-between gap-4 px-1 py-2">
        <div>
          <h2 className="text-[32px] font-semibold tracking-[-0.05em]">Settings</h2>
          <p className="mt-1 text-sm text-muted">Shape how Standby detects openings, calls customers, and commits changes.</p>
        </div>
        {status === undefined ? null : <span className="mt-1 font-mono text-[10px] text-muted">{status}</span>}
      </div>
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-[14px] border border-line bg-panel shadow-panel">
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-sm font-semibold">Automation</h3>
            <p className="mt-1 text-xs text-muted">Each change is applied to the deterministic scheduling engine.</p>
          </div>
          {settings === undefined ? (
            <div className="m-5 h-64 animate-pulse rounded-standby bg-[#f0eee8]" />
          ) : (
            <div className="px-5">
              <PolicyToggle
                checked={settings.refillEnabled}
                detail="Start refill work when a confirmed appointment is cancelled."
                disabled={saving}
                label="Automatic vacancy refill"
                onChange={(checked) => void save({ refillEnabled: checked })}
              />
              <PolicyToggle
                checked={settings.moveEarlierEnabled}
                detail="Ask eligible later same-day customers whether they want the newly opened earlier time."
                disabled={saving}
                label="Offer earlier appointments"
                onChange={(checked) => void save({ moveEarlierEnabled: checked })}
              />
              <PolicyToggle
                checked={settings.allowAlternateBarbers}
                detail="Offer another qualified barber only when customer preference permits it."
                disabled={saving}
                label="Allow alternate barbers"
                onChange={(checked) => void save({ allowAlternateBarbers: checked })}
              />
              <PolicyToggle
                checked={settings.waitlistEnabled}
                detail="Use active waitlist entries after eligible same-day moves."
                disabled={saving}
                label="Use the waitlist"
                onChange={(checked) => void save({ waitlistEnabled: checked })}
              />
              <PolicyToggle
                checked={settings.pastCustomerOutreachEnabled}
                detail="Contact opted-in past customers only after same-day and waitlist candidates."
                disabled={saving}
                label="Past-customer outreach"
                onChange={(checked) => void save({ pastCustomerOutreachEnabled: checked })}
              />
              <div className="grid gap-4 border-t border-line py-5 md:grid-cols-3">
                <label className="text-xs font-medium text-muted">
                  Maximum appointment moves
                  <input
                    aria-label="Maximum appointment moves"
                    className="mt-2 h-10 w-full rounded-standby border border-line bg-white px-3 text-sm text-ink"
                    defaultValue={settings.moveLimit}
                    disabled={saving}
                    key={`move-${settings.moveLimit}`}
                    max={3}
                    min={0}
                    onBlur={(event) => saveNumber("moveLimit", event.target.value, settings.moveLimit, 0, 3)}
                    type="number"
                  />
                </label>
                <label className="text-xs font-medium text-muted">
                  Maximum discount percent
                  <input
                    aria-label="Maximum discount percent"
                    className="mt-2 h-10 w-full rounded-standby border border-line bg-white px-3 text-sm text-ink"
                    defaultValue={settings.maxDiscountPercent}
                    disabled={saving}
                    key={`discount-${settings.maxDiscountPercent}`}
                    max={15}
                    min={0}
                    onBlur={(event) => saveNumber("maxDiscountPercent", event.target.value, settings.maxDiscountPercent, 0, 15)}
                    step={5}
                    type="number"
                  />
                </label>
                <label className="text-xs font-medium text-muted">
                  Offer expiry
                  <select
                    aria-label="Offer expiry"
                    className="mt-2 h-10 w-full rounded-standby border border-line bg-white px-3 text-sm text-ink"
                    disabled={saving}
                    onChange={(event) => void save({ offerExpirySeconds: Number(event.target.value) })}
                    value={settings.offerExpirySeconds}
                  >
                    <option value={60}>1 minute</option>
                    <option value={120}>2 minutes</option>
                    <option value={180}>3 minutes</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-[14px] border border-line bg-panel px-5 py-4 shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Demo week</h3>
              <p className="mt-1 text-xs leading-5 text-muted">Restore the operational seed before a live walkthrough.</p>
            </div>
            {confirmingReset ? (
              <div className="flex items-center gap-2">
                <Button disabled={saving} onClick={() => setConfirmingReset(false)} variant="ghost">Keep current week</Button>
                <Button aria-label="Confirm demo reset" disabled={saving} onClick={() => void reset()} variant="danger">Confirm reset</Button>
              </div>
            ) : (
              <Button disabled={saving} onClick={() => setConfirmingReset(true)}>Reset demo week</Button>
            )}
          </div>
          {confirmingReset ? (
            <p className="mt-3 rounded-standby bg-amber-soft px-3 py-2 text-xs text-[#74551f]">
              This restores the seeded week while preserving linked demo identities.
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
