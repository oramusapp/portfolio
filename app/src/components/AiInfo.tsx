import { Fragment } from 'react';
import { IcClose } from './icons';

// Strategy notes for the AI Apocalypse Portfolio: the rules sent with the portfolio, the base allocation from the
// "AI Value Chain Satellite Portfolio Analysis" PDF (February 2026) and how the signal sheet reads.
const BASE: [string, string, number, string, string][] = [
  ['SMH', 'Chips / Fab / Equipment', 25, '0.088%', 'Core AI infrastructure bet, covers value-chain layers 1–5. NVDA ≈17% of SMH = 4.25% of the portfolio.'],
  ['DTCR', 'Data Center Real Estate', 15, '0.075%', 'Physical layer (Equinix, Digital Realty). Driven by rates, lease rates, occupancy. ~1% dividend.'],
  ['NLR', 'Power / Nuclear', 20, '0.112%', 'Critical diversifier: uranium prices, energy policy, utilities. Lowest correlation with the others.'],
  ['CIBR', 'Cybersecurity', 15, '0.089%', 'Mandatory OpEx, more defensive than semis. Overlap mainly AVGO (~7%).'],
  ['IGV', 'App Software', 15, '0.059%', 'AI monetization layer (MSFT, Palantir, Oracle, Salesforce). No semiconductor overlap.'],
  ['BOTZ', 'Robotics / Physical AI', 10, '0.068%', 'Lowest weight to limit the NVDA overlap with SMH; ~25% Japan exposure.']
];
const SHEET: [string, number, string, string, string, string, string][] = [
  ['SMH', 30, '1', '1', 'XLK (Information Tech)', '83.33%', '25%'],
  ['NLR', 30, '0', '0', 'not enough history', '0.00%', '0%'],
  ['DTCR', 15, '1', '1', 'XLRE (Real Estate)', '83.33%', '13%'],
  ['IGV', 15, '0', '1', 'IWF (Growth)', '50.00%', '8%'],
  ['BOTZ', 10, '1', '1', 'VT (Global)', '83.33%', '8%']
];
const STRESS: [string, string, string][] = [
  ['AI capex accelerates', '+25% to +40%', 'Continued demand'],
  ['Efficiency shock (DeepSeek-style)', '−5% to −12%', 'Adoption breadth expands'],
  ['Growth-to-value rotation (6+ mo)', '−8% to −14%', 'Rebalancing opportunity']
];

export function AiInfo({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow ai-info" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>🤖 AI Apocalypse Portfolio — strategy</h2>
            <div className="dim small">Thematic AI value-chain satellite, 3–5 year horizon. Broker: Interactive Brokers.</div></div>
          <button className="icon" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>

        <div className="card pane">
          <h3>Rules</h3>
          <ul className="info-list">
            <li><b>Why:</b> exposure to AI disruption/adoption — a hedge if your job is negatively correlated with it.</li>
            <li><b>Entry:</b> carefully DCA into the ETFs over the course of a few weeks.</li>
            <li><b>Friday afternoon</b> buys use the “close” and “weekend” effects at once — an edge optimization, <i>not required</i>. You can buy at any time.</li>
            <li><b>Signals</b> manage exposure to all holdings simultaneously and can come at any time — not daily. Enter one here only when it arrives.</li>
          </ul>
        </div>

        <div className="card pane">
          <h3>Base allocation (PDF, Feb 2026)</h3>
          <div className="table-wrap"><table className="mini info-table">
            <thead><tr><th>Ticker</th><th>Layer</th><th className="r">Weight</th><th className="r">ER contrib.</th></tr></thead>
            <tbody>{BASE.map(([t, l, w, er, why]) => <Fragment key={t}>
              <tr className="no-line"><td><b>{t}</b></td><td>{l}</td><td className="r"><b>{w}%</b></td><td className="r">{er}</td></tr>
              <tr><td colSpan={4} className="dim why">{why}</td></tr>
            </Fragment>)}</tbody>
          </table></div>
          <div className="info-facts">
            <span><b>0.49%</b> blended expense ratio</span><span><b>~1.1</b> portfolio beta</span><span><b>~0.7%</b> dividend yield</span>
            <span><b>12 / 17</b> value-chain layers</span><span><b>35%</b> low tech-correlation (NLR + DTCR)</span><span><b>~5.65%</b> NVIDIA (SMH + BOTZ)</span>
          </div>
          <div className="dim small">NVDA cap: to keep NVIDIA strictly under 5%, the PDF suggests BOTZ 10% → 7% and the 3% to NLR (23%) or CIBR (18%).</div>
        </div>

        <div className="card pane">
          <h3>Reading a signal</h3>
          <div className="dim small">Example signal sheet sent with the portfolio. Its base weights (SMH 30, NLR 30, DTCR 15, IGV 15, BOTZ 10; no CIBR) differ from the PDF.</div>
          <div className="table-wrap"><table className="mini info-table">
            <thead><tr><th>ETF</th><th className="r">Weight</th><th className="r">Trends</th><th className="r">Conv.</th><th className="r">Adjusted</th></tr></thead>
            <tbody>{SHEET.map(([t, w, a, b, m, c, adj]) => (
              <tr key={t}><td><b>{t}</b><div className="dim tiny">{m}</div></td><td className="r">{w}%</td>
                <td className="r"><span className={a === '1' ? 'pos' : 'neg'}>{a}</span> · <span className={b === '1' ? 'pos' : 'neg'}>{b}</span></td>
                <td className="r">{c}</td><td className="r"><b>{adj}</b></td></tr>
            ))}</tbody>
          </table></div>
          <ul className="info-list">
            <li>Under each ETF: its highest-correlated macro exposure (DRMO). Trends = Proprietary Trend 1 · 2: <span className="pos">1</span> = trend up, <span className="neg">0</span> = trend down.</li>
            <li>Conv. = average conviction, Adjusted = trend-adjusted weight. [Inference] Adjusted ≈ weight × average conviction (e.g. SMH 30% × 83.33% = 25%, IGV 15% × 50% ≈ 8%).</li>
            <li>[Inference] The trend-adjusted weights sum to 54%; the rest (46%) is not allocated, so in this app it goes to CASH.</li>
            <li><b>In the app:</b> Add Signal → <i>New weights</i> → enter the trend-adjusted weights + CASH (sum 100%). Use <i>DCA</i> for buying in over a few weeks.</li>
          </ul>
        </div>

        <div className="card pane">
          <h3>Stress tests (PDF)</h3>
          <div className="table-wrap"><table className="mini info-table">
            <thead><tr><th>Scenario</th><th className="r">Est. return</th><th>Recovery driver</th></tr></thead>
            <tbody>{STRESS.map(([s, r, d]) => <tr key={s}><td>{s}</td><td className="r">{r}</td><td className="dim">{d}</td></tr>)}</tbody>
          </table></div>
          <div className="dim small">In all three the portfolio survives intact; NLR + DTCR (35%) bring different return drivers (energy, real estate, commodities). With a crypto core, they are also the part least correlated with crypto.</div>
        </div>

        <div className="card pane">
          <h3>Excluded</h3>
          <ul className="info-list">
            <li><b>QTUM</b> — label mismatch: mostly conventional semis / defense, not quantum.</li>
            <li><b>POWR</b> — only ~$89M AUM, too illiquid; NLR covers power.</li>
            <li><b>SKYY / WCLD</b> — overlap with hyperscalers already in IGV.</li>
          </ul>
          <div className="dim small">Source: “AI Value Chain Satellite Portfolio Analysis”, February 2026 — for educational discussion only, not investment advice. Figures are approximate.</div>
        </div>
      </div>
    </div>
  );
}
