# 🦠 Disease Spread Simulator & Analysis Dashboard

Agent-based disease spread simulator with live epidemic curves, in-browser epidemic analysis and an interactive data science dashboard. It showcases **agent-based modeling**, **real-time visualization**, and **data science** skills.

---

## 🔗 Live Demo

**Simulator:** https://sameeha0.github.io/Disease-Spread-Animation-Web-Game/

**Analysis Dashboard:** [Streamlit Cloud](https://disease-spread-animation-web-game-tccqs9bdlxcy6uykdsx4mh.streamlit.app/)

![Simulator running](docs/screenshot-live.png)

## Key Features

### Simulator (index.html)
- **Agent-Based Simulation**: 20-400 agents, each healthy, infected, recovered or vaccinated
- **Real-Time Visualization**: high-DPI canvas rendering at 60 FPS with movement trails and a visible infection zone around every infected person
- **Spatial Optimization**: grid-based neighbor lookup for O(1) contact checks
- **Interactive Parameters**: 7 tunable parameters, grouped into Population and Transmission; transmission settings change live while the simulation runs
- **4 Preset Scenarios**: Baseline, Fast Spread, Vaccinated Population, Low Spread (each preset sets every parameter, so scenarios never mix)
- **Hover to Inspect**: hover over any person to see their state, how long they have been infected, when they recover and who infected them
- **Stacked Epidemic Curve**: healthy / infected / recovered / vaccinated over time, with the peak marked
- **In-Browser Analysis** (no backend needed): peak infected and peak time, attack rate, doubling time from a log-linear fit of early growth (with R²), an estimated R₀ and the matching herd-immunity threshold
- **Outbreak Summary**: the simulation stops by itself when the last person recovers and shows a summary
- **Data Import/Export**: load CSV/JSON epidemic data (chart + analysis), export simulation results
- **Keyboard Shortcuts**: <kbd>Space</kbd> start / pause, <kbd>R</kbd> reset
- **Responsive Design**: desktop, tablet and phone

### Analysis Dashboard (streamlit_app.py)
- **Data Visualization**: multi-layer interactive Plotly charts
- **File Upload**: drag-and-drop CSV/JSON timeseries data (for example a file exported from the simulator)
- **Curve Fitting**: logistic sigmoid model with R² goodness-of-fit
- **Peak Analysis**: identify and analyze infection peaks
- **Epidemiological Metrics**: attack rate, duration, doubling time, daily change rates
- **Export Results**: download analysis as CSV
- **Demo Data**: built-in synthetic epidemic data for testing

![Outbreak summary and analysis](docs/screenshot-analysis.png)

---

## How the model works

1. **Movement**: every person moves in a random walk and bounces off the walls.
2. **Contact**: for each infected person, the spatial grid returns nearby people; anyone healthy inside the infection radius can be infected.
3. **Transmission**: the chance falls linearly with distance. It is converted to the length of each frame, so the spread is the same at any frame rate and on any screen.
4. **Recovery**: infected people recover after the recovery time and are then immune.
5. **Analysis**: R₀ is estimated with the SIR approximation R₀ ≈ 1 + r·D, where r is the early exponential growth rate and D the recovery time.

---

## Data Format

**CSV:**
```csv
t,healthy,infected,recovered,vaccinated
0,95,5,0,0
1,90,10,0,0
2,85,15,5,0
```

**JSON:**
```json
[
  {"t":0,"healthy":95,"infected":5,"recovered":0,"vaccinated":0},
  {"t":1,"healthy":90,"infected":10,"recovered":0,"vaccinated":0}
]
```

---

## Local Development (Optional)

**View simulator locally:**
```bash
python -m http.server 8000
# then open http://localhost:8000
```

**Run analysis dashboard locally:**
```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Opens the interactive dashboard at `http://localhost:8501`

---

## Testing Checklist

- [x] **Simulator**: agents appear on load; Start / Space begins the run
- [x] **Controls**: all sliders, presets and buttons respond; transmission sliders work while running
- [x] **Hover**: tooltip shows details for the person under the cursor
- [x] **Outbreak end**: simulation stops and shows a summary when infections reach zero
- [x] **Analysis**: peak, attack rate, doubling time and R₀ calculate in the browser
- [x] **Data Import**: CSV/JSON files parse and draw on the chart
- [x] **Responsive**: no horizontal scrolling at 390 px wide
- [x] **Dashboard**: Streamlit app loads with demo data

---

## Project Structure

```
├── index.html          # Simulator UI
├── js/
│   └── simulation.js   # Agent-based engine, chart, analysis and UI logic
├── css/
│   └── style.css       # Design tokens, responsive layout
├── docs/               # README screenshots
├── streamlit_app.py    # Interactive analysis dashboard
├── requirements.txt    # Python dependencies
└── README.md
```

---

## Highlights

**Frontend Skills**
- Canvas API with high-DPI scaling for real-time 60 FPS visualization
- Vanilla JavaScript (no frameworks), OOP design with Agent and Simulation classes
- Design system with CSS custom properties; accessible controls, keyboard shortcuts and reduced-motion support

**Data Science Skills**
- Epidemic metrics computed in the browser: log-linear growth fit, doubling time, R₀ estimate
- Python scientific computing (SciPy, NumPy, pandas) and interactive Streamlit dashboards

**Engineering Skills**
- Spatial optimization: O(1) neighbor lookup with grid indexing
- Frame-rate-independent transmission model
- Data processing: CSV/JSON parsing and export

**Deployment**
- Simulator on GitHub Pages (deploys from the `main` branch)
- Dashboard on Streamlit Cloud

---
## 📜 License
Copyright © 2026 Sameeha. All rights reserved.

This project is proprietary software. Unauthorized copying, modification, distribution, or use of this code, in whole or in part, for any purpose (commercial or non-commercial) is strictly prohibited without the prior written permission of the author.

For permission requests, please contact: sameeharaza07@gmail.com
