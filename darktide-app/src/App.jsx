import { useEffect, useState, useMemo } from "react";
import "./App.css";
import axios from "axios";

const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const API_KEY  = import.meta.env.VITE_API_KEY;

// The four permanent players; anyone else is a random. Names are matched
// case-insensitively because the sheet writes them in uppercase.
const KNOWN_PLAYERS = ['Steven', 'Lee', 'Injea', 'Blitter'];
const isKnown  = (name) => KNOWN_PLAYERS.some(k => k.toLowerCase() === name.toLowerCase());
const isRandom = (name) => !isKnown(name);

const PAGE_SIZE = 20;
const EXPANDED_BY_DEFAULT = 3;

const STAT_SECTIONS = [
  { title: "Kills", coloured: true, rows: [
    ["Melee Elites", "melee_elites"], ["Ranged Elites", "ranged_elites"],
    ["Melee Specials", "melee_specials"], ["Ranged Specials", "ranged_specials"],
    ["Melee Trash", "horde_trash"], ["Ranged Trash", "ranged_trash"],
  ]},
  { title: "Damage", coloured: true, rows: [
    ["Boss Damage", "boss_damage"], ["Elite Damage", "elite_damage"],
    ["Special Damage", "special_damage"], ["Trash Damage", "trash_damage"],
  ]},
  { title: "Support", coloured: false, rows: [
    ["Assists", "assists"], ["Needed Help", "needed_help"], ["Ammo Taken", "ammo_taken_"],
    ["Blitz Uses", "blitz_uses"], ["Combat Ability Uses", "combat_ability_uses"], ["Damage Taken", "damage_taken"],
  ]},
];

const S = {
  label: { fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9a9a9a" },
  control: { height: 36, padding: "0 8px", border: "1px solid #4a4a4a", borderRadius: 6, background: "#2a2a2a", color: "#ececec", fontSize: 13 },
  button: { minHeight: 36, padding: "0 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "1px solid #4a4a4a", cursor: "pointer" },
  on: { background: "#3b5bdb", color: "#ffffff" },
  off: { background: "#2a2a2a", color: "#ececec" },
  card: { background: "#242424", border: "1px solid #333333", borderRadius: 10, overflow: "hidden" },
  cellBorder: "1px solid #333333",
};

// Havoc rank and mutator names from a run's Havoc line ("Mutators: a, b").
const havocInfo = (run) => {
  if (!run.havoc) return { rank: null, mutators: [] };
  const line = run.havoc.details.find(d => /^mutators:/i.test(d)) || "";
  const mutators = line.replace(/^mutators:\s*/i, "").split(",").map(m => m.trim()).filter(Boolean);
  return { rank: parseInt(run.havoc.rank, 10), mutators };
};


// Red-to-green colour for a stat's share of the run's best value.
const getColorForRatio = (ratio) => {
  ratio = Math.max(0, Math.min(1, ratio));

  if (ratio < 0.1) {
    const t = ratio / 0.1;
    return `rgb(200, ${Math.round(t * 20)}, 0)`;
  } else if (ratio < 0.3) {
    const t = (ratio - 0.1) / 0.2;
    return `rgb(220, ${Math.round(20 + t * 100)}, 0)`;
  } else if (ratio < 0.4) {
    const t = (ratio - 0.3) / 0.1;
    return `rgb(230, ${Math.round(120 + t * 45)}, 0)`;
  } else if (ratio < 0.6) {
    const t = (ratio - 0.4) / 0.2;
    return `rgb(${Math.round(230 - t * 15)}, ${Math.round(165 + t * 40)}, 0)`;
  } else if (ratio < 0.7) {
    const t = (ratio - 0.6) / 0.1;
    return `rgb(${Math.round(215 - t * 75)}, ${Math.round(205 - t * 25)}, 0)`;
  } else if (ratio < 0.9) {
    const t = (ratio - 0.7) / 0.2;
    return `rgb(${Math.round(140 - t * 40)}, ${Math.round(180 + t * 10)}, ${Math.round(t * 20)})`;
} else {
    const t = (ratio - 0.9) / 0.1;
    return `rgb(${Math.round(100 - t * 50)}, ${Math.round(190 + t * 20)}, ${Math.round(20 + t * 10)})`;
  }
};

function App() {
  const [rows, setRows] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState("COMBINED");
  const [collapsedRuns, setCollapsedRuns] = useState({});
  const [loadoutSearch, setLoadoutSearch] = useState("");
  const [showRecords, setShowRecords] = useState(false);
  const [loadState, setLoadState] = useState("loading");
  const [havocMode, setHavocMode] = useState("all");
  const [minRank, setMinRank] = useState(0);
  const [classFilter, setClassFilter] = useState("all");
  const [mutatorFilter, setMutatorFilter] = useState([]);
  const [mutatorPanelOpen, setMutatorPanelOpen] = useState(false);
  const [mutatorQuery, setMutatorQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);


  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Individual?key=${API_KEY}`;

  useEffect(() => {
    axios.get(url)
      .then(res => { setRows(res.data.values || []); setLoadState("ok"); })
      .catch(err => { console.error("Failed to load the Individual sheet:", err); setLoadState("error"); });
  }, [url]);

  // Parse the Individual sheet's rows into runs, players, loadouts and stats.
  const runs = useMemo(() => {
    const parsed = [];
    let currentRun = null;
    let currentPlayer = null;
    let expectLoadout = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const firstCell = (row[0] || "").trim();
      
      if (firstCell.startsWith("▶")) {
        currentRun = { date: firstCell.replace("▶", "").trim(), players: {}, havoc: null };
        currentPlayer = null;
        expectLoadout = false;
        parsed.push(currentRun);
        continue;
      }

      if (/^HAVOC RANK/i.test(firstCell)) {
        const rank = firstCell.replace(/^HAVOC RANK\s*/i, "").trim();
        if (currentRun && rank) {
          currentRun.havoc = {
            rank,
            details: (row[1] || "").split("|").map(d => d.trim()).filter(Boolean),
          };
        }
        continue;
      }

      if (firstCell.startsWith("👤")) {
        currentPlayer = firstCell.replace("👤", "").trim();
        if (currentRun) {
          currentRun.players[currentPlayer] = { loadout: [], stats: {} };
        }
        continue;
      }

      if (!currentRun || !currentPlayer) continue;

      const playerData = currentRun.players[currentPlayer];
      const rowText = row.join(" ").toLowerCase();

      if (rowText.startsWith("class melee ranged")) {
        expectLoadout = true;
        continue;
      }
      if (expectLoadout) {
        playerData.loadout = Array.from({ length: 7 }, (_, k) => (row[k] || "").trim());
        expectLoadout = false;
        continue;
      }
      if (rowText.includes("kills damage") || rowText.includes("additional stats")) continue;

      for (let j = 0; j < row.length - 1; j++) {
        const label = (row[j] || "").trim();
        const valueStr = (row[j + 1] || "").trim();
        if (label && /^[\d,]+$/.test(valueStr)) {
          const key = label.toLowerCase().replace(/\s+/g, "_").replace(/[()%]/g, "");
          playerData.stats[key] = parseInt(valueStr.replace(/,/g, ""), 10);
          j++;
        }
      }
    }

    return parsed;
  }, [rows]);

  // Player buttons: the known players present, plus one Randoms button if needed.
  const allPlayers = useMemo(() => {
    const presentNames = new Set(runs.flatMap(r => Object.keys(r.players)));
    const known = KNOWN_PLAYERS.filter(p =>
      [...presentNames].some(n => n.toLowerCase() === p.toLowerCase())
    );
    const hasAnyRandom = [...presentNames].some(isRandom);
    return hasAnyRandom ? [...known, 'Randoms'] : known;
  }, [runs]);

  // All-time best value for each stat.
  const records = useMemo(() => {
  const statKeys = [
    "melee_elites", "ranged_elites", "melee_specials", "ranged_specials",
    "horde_trash", "ranged_trash", "boss_damage", "elite_damage",
    "special_damage", "trash_damage", "assists", "needed_help",
    "ammo_taken_", "blitz_uses", "combat_ability_uses", "damage_taken"
  ];

  const records = {};
  runs.forEach(run => {
    Object.entries(run.players).forEach(([playerName, data]) => {
      statKeys.forEach(key => {
        const val = data.stats[key] || 0;
        if (!records[key] || val > records[key].value) {
          records[key] = {
            value: val,
            player: playerName,
            date: run.date,
            loadout: data.loadout
          };
        }
      });
    });
  });
  return records;
}, [runs]);


  // Run-level options built from the data, so new classes and mutators appear automatically.
  const runMeta = useMemo(() => runs.map(run => ({
    ...havocInfo(run),
    classes: Object.values(run.players).map(p => p.loadout[0]).filter(Boolean),
  })), [runs]);

  const classOptions = useMemo(() => [...new Set(runMeta.flatMap(m => m.classes))].sort(), [runMeta]);
  const mutatorOptions = useMemo(() => [...new Set(runMeta.flatMap(m => m.mutators))].sort(), [runMeta]);

  // Runs for the selected player view, narrowed by the filters and loadout search, then sorted.
  const filteredRuns = useMemo(() => {
    const search = loadoutSearch.toLowerCase();
    const result = [];

    runs.forEach((run, i) => {
      const meta = runMeta[i];
      if (havocMode === "havoc" && meta.rank === null) return;
      if (havocMode === "normal" && meta.rank !== null) return;
      if (minRank > 0 && (meta.rank === null || meta.rank < minRank)) return;
      if (classFilter !== "all" && !meta.classes.includes(classFilter)) return;
      if (!mutatorFilter.every(m => meta.mutators.includes(m))) return;

      let players;
      if (selectedPlayer === "COMBINED") {
        players = run.players;
      } else if (selectedPlayer === "Randoms") {
        players = Object.fromEntries(Object.entries(run.players).filter(([name]) => isRandom(name)));
      } else {
        const key = Object.keys(run.players).find(k => k.toLowerCase() === selectedPlayer.toLowerCase());
        players = key ? { [selectedPlayer]: run.players[key] } : {};
      }
      if (search) {
        players = Object.fromEntries(Object.entries(players).filter(([, data]) =>
          data.loadout.some(item => item.toLowerCase().includes(search))));
      }
      if (Object.keys(players).length === 0) return;

      result.push({ ...run, players, allPlayers: run.players, rank: meta.rank, mutators: meta.mutators });
    });

    if (sortOrder === "rank") {
      result.sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1));
    }
    return result;
  }, [runs, runMeta, selectedPlayer, loadoutSearch, havocMode, minRank, classFilter, mutatorFilter, sortOrder]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); },
    [selectedPlayer, loadoutSearch, havocMode, minRank, classFilter, mutatorFilter, sortOrder]);

  const clearFilters = () => {
    setHavocMode("all"); setMinRank(0); setClassFilter("all");
    setMutatorFilter([]); setMutatorQuery(""); setSortOrder("newest"); setLoadoutSearch("");
  };

  const toggleMutator = (m) =>
    setMutatorFilter(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  // Each stat's highest value in a run, for colour coding.
  const computeMaxValues = (players) => {
    const max = {};
    Object.values(players).forEach(p => {
      Object.entries(p.stats).forEach(([k, v]) => {
        max[k] = Math.max(max[k] || 0, v);
      });
    });
    return max;
  };

  // A row of stat cells, optionally colour-coded (used by the Records view).
  const CellRow = ({ items, maxValues, useColors = false }) => (
    <div className="row">
      {items.map((item, i) => {
        let backgroundColor = "#2a2a2a";
        if (useColors && item.key && maxValues && maxValues[item.key]) {
          backgroundColor = getColorForRatio(item.value / maxValues[item.key]);
        }
        return (
          <div key={i} className="cell" style={{ backgroundColor, ...(item.style || {}) }}>
            {item.label}
          </div>
        );
      })}
    </div>
  );

  // One run as a table: players as columns, stats as rows, Havoc in the date bar.
  const RunTable = ({ run, index }) => {
    const maxValues = computeMaxValues(run.allPlayers);
    const isCollapsed = collapsedRuns[run.date] ?? index >= EXPANDED_BY_DEFAULT;
    const players = Object.entries(run.players);

    return (
      <section style={S.card} aria-label={`Run ${run.date}`}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: "10px 14px", background: "#263b2e" }}>
          <button type="button" aria-expanded={!isCollapsed}
            onClick={() => setCollapsedRuns(prev => ({ ...prev, [run.date]: !isCollapsed }))}
            style={{ minHeight: 36, padding: "0 6px", border: 0, background: "transparent", color: "#4ade80", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>
            {isCollapsed ? "▶" : "▼"} {run.date}
          </button>
          {run.rank !== null && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ padding: "4px 10px", borderRadius: 999, background: "#8f1d1d", color: "#ffffff", fontWeight: 700 }}>
                Havoc Rank {run.rank}
              </span>
              <span style={{ color: "#d8d8d8" }}>{run.mutators.join(", ")}</span>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th scope="col" style={{ ...S.label, width: 180, padding: "10px 12px", textAlign: "left", verticalAlign: "bottom" }}>Player</th>
                  {players.map(([name, data]) => (
                    <th key={name} scope="col" style={{ padding: "10px 10px 8px", textAlign: "center", verticalAlign: "top", minWidth: 170, borderLeft: S.cellBorder }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#6cb6ff", letterSpacing: "0.02em" }}>{name}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#e6e6e6", marginTop: 3 }}>
                        {data.loadout.slice(0, 3).filter(Boolean).join(" · ")}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 400, color: "#a8a8a8", marginTop: 2, lineHeight: 1.35 }}>
                        {data.loadout.slice(3, 7).filter(Boolean).join(" · ")}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STAT_SECTIONS.map(section => [
                  <tr key={section.title}>
                    <th scope="rowgroup" colSpan={players.length + 1}
                      style={{ ...S.label, fontSize: 11, letterSpacing: "0.12em", padding: "9px 12px 4px", textAlign: "left", borderTop: S.cellBorder }}>
                      {section.title}
                    </th>
                  </tr>,
                  ...section.rows.map(([label, key]) => (
                    <tr key={key}>
                      <th scope="row" style={{ padding: "5px 12px", textAlign: "left", fontSize: 13, fontWeight: 500, color: "#d0d0d0", whiteSpace: "nowrap", borderTop: S.cellBorder }}>
                        {label}
                      </th>
                      {players.map(([name, data]) => {
                        const value = data.stats[key] || 0;
                        const coloured = section.coloured && maxValues[key];
                        return (
                          <td key={name} style={{
                            padding: "5px 10px", textAlign: "center", fontSize: 13, fontVariantNumeric: "tabular-nums",
                            borderTop: S.cellBorder, borderLeft: S.cellBorder,
                            ...(coloured
                              ? { background: getColorForRatio(value / maxValues[key]), color: "#111111", fontWeight: 700 }
                              : { color: "#ececec", fontWeight: 500 }),
                          }}>
                            {value.toLocaleString()}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const mutatorList = mutatorOptions.filter(m => m.toLowerCase().includes(mutatorQuery.trim().toLowerCase()));
  const shownRuns = filteredRuns.slice(0, visibleCount);

  return (
    <div className="page">
      <div className="app">
        <div className="header">
          <h1>Darktide Stats</h1>
          <div className="buttons">
            <button onClick={() => {setSelectedPlayer("COMBINED"); setShowRecords(false);}}>Combined</button>
            {allPlayers.map(p => (
              <button key={p} onClick={() => {setSelectedPlayer(p); setShowRecords(false);}}>{p}</button>
            ))}
            <button onClick={() => setShowRecords(p => !p)}>Records</button>
          </div>
        </div>

        {loadState === "loading" && <div className="run"><div className="date">Loading reports…</div></div>}
        {loadState === "error" && (
          <div className="run"><div className="date">Couldn't load the reports. Try reloading the page.</div></div>
        )}
        {loadState === "ok" && runs.length === 0 && (
          <div className="run">
            <div className="date">No reports found. If a mission was just uploaded, the sheet may still be rebuilding — reload in a few seconds.</div>
          </div>
        )}

        {showRecords && (
          <div className="run">
           <div className="date">All-Time Records</div>
            {Object.entries(records).map(([key, rec]) => (
             <div key={key} className="report">
                <div className="player-name">
                  {key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </div>
                <CellRow items={rec.loadout.map(l => ({ label: l }))} useColors={false} />
                <CellRow useColors={false} items={[
                  { label: `${rec.player}`, style: { backgroundColor: "#c2ad37" } },
                  { label: `${rec.value.toLocaleString()}`, style: { backgroundColor: "#0ec44b" } },
                  { label: `${rec.date}`, style: { backgroundColor: "#2b119e" } }
                ]} />
             </div>
           ))}
          </div>
        )}

        {!showRecords && loadState === "ok" && runs.length > 0 && (
          <div style={{ maxWidth: 1120, margin: "0 auto", padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 14, color: "#ececec" }}>
            <section aria-label="Filters" style={{ ...S.card, overflow: "visible", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 22px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={S.label}>Loadout</span>
                  <input type="search" placeholder="e.g. Relic Blade" value={loadoutSearch}
                    onChange={e => setLoadoutSearch(e.target.value)} style={{ ...S.control, width: 200, padding: "0 10px" }} />
                </label>
                <div role="group" aria-label="Havoc" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ ...S.label, marginRight: 4 }}>Havoc</span>
                  {[["all", "All runs"], ["havoc", "Havoc only"], ["normal", "Non-Havoc"]].map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={havocMode === id} onClick={() => setHavocMode(id)}
                      style={{ ...S.button, ...(havocMode === id ? S.on : S.off) }}>{label}</button>
                  ))}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={S.label}>Min rank</span>
                  <select value={minRank} onChange={e => setMinRank(Number(e.target.value))} style={S.control}>
                    <option value={0}>Any</option>
                    {[10, 20, 30, 35].map(r => <option key={r} value={r}>{r}+</option>)}
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={S.label}>Class</span>
                  <select value={classFilter} onChange={e => setClassFilter(e.target.value)} style={S.control}>
                    <option value="all">Any</option>
                    {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 22px" }}>
                <div style={{ position: "relative" }}>
                  <button type="button" aria-expanded={mutatorPanelOpen} onClick={() => setMutatorPanelOpen(o => !o)}
                    style={{ ...S.button, ...S.off }}>
                    {mutatorFilter.length ? `Mutators (${mutatorFilter.length}) ▾` : "Mutators ▾"}
                  </button>
                  {mutatorPanelOpen && (
                    <div style={{ position: "absolute", top: 42, left: 0, zIndex: 5, width: 300, padding: 10, background: "#2a2a2a",
                      border: "1px solid #4a4a4a", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#b8b8b8" }}>
                        <span>Search mutators</span>
                        <input type="search" value={mutatorQuery} onChange={e => setMutatorQuery(e.target.value)}
                          placeholder="Type to filter" style={{ ...S.control, background: "#1f1f1f" }} />
                      </label>
                      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                        {mutatorList.map(m => (
                          <label key={m} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36, padding: "0 4px", fontSize: 13, color: "#ececec" }}>
                            <input type="checkbox" checked={mutatorFilter.includes(m)} onChange={() => toggleMutator(m)} style={{ width: 16, height: 16 }} />
                            <span>{m}</span>
                          </label>
                        ))}
                        {mutatorList.length === 0 && (
                          <p style={{ margin: "6px 4px", fontSize: 13, color: "#9a9a9a" }}>
                            {mutatorOptions.length ? "No mutators match." : "No Havoc runs yet."}
                          </p>
                        )}
                      </div>
                      <button type="button" onClick={() => setMutatorPanelOpen(false)}
                        style={{ ...S.button, ...S.on, borderColor: "#3b5bdb" }}>Done</button>
                    </div>
                  )}
                </div>
                {mutatorFilter.map(m => (
                  <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 4px 2px 12px", borderRadius: 999,
                    background: "#3b5bdb", color: "#ffffff", fontSize: 12, fontWeight: 600 }}>
                    {m}
                    <button type="button" aria-label={`Remove ${m}`} onClick={() => toggleMutator(m)}
                      style={{ width: 28, height: 28, border: 0, borderRadius: 999, background: "transparent", color: "#ffffff", fontSize: 16, lineHeight: 1, cursor: "pointer" }}>×</button>
                  </span>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={S.label}>Sort</span>
                  <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={S.control}>
                    <option value="newest">Newest first</option>
                    <option value="rank">Highest Havoc rank</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#b8b8b8" }}>
                <span>{filteredRuns.length} of {runs.length} runs match</span>
                <button type="button" onClick={clearFilters}
                  style={{ minHeight: 32, padding: "0 12px", border: "1px solid #4a4a4a", borderRadius: 6, background: "transparent", color: "#ececec", fontSize: 13, cursor: "pointer" }}>
                  Clear filters
                </button>
              </div>
            </section>

            {shownRuns.map((run, i) => <RunTable key={run.date} run={run} index={i} />)}

            {filteredRuns.length === 0 && (
              <p style={{ ...S.card, margin: 0, padding: 18, textAlign: "center", fontSize: 14, color: "#b8b8b8" }}>
                No runs match these filters.
              </p>
            )}
            {filteredRuns.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "6px 0" }}>
                <span style={{ fontSize: 13, color: "#9a9a9a" }}>Showing {shownRuns.length} of {filteredRuns.length}</span>
                {filteredRuns.length > visibleCount && (
                  <button type="button" onClick={() => setVisibleCount(c => c + PAGE_SIZE)} style={{ ...S.button, ...S.off }}>
                    Show {PAGE_SIZE} more
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
