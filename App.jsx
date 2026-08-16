import { useState } from 'react';
import './App.css';

const presetQueries = [
  { label: 'Accidents by year', path: '/api/reports/accidents-by-year' },
  { label: 'Top regions', path: '/api/reports/top-regions' },
  { label: 'Hourly pattern', path: '/api/reports/hourly-pattern' },
  { label: 'Road users', path: '/api/reports/road-users' },
  { label: 'Earliest Year', path: '/api/answers/earliest-year' },
  { label: 'Saxony Injury Accidents 2023', path: '/api/answers/saxony-2023' },
  { label: 'NRW Data Available From', path: '/api/reports/by-ags-prefix?prefix=05' },
  { label: 'MV Data Available From', path: '/api/reports/by-ags-prefix?prefix=13' },
  { label: 'Pedestrian Accidents Berlin 2023', path: '/api/answers/berlin-pedestrians-2023' },
  { label: 'Advanced Combined Aggregation', path: '/api/answers/monthly-advanced-aggregation' },
  { label: 'Accidents in Region', path: '/api/reports/accidents-in-region?ags=01001' },
  { label: 'Accidents by Month', path: '/api/reports/accidents-by-month' },
  { label: 'Top Accident Rates', path: '/api/reports/top-accident-rates' },
  { label: 'Zero Accident Regions', path: '/api/reports/zero-accident-regions' },
];


function App() {
  const [result, setResult] = useState({ columns: [], rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [activeLabel, setActiveLabel] = useState('');

  const [agsPrefix, setAgsPrefix] = useState('');

  const fetchReport = async (endpointPath, labelText) => {
    setLoading(true);
    setError(null);
    setHasQueried(true);
    setActiveLabel(labelText);

    try {
      const response = await fetch(endpointPath, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server responded with status code ${response.status}`);
      }

      setResult({
        columns: data.columns || [],
        rows: data.rows || []
      });
    } catch (err) {
      setError(err.message || 'An error occurred during data processing.');
      setResult({ columns: [], rows: [] });
    } finally {
      setLoading(false);
    }
  };

  const rowCount = result.rows.length;

  return (
    <main className="dashboard-container">
      <header className="dashboard-header">
        <h1>German Accident Atlas Analytics</h1>
        <p className="subtitle">Dynamic Open Data Integration Terminal (Secure REST API Mode)</p>
      </header>

      <section className="dashboard-grid">

        <section className="controls-panel">
          <h2>Analytical Query Presets</h2>
          <div className="metric-buttons-stack">
            {presetQueries.map((item) => (
              <button
                key={item.label}
                className={`metric-btn ${activeLabel === item.label ? 'active' : ''}`}
                onClick={() => fetchReport(item.path, item.label)}
                disabled={loading}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1.5rem' }}>
            <h2>Ad-Hoc Regional Filter</h2>
            <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>
              Query specific administrative regions dynamically using their official AGS numerical code prefix (e.g., 14 for Saxony, 11 for Berlin).
            </p>
            <input
              type="text"
              style={{ 
                width: '100%', 
                padding: '0.6rem 0.5rem', 
                fontFamily: 'monospace',
                marginBottom: '0.75rem', 
                borderRadius: '4px', 
                border: '1px solid #ccc',
                boxSizing: 'border-box'
              }}
              value={agsPrefix}
              onChange={(e) => setAgsPrefix(e.target.value.replace(/\D/g, ''))} // Strictly allow numbers only on input change
              placeholder="Enter numeric AGS prefix (e.g., 05)"
              maxLength={5}
              disabled={loading}
            />
            <button
              className="metric-btn active"
              style={{ width: '100%', backgroundColor: '#0070f3', color: '#fff', border: 'none', cursor: 'pointer' }}
              onClick={() => fetchReport(`/api/reports/by-ags-prefix?prefix=${agsPrefix}`, `AGS Filter Prefix: ${agsPrefix}`)}
              disabled={loading || !agsPrefix.trim()}
            >
               Query Target Area
            </button>
          </div>
        </section>

        <section className="results-panel">
          <div className="results-panel-header">
            <h2>Live Data Management Grid Matrix</h2>
            {activeLabel && <span className="active-tag">Active View: {activeLabel}</span>}
          </div>

          <section className="view-window">
            {!hasQueried && (
              <p className="placeholder-message">Select a shortcut query metric from the sidebar preset selectors or execute an area code lookup filter.</p>
            )}

            {loading && (
              <div className="loading-spinner-container">
                <p className="loading-text">Validating structural data routes. Querying server connection pool cluster...</p>
              </div>
            )}

            {error && (
              <p className="error-message" style={{ background: '#fff0f0', color: '#d32f2f', padding: '1rem', borderRadius: '4px' }}>
                ⚠️ {error}
              </p>
            )}

            {!loading && !error && hasQueried && rowCount === 0 && (
              <p className="empty-message">Inquiry completed successfully, but returned 0 active rows matching criteria. (Zero case metric handled)</p>
            )}

            {!loading && !error && rowCount > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, rowIndex) => {
                      const executionKey = row.accident_id || row.region_id || row.name || `row-${rowIndex}`;
                      return (
                        <tr key={executionKey}>
                          {result.columns.map((column) => (
                            <td key={`${executionKey}-${column}`}>
                              {String(row[column] ?? '')}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

export default App;
