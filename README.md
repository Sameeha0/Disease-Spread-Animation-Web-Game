# 🦠 Disease Spread Simulator & Analysis Dashboard

Advanced disease spread simulator with interactive data visualization dashboard. showcasing **agent-based modeling**, **real-time visualization**, and **data science** capabilities.

---

## 🔗 Live Demo

**Simulator:** https://sameeha0.github.io/Disease-Spread-Animation-Web-Game/

**Analysis Dashboard:** [Streamlit Cloud]](https://disease-spread-animation-web-game-tccqs9bdlxcy6uykdsx4mh.streamlit.app/)

## Key Features

### Simulator (index.html) 
- **Agent-Based Simulation**: 120+ agents with individual states (healthy/infected/recovered/vaccinated)
- **Real-Time Visualization**: Canvas-based rendering at 60 FPS with agent trails
- **Spatial Optimization**: Grid-based neighbor lookup for O(1) collision detection
- **Interactive Parameters**: 7 tunable parameters (population, speed, infection radius, probability, recovery time, vaccination %)
- **3 Preset Scenarios**: Fast Spread, Vaccinated Population, Low Transmission
- **Live Statistics**: Real-time population counts, FPS counter, infection curves
- **Data Import/Export**: Load CSV/JSON, export simulation results
- **Responsive Design**: Works on desktop and tablet

### Analysis Dashboard (streamlit_app.py) 
- **Data Visualization**: Multi-layer interactive Plotly charts
- **File Upload**: Drag-drop CSV/JSON timeseries data
- **Curve Fitting**: Logistic sigmoid model with R² goodness-of-fit
- **Peak Analysis**: Identify and analyze infection peaks
- **Epidemiological Metrics**: 
  - Attack rate (% infected)
  - Duration and doubling time
  - R² fit quality
  - Daily change rates
- **Export Results**: Download analysis as CSV
- **Demo Data**: Built-in synthetic epidemic data for testing

### Code Quality 
- **Object-Oriented Design**: Agent & Simulation classes with clear separation
- **Professional Documentation**: 100+ JSDoc comments, section headers
- **Optimized Performance**: Spatial grid for fast neighbor queries
- **Clean CSS Architecture**: CSS variables, responsive grid layout
- **No External Dependencies** (Frontend): Vanilla JS, HTML5 Canvas only
- **Data Science Stack** (Backend): SciPy, NumPy, Plotly for analysis

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
open index.html
```

**Run analysis dashboard locally:**
```bash
pip install streamlit plotly scipy pandas
streamlit run streamlit_app.py
```

Opens interactive dashboard at `http://localhost:8501`

---

## Testing Checklist

- [x] **Simulator**: Agents appear on load, click "Start" to begin
- [x] **Controls**: All sliders and buttons responsive
- [x] **Data Import**: CSV/JSON files parse correctly
- [x] **Charts**: Real-time infected/recovered curves draw
- [x] **Statistics**: Live population counts update
- [x] **Dashboard**: Streamlit app loads with demo data
- [x] **Analysis**: Curve fitting and metrics calculate
- [x] **Responsive**: Works on desktop and tablet

---

## Clean Project Structure

```
├── index.html                    # 102 lines - Main simulator UI
├── js/
│   └── simulation.js            # 789 lines - Agent-based engine + UI logic
├── css/
│   └── style.css                # 400+ lines - Responsive design system
├── streamlit_app.py             # Interactive analysis dashboard
├── requirements.txt             # Python dependencies
├── README.md                    # This file
├── .github/workflows/deploy.yml # GitHub Actions auto-deploy
├── .streamlit/config.toml       # Streamlit configuration
└── .gitignore                   # Version control setup
```

**Total Code**: ~1,400 lines of production-ready code

---

## Highlights

**Frontend Skills**
- Canvas API for real-time 60 FPS visualization
- Vanilla JavaScript (no frameworks) - OOP design patterns
- CSS3 responsive layout with modern glassmorphism
- Event-driven architecture with proper state management

 **Backend Skills**
- Python scientific computing (SciPy, NumPy)
- Interactive Streamlit dashboards
- Statistical analysis: curve fitting, R² metrics, epidemiological models

**Engineering Skills**
- Spatial optimization: O(1) neighbor lookup with grid indexing
- GitHub Actions CI/CD automation
- Clean code: comprehensive comments, modular architecture
- Data processing: CSV/JSON parsing and export

 **Full-Stack Integration**
- Frontend runs on GitHub Pages
- Dashboard on Streamlit Cloud
- Both deploy automatically on git push
- Zero configuration required

---
## 📜 License
Copyright © 2026 Sameeha. All rights reserved.

This project is proprietary software. Unauthorized copying, modification, distribution, or use of this code, in whole or in part, for any purpose (commercial or non-commercial) is strictly prohibited without the prior written permission of the author.

For permission requests, please contact: sameeharaza07@gmail.com





