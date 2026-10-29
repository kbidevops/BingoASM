"use client";

// Bar charts with the clone's markup (.vb vertical / .hb horizontal) so its CSS — tooltips via data-tip — applies.

export interface Bar {
  label: string;
  value: number;
  /** Tooltip / accessible text; defaults to "label · value". */
  tip?: string;
}

function niceMax(max: number) {
  if (max <= 0) return { top: 1, step: 1 };
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const s = max / step <= 2 ? step / 2 : max / step <= 5 ? step : step * 2;
  return { top: Math.ceil(max / s) * s, step: s };
}

export function VBar({ title, bars, unit = "건", fmt = (n: number) => n.toLocaleString() }: { title: string; bars: Bar[]; unit?: string; fmt?: (n: number) => string }) {
  const { top, step } = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const ticks: number[] = [];
  for (let t = top; t >= 0; t -= step) ticks.push(t);
  const tip = (b: Bar) => b.tip ?? `${b.label} · ${fmt(b.value)}${unit}`;
  return (
    <figure className="vb">
      <figcaption>{title}</figcaption>
      <div className="vbw" role="img" aria-label={`${title}: ${bars.map(tip).join(", ")}`}>
        <div className="vby" aria-hidden="true">{ticks.map((t) => <span key={t}>{fmt(t)}</span>)}</div>
        <div className="vbp">
          {ticks.map((t) => <i key={t} className="vbg" style={{ ["--p" as string]: String(1 - t / top) }}></i>)}
          <div className="vbc">
            {bars.map((b) => (
              <div key={b.label} className="vbi" tabIndex={0} data-tip={tip(b)}>
                <b style={{ height: `calc((100% - 22px) * ${top ? b.value / top : 0})` }}></b>
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export function HBar({ title, bars, unit = "건", fmt = (n: number) => n.toLocaleString() }: { title: string; bars: Bar[]; unit?: string; fmt?: (n: number) => string }) {
  const max = Math.max(0, ...bars.map((b) => b.value)) || 1;
  const tip = (b: Bar) => b.tip ?? `${b.label} · ${fmt(b.value)}${unit}`;
  return (
    <figure className="hb">
      <figcaption>{title}</figcaption>
      <div role="img" aria-label={`${title}: ${bars.map(tip).join(", ")}`}>
        {bars.length ? bars.map((b) => (
          <div key={b.label} className="hbr" tabIndex={0} data-tip={tip(b)}>
            <span className="hbl">{b.label}</span>
            <span className="hbt"><b style={{ width: `${(b.value / max) * 100}%` }}></b></span>
            <span className="hbv">{fmt(b.value)}{unit}</span>
          </div>
        )) : <p className="hint">자료가 없습니다.</p>}
      </div>
    </figure>
  );
}
