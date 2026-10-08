import { memo } from 'react'
import { ParamKnob } from './ParamKnob'
import { FX_RACK_HEIGHT, type FilterType, type TrackFxState } from './trackFx'

interface FxRackProps {
  fx: TrackFxState
  pan: number
  onPanLive: (value: number) => void
  onPanCommit: (value: number) => void
  onFxLive: (path: string, value: number) => void
  onFxCommit: (path: string, value: number) => void
  onBypass: (section: keyof TrackFxState) => void
  onFilterType: (type: FilterType) => void
}

function BypassToggle({
  active,
  onClick,
  label
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`fx-bypass ${active ? 'active' : ''}`}
      onClick={onClick}
      title={active ? `${label}: bypass` : `${label}: activo`}
      aria-pressed={active}
    >
      {active ? 'Off' : 'On'}
    </button>
  )
}

export const FxRack = memo(function FxRack({
  fx,
  pan,
  onPanLive,
  onPanCommit,
  onFxLive,
  onFxCommit,
  onBypass,
  onFilterType
}: FxRackProps) {
  return (
    <div className="fx-rack" style={{ height: `${FX_RACK_HEIGHT}px` }} data-testid="fx-rack">
      <section className="fx-module">
        <header className="fx-module-head">
          <span>Canal</span>
        </header>
        <div className="fx-module-knobs">
          <ParamKnob label="Pan" value={pan} min={-1} max={1} step={0.01} onLive={onPanLive} onCommit={onPanCommit} />
        </div>
      </section>
      <section className={`fx-module${fx.eq.bypass ? ' bypassed' : ''}`}>
        <header className="fx-module-head">
          <span>EQ</span>
          <BypassToggle active={fx.eq.bypass} onClick={() => onBypass('eq')} label="EQ" />
        </header>
        <div className="fx-module-knobs">
          <ParamKnob label="Low" value={fx.eq.low} min={-12} max={12} step={0.1} unit="dB" disabled={fx.eq.bypass} onLive={(v) => onFxLive('eq.low', v)} onCommit={(v) => onFxCommit('eq.low', v)} />
          <ParamKnob label="Mid" value={fx.eq.mid} min={-12} max={12} step={0.1} unit="dB" disabled={fx.eq.bypass} onLive={(v) => onFxLive('eq.mid', v)} onCommit={(v) => onFxCommit('eq.mid', v)} />
          <ParamKnob label="High" value={fx.eq.high} min={-12} max={12} step={0.1} unit="dB" disabled={fx.eq.bypass} onLive={(v) => onFxLive('eq.high', v)} onCommit={(v) => onFxCommit('eq.high', v)} />
        </div>
      </section>
      <section className={`fx-module${fx.compressor.bypass ? ' bypassed' : ''}`}>
        <header className="fx-module-head">
          <span>Comp</span>
          <BypassToggle active={fx.compressor.bypass} onClick={() => onBypass('compressor')} label="Compresor" />
        </header>
        <div className="fx-module-knobs">
          <ParamKnob label="Thresh" value={fx.compressor.threshold} min={-60} max={0} step={0.5} unit="dB" disabled={fx.compressor.bypass} onLive={(v) => onFxLive('comp.threshold', v)} onCommit={(v) => onFxCommit('comp.threshold', v)} />
          <ParamKnob label="Ratio" value={fx.compressor.ratio} min={1} max={20} step={0.1} disabled={fx.compressor.bypass} onLive={(v) => onFxLive('comp.ratio', v)} onCommit={(v) => onFxCommit('comp.ratio', v)} />
          <ParamKnob label="Atk" value={fx.compressor.attack} min={0.001} max={1} step={0.001} unit="s" disabled={fx.compressor.bypass} onLive={(v) => onFxLive('comp.attack', v)} onCommit={(v) => onFxCommit('comp.attack', v)} />
          <ParamKnob label="Rel" value={fx.compressor.release} min={0.01} max={1} step={0.01} unit="s" disabled={fx.compressor.bypass} onLive={(v) => onFxLive('comp.release', v)} onCommit={(v) => onFxCommit('comp.release', v)} />
          <ParamKnob label="Gain" value={fx.compressor.makeup} min={0} max={12} step={0.1} unit="dB" disabled={fx.compressor.bypass} onLive={(v) => onFxLive('comp.makeup', v)} onCommit={(v) => onFxCommit('comp.makeup', v)} />
        </div>
      </section>
      <section className={`fx-module${fx.filter.bypass ? ' bypassed' : ''}`}>
        <header className="fx-module-head">
          <span>Filtro</span>
          <div className="fx-filter-types">
            <button type="button" className={`fx-type-btn${fx.filter.type === 'lowpass' ? ' active' : ''}`} onClick={() => onFilterType('lowpass')} disabled={fx.filter.bypass}>LP</button>
            <button type="button" className={`fx-type-btn${fx.filter.type === 'highpass' ? ' active' : ''}`} onClick={() => onFilterType('highpass')} disabled={fx.filter.bypass}>HP</button>
          </div>
          <BypassToggle active={fx.filter.bypass} onClick={() => onBypass('filter')} label="Filtro" />
        </header>
        <div className="fx-module-knobs">
          <ParamKnob label="Cut" value={fx.filter.cutoff} min={20} max={20000} step={1} unit="Hz" disabled={fx.filter.bypass} onLive={(v) => onFxLive('filter.cutoff', v)} onCommit={(v) => onFxCommit('filter.cutoff', v)} />
          <ParamKnob label="Res" value={fx.filter.resonance} min={0.1} max={18} step={0.1} disabled={fx.filter.bypass} onLive={(v) => onFxLive('filter.resonance', v)} onCommit={(v) => onFxCommit('filter.resonance', v)} />
        </div>
      </section>
      <section className={`fx-module${fx.delay.bypass ? ' bypassed' : ''}`}>
        <header className="fx-module-head">
          <span>Delay</span>
          <BypassToggle active={fx.delay.bypass} onClick={() => onBypass('delay')} label="Delay" />
        </header>
        <div className="fx-module-knobs">
          <ParamKnob label="Time" value={fx.delay.time} min={0.01} max={1} step={0.01} unit="s" disabled={fx.delay.bypass} onLive={(v) => onFxLive('delay.time', v)} onCommit={(v) => onFxCommit('delay.time', v)} />
          <ParamKnob label="FB" value={fx.delay.feedback} min={0} max={0.95} step={0.01} disabled={fx.delay.bypass} onLive={(v) => onFxLive('delay.feedback', v)} onCommit={(v) => onFxCommit('delay.feedback', v)} />
          <ParamKnob label="Mix" value={fx.delay.mix} min={0} max={1} step={0.01} disabled={fx.delay.bypass} onLive={(v) => onFxLive('delay.mix', v)} onCommit={(v) => onFxCommit('delay.mix', v)} />
        </div>
      </section>
      <section className={`fx-module${fx.reverb.bypass ? ' bypassed' : ''}`}>
        <header className="fx-module-head">
          <span>Reverb</span>
          <BypassToggle active={fx.reverb.bypass} onClick={() => onBypass('reverb')} label="Reverb" />
        </header>
        <div className="fx-module-knobs">
          <ParamKnob label="Mix" value={fx.reverb.mix} min={0} max={1} step={0.01} disabled={fx.reverb.bypass} onLive={(v) => onFxLive('reverb.mix', v)} onCommit={(v) => onFxCommit('reverb.mix', v)} />
          <ParamKnob label="Size" value={fx.reverb.size} min={0.05} max={0.98} step={0.01} disabled={fx.reverb.bypass} onLive={(v) => onFxLive('reverb.size', v)} onCommit={(v) => onFxCommit('reverb.size', v)} />
        </div>
      </section>
    </div>
  )
})
