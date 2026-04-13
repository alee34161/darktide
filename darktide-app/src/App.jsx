import { useEffect, useState, useMemo } from "react";
import "./App.css";
import axios from "axios";

const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const API_KEY = import.meta.env.VITE_API_KEY;

const getColorForRatio = (ratio) => {
  // Clamp ratio between 0 and 1
  ratio = Math.max(0, Math.min(1, ratio));
  
  if (ratio < 0.5) {
    // Dark Red to Medium Orange (0 to 0.5)
    const r = Math.round(160 + (60 * ratio * 2));  // 160 to 220
    const g = Math.round(0 + (140 * ratio * 2));   // 0 to 140
    const b = Math.round(0 + (10 * ratio * 2));    // 0 to 10
    return `rgb(${r},${g},${b})`;
  } else {
    // Medium Orange to Muted Green (0.5 to 1)
    const r = Math.round(220 - (100 * (ratio - 0.5) * 2)); // 220 to 120
    const g = Math.round(140 + (40 * (ratio - 0.5) * 2));  // 140 to 180
    const b = Math.round(10 + (40 * (ratio - 0.5) * 2));   // 10 to 50
    return `rgb(${r},${g},${b})`;
  }
};

function App() {
  const [rows, setRows] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState("COMBINED");

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Individual?key=${API_KEY}`;

  useEffect(() => {
    axios.get(url).then(res => setRows(res.data.values || []));
  }, []);

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

  const filteredRuns = selectedPlayer === "COMBINED"
    ? runs
    : runs.map(run => ({
        ...run,
        players: run.players[selectedPlayer]
          ? { [selectedPlayer]: run.players[selectedPlayer] }
          : {}
      })).filter(run => Object.keys(run.players).length);

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
            <button onClick={() => setSelectedPlayer("COMBINED")}>Combined</button>
            {allPlayers.map(p => (
              <button key={p} onClick={() => setSelectedPlayer(p)}>{p}</button>
            ))}
          </div>
        </div>

        {filteredRuns.map((run, idx) => {
          // Find the original run data to get all players for proper max calculation
          const originalRun = runs.find(r => r.date === run.date);
          const maxValues = computeMaxValues(originalRun ? originalRun.players : run.players);
          
          return (
            <div key={idx} className="run">
              <div className="date">{run.date}</div>

              {Object.entries(run.players).map(([name, data]) => (
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
