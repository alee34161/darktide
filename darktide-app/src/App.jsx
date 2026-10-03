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


  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Individual?key=${API_KEY}`;

  useEffect(() => {
    axios.get(url)
      .then(res => { setRows(res.data.values || []); setLoadState("ok"); })
      .catch(err => { console.error("Failed to load the Individual sheet:", err); setLoadState("error"); });
  }, [url]);

  const toggleRun = (runKey) => {
    setCollapsedRuns(prev => ({ ...prev, [runKey]: !prev[runKey] }));
  };

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


  // Runs for the selected player view, narrowed by the loadout search.
  const filteredRuns = useMemo(() => {
    const search = loadoutSearch.toLowerCase();

    let baseRuns;
    if (selectedPlayer === "COMBINED") {
      baseRuns = runs;
    } else if (selectedPlayer === "Randoms") {
      baseRuns = runs
        .map(run => ({
          ...run,
          players: Object.fromEntries(
            Object.entries(run.players).filter(([name]) => isRandom(name))
          )
        }))
        .filter(run => Object.keys(run.players).length > 0);
    } else {
      baseRuns = runs
        .map(run => {
          const key = Object.keys(run.players).find(
            k => k.toLowerCase() === selectedPlayer.toLowerCase()
          );
          return {
            ...run,
            players: key ? { [selectedPlayer]: run.players[key] } : {}
          };
        })
        .filter(run => Object.keys(run.players).length > 0);
    }

    if (!search) return baseRuns;
    return baseRuns
      .map(run => ({
        ...run,
        players: Object.fromEntries(
          Object.entries(run.players).filter(([, data]) =>
            data.loadout.some(item => item.toLowerCase().includes(search))
          )
        )
      }))
      .filter(run => Object.keys(run.players).length > 0);
  }, [runs, selectedPlayer, loadoutSearch]);


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

  // A row of stat cells, optionally colour-coded.
  const CellRow = ({ items, maxValues, useColors = false }) => (
    <div className="row">
      {items.map((item, i) => {
        let backgroundColor = "#2a2a2a";
        
        if (useColors && item.key && maxValues && maxValues[item.key]) {
          const ratio = item.value / maxValues[item.key];
          backgroundColor = getColorForRatio(ratio);
        }

        const style = { backgroundColor, ...(item.style || {}) };

        return (
          <div
            key={i}
            className="cell"
            style={style}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );

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
          <input
             type="text"
             placeholder="Search loadout..."
             value={loadoutSearch}
             onChange={e => setLoadoutSearch(e.target.value)}
             className="search-bar"
          />
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


        {!showRecords && filteredRuns.map(run => {
          const originalRun = runs.find(r => r.date === run.date);
          const maxValues = computeMaxValues(originalRun ? originalRun.players : run.players);
          const isCollapsed = collapsedRuns[run.date];

          return (
            <div key={run.date} className="run">
              <div className="date" onClick={() => toggleRun(run.date)} style={{ cursor: "pointer", userSelect: "none"}}>
                {isCollapsed ? "▶" : "▼"} {run.date}
              </div>
              {run.havoc?.rank && (
                <div className="havoc" style={{
                  backgroundColor: "#7f1d1d", color: "#fff", padding: "8px 12px",
                  borderRadius: "6px", margin: "6px 0", textAlign: "center",
                }}>
                  <strong>Havoc Rank {run.havoc.rank}</strong>
                  {run.havoc.details.map((line, i) => (
                    <div key={i} style={{ fontSize: "0.85em", marginTop: "4px", opacity: 0.9 }}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
              {!isCollapsed && Object.entries(run.players).map(([name, data]) => (
                <div key={name} className="report">
                  <div className="player-name">{name}</div>

                  <CellRow items={data.loadout.map(l => ({ label: l }))} useColors={false} />

                  <CellRow maxValues={maxValues} useColors={true} items={[
                    { key:"melee_elites", label:`Melee Elites: ${data.stats.melee_elites||0}`, value:data.stats.melee_elites||0 },
                    { key:"ranged_elites", label:`Ranged Elites: ${data.stats.ranged_elites||0}`, value:data.stats.ranged_elites||0 },
                    { key:"melee_specials", label:`Melee Specials: ${data.stats.melee_specials||0}`, value:data.stats.melee_specials||0 },
                    { key:"ranged_specials", label:`Ranged Specials: ${data.stats.ranged_specials||0}`, value:data.stats.ranged_specials||0 },
                    { key:"horde_trash", label:`Melee Trash: ${data.stats.horde_trash||0}`, value:data.stats.horde_trash||0 },
                    { key:"ranged_trash", label:`Ranged Trash: ${data.stats.ranged_trash||0}`, value:data.stats.ranged_trash||0 }
                  ]} />

                  <CellRow maxValues={maxValues} useColors={true} items={[
                    { key:"boss_damage", label:`Boss Damage: ${(data.stats.boss_damage||0).toLocaleString()}`, value:data.stats.boss_damage||0 },
                    { key:"elite_damage", label:`Elite Damage: ${(data.stats.elite_damage||0).toLocaleString()}`, value:data.stats.elite_damage||0 },
                    { key:"special_damage", label:`Special Damage: ${(data.stats.special_damage||0).toLocaleString()}`, value:data.stats.special_damage||0 },
                    { key:"trash_damage", label:`Trash Damage: ${(data.stats.trash_damage||0).toLocaleString()}`, value:data.stats.trash_damage||0 }
                  ]} />

                  <CellRow items={[
                    { label:`Assists: ${data.stats.assists||0}` },
                    { label:`Needed Help: ${data.stats.needed_help||0}` },
                    { label:`Ammo Taken: ${data.stats.ammo_taken_||0}` }
                  ]} useColors={false} />

                  <CellRow items={[
                    { label:`Blitz Uses: ${data.stats.blitz_uses||0}` },
                    { label:`Combat Ability Uses: ${data.stats.combat_ability_uses||0}` },
                    { label:`Damage Taken: ${data.stats.damage_taken||0}` }
                  ]} useColors={false} />

                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
