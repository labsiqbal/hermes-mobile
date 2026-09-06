import { useState } from "react";
import { currentScale, setScale } from "../lib/appearance";

export function Appearance() {
  const [accent, setAccent] = useState(() => document.documentElement.style.getPropertyValue('--scratch-accent') || '#99baff');
  const [accentEnabled, setAccentEnabled] = useState(() => Boolean(document.documentElement.style.getPropertyValue('--scratch-accent')));
  function scratchAccent(color: string, enabled: boolean) {
    setAccent(color); setAccentEnabled(enabled);
    if (enabled) document.documentElement.style.setProperty('--scratch-accent', color);
    else document.documentElement.style.removeProperty('--scratch-accent');
  }
  const [scale, setScaleState] = useState(currentScale);
  const [appearanceSaved, setAppearanceSaved] = useState(true);
  function changeScale(value: string) {
    setAppearanceSaved(setScale(value));
    setScaleState(currentScale());
  }

  return <div className="screen"><div className="body">
        <div className="card">
          <label className="appearance-scale" htmlFor="ui-scale">
            <span className="rowcard-title">UI scale</span>
            <select id="ui-scale" aria-label="UI scale" className="field" value={scale} onChange={event => changeScale(event.target.value)}>
              <option value="75">75% Compact</option>
              <option value="100">100% Standard</option>
              <option value="125">125% Large</option>
            </select>
          </label>
          <p className="hint">All screens, including chat text. Saved on this device only. Touch targets and text keep readable minimum sizes; browser zoom still works.</p>
          {!appearanceSaved && <p role="status" className="hint">Applied for now. Browser storage is unavailable; this choice may reset on reload.</p>}
        </div>

        <div className="card scratch-accent">
          <div className="rowcard-title">Scratch accent</div>
          <p className="hint">A temporary accent for tab indicators and decorative edges. Text and status colors stay readable. This does not change your gateway or profile; reloading restores the authored defaults.</p>
          <label className="accent-control"><input type="checkbox" aria-label="Enable scratch accent" checked={accentEnabled} onChange={event => scratchAccent(accent, event.target.checked)} />Enable scratch accent</label>
          <label className="accent-control">Accent color<input type="color" aria-label="Scratch accent color" value={accent} onChange={event => scratchAccent(event.target.value, true)} /></label>
          <button className="btn btn-ghost" onClick={() => scratchAccent('#99baff', false)}>Restore authored defaults</button>
        </div>

  </div></div>;
}
