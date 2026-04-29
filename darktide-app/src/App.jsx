import { useEffect, useState, useMemo } from "react";
import "./App.css";
import axios from "axios";

const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const API_KEY = import.meta.env.VITE_API_KEY;


const getColorForRatio = (ratio) => {
  ratio = Math.max(0, Math.min(1, ratio));

  if (ratio < 0.1) {
    // Red
    const t = ratio / 0.1;
    return `rgb(200, ${Math.round(t * 20)}, 0)`;
  } else if (ratio < 0.3) {
    // Reddish-orange
    const t = (ratio - 0.1) / 0.2;
    return `rgb(220, ${Math.round(20 + t * 100)}, 0)`;
  } else if (ratio < 0.4) {
    // Orange
    const t = (ratio - 0.3) / 0.1;
    return `rgb(230, ${Math.round(120 + t * 45)}, 0)`;
  } else if (ratio < 0.6) {
    // Yellow
    const t = (ratio - 0.4) / 0.2;
    return `rgb(${Math.round(230 - t * 15)}, ${Math.round(165 + t * 40)}, 0)`;
  } else if (ratio < 0.7) {
    // Yellow-green / olive
    const t = (ratio - 0.6) / 0.1;
    return `rgb(${Math.round(215 - t * 75)}, ${Math.round(205 - t * 25)}, 0)`;
  } else if (ratio < 0.9) {
    // Muted green
    const t = (ratio - 0.7) / 0.2;
    return `rgb(${Math.round(140 - t * 40)}, ${Math.round(180 + t * 10)}, ${Math.round(t * 20)})`;
} else {
    // Green
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


  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Individual?key=${API_KEY}`;

  useEffect(() => {
    axios.get(url).then(res => setRows(res.data.values || []));
  }, []);

  const toggleRun = (idx) => {
    setCollapsedRuns(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const runs = useMemo(() => {
    const parsed = [];
    let currentRun = null;
    let currentPlayer = null;

    console.log("Raw rows data:", rows.slice(0, 30)); // Log first 30 rows

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const firstCell = (row[0] || "").trim();
      
      // Check for date marker
      if (firstCell.startsWith("▶")) {
        currentRun = { date: firstCell.replace("▶", "").trim(), players: {} };
        parsed.push(currentRun);
        console.log(`Found run: ${currentRun.date}`);
        continue;
      }

      // Check for player marker
      if (firstCell.startsWith("👤")) {
        currentPlayer = firstCell.replace("👤", "").trim();
        if (currentRun) {
          currentRun.players[currentPlayer] = { loadout: [], stats: {} };
          console.log(`Found player: ${currentPlayer}`);
        }
        continue;
      }

      if (!currentRun || !currentPlayer) continue;

      const playerData = currentRun.players[currentPlayer];
      
      // Skip header rows
      const rowText = row.join(" ").toLowerCase();
      if (rowText.includes("class melee ranged") || 
          rowText.includes("kills damage") || 
          rowText.includes("additional stats")) {
        continue;
      }

      // Collect loadout items (should be exactly 7 items)
      if (playerData.loadout.length < 7) {
        // Add all non-empty cells from this row to loadout
        for (let j = 0; j < row.length && playerData.loadout.length < 7; j++) {
          const cell = (row[j] || "").trim();
          if (cell && !cell.startsWith("▶") && !cell.startsWith("👤")) {
            playerData.loadout.push(cell);
            console.log(`Added loadout item: ${cell}`);
          }
        }
        continue;
      }

      // Parse stats from remaining rows
      console.log(`Checking row for stats:`, row);
      for (let j = 0; j < row.length - 1; j++) {
        const label = (row[j] || "").trim();
        const valueStr = (row[j + 1] || "").trim();
        
        // Check if current cell is a label and next cell is a number
        if (label && valueStr && /^[\d,]+$/.test(valueStr)) {
          const key = label.toLowerCase().replace(/\s+/g, "_").replace(/[()%]/g, "");
          const value = parseInt(valueStr.replace(/,/g, ""), 10);
          console.log(`Parsed stat: ${label} -> ${key} = ${value}`);
          playerData.stats[key] = value;
          j++; // Skip the next cell since we just processed it
        }
      }
    }

    console.log("Parsed runs:", parsed);
    return parsed;
  }, [rows]);

  const allPlayers = useMemo(
    () => Array.from(new Set(runs.flatMap(r => Object.keys(r.players)))),
    [runs]
  );

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


  const filteredRuns = useMemo(() => {
  const search = loadoutSearch.toLowerCase();
  return (selectedPlayer === "COMBINED"
    ? runs
    : runs.map(run => ({
        ...run,
        players: run.players[selectedPlayer]
          ? { [selectedPlayer]: run.players[selectedPlayer] }
          : {}
      })).filter(run => Object.keys(run.players).length)
  ).map(run => ({
    ...run,
    players: Object.fromEntries(
      Object.entries(run.players).filter(([, data]) =>
        !search || data.loadout.some(item => item.toLowerCase().includes(search))
      )
    )
  })).filter(run => Object.keys(run.players).length > 0);
}, [runs, selectedPlayer, loadoutSearch]);


  const computeMaxValues = (players) => {
    const max = {};
    Object.values(players).forEach(p => {
      Object.entries(p.stats).forEach(([k, v]) => {
        max[k] = Math.max(max[k] || 0, v);
      });
    });
    return max;
  };

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
            style={{ backgroundColor }}
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
                  { label: `${rec.player}`, style: { backgroundColor: "#c2ad37", color: "gold" } },
                  { label: `${rec.value.toLocaleString()}`, style: { backgroundColor: "#0ec44b" } },
                  { label: `${rec.date}`, style: { backgroundColor: "#2b119e" } }
                ]} />
             </div>
           ))}
          </div>
        )}


        {filteredRuns.map((run, idx) => {
          // Find the original run data to get all players for proper max calculation
          const originalRun = runs.find(r => r.date === run.date);
          const maxValues = computeMaxValues(originalRun ? originalRun.players : run.players);
          const isCollapsed = collapsedRuns[idx];
          
          return (
            <div key={idx} className="run">
              <div className="date" onClick={() => toggleRun(idx)} style={{ cursor: "pointer" , userSelect: "none"}}>
                {isCollapsed ? "▶" : "▼"} {run.date}
              </div>
              {!isCollapsed && Object.entries(run.players).map(([name, data]) => (
                <div key={name} className="report">
                  <div className="player-name">{name}</div>

                  {/* Loadout Row */}
                  <CellRow items={data.loadout.map(l => ({ label: l }))} useColors={false} />

                  {/* Kills Row */}
                  <CellRow maxValues={maxValues} useColors={true} items={[
                    { key:"melee_elites", label:`Melee Elites: ${data.stats.melee_elites||0}`, value:data.stats.melee_elites||0 },
                    { key:"ranged_elites", label:`Ranged Elites: ${data.stats.ranged_elites||0}`, value:data.stats.ranged_elites||0 },
                    { key:"melee_specials", label:`Melee Specials: ${data.stats.melee_specials||0}`, value:data.stats.melee_specials||0 },
                    { key:"ranged_specials", label:`Ranged Specials: ${data.stats.ranged_specials||0}`, value:data.stats.ranged_specials||0 },
                    { key:"horde_trash", label:`Melee Trash: ${data.stats.horde_trash||0}`, value:data.stats.horde_trash||0 },
                    { key:"ranged_trash", label:`Ranged Trash: ${data.stats.ranged_trash||0}`, value:data.stats.ranged_trash||0 }
                  ]} />

                  {/* Damage Row */}
                  <CellRow maxValues={maxValues} useColors={true} items={[
                    { key:"boss_damage", label:`Boss Damage: ${(data.stats.boss_damage||0).toLocaleString()}`, value:data.stats.boss_damage||0 },
                    { key:"elite_damage", label:`Elite Damage: ${(data.stats.elite_damage||0).toLocaleString()}`, value:data.stats.elite_damage||0 },
                    { key:"special_damage", label:`Special Damage: ${(data.stats.special_damage||0).toLocaleString()}`, value:data.stats.special_damage||0 },
                    { key:"trash_damage", label:`Trash Damage: ${(data.stats.trash_damage||0).toLocaleString()}`, value:data.stats.trash_damage||0 }
                  ]} />

                  {/* Support Row - No color coding */}
                  <CellRow items={[
                    { label:`Assists: ${data.stats.assists||0}` },
                    { label:`Needed Help: ${data.stats.needed_help||0}` },
                    { label:`Ammo Taken: ${data.stats.ammo_taken_||0}` }
                  ]} useColors={false} />

                  {/* Abilities Row - No color coding */}
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
