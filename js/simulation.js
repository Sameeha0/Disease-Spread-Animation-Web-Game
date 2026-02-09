/**
 * Disease Spread Simulation Engine
 * 
 * Agent-based epidemiological model with spatial optimization.
 * Demonstrates:
 * - Object-oriented design (Agent, Simulation classes)
 * - Spatial grid optimization for O(1) neighbor lookup
 * - Canvas API for real-time visualization
 * - Reactive UI with parameter binding
 */

(function() {
  'use strict';

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Generate random number in range [min, max)
   */
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  /**
   * Clamp value to [a, b]
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ============================================================================
  // AGENT CLASS - Represents individual person in simulation
  // ============================================================================

  class Agent {
    constructor(id, x, y, params) {
      this.id = id;
      this.x = x;
      this.y = y;
      this.r = 4; // radius for rendering
      
      // Movement
      this.vx = rand(-1, 1);
      this.vy = rand(-1, 1);
      this.trail = [];
      
      // Disease state: 'healthy', 'infected', 'asymptomatic', 'recovered', 'vaccinated'
      this.state = 'healthy';
      this.infectedTime = 0;
      this.incubation = 0;
      this.recoveryTime = params.recoveryTime;
      this.superSpreader = false;
    }

    /**
     * Update position with periodic boundary conditions
     */
    move(dt, speed, width, height) {
      // Apply velocity
      this.x += this.vx * dt * 50 * speed;
      this.y += this.vy * dt * 50 * speed;

      // Bounce off edges
      if (this.x < 0) { this.x = 0; this.vx *= -1; }
      if (this.y < 0) { this.y = 0; this.vy *= -1; }
      if (this.x > width) { this.x = width; this.vx *= -1; }
      if (this.y > height) { this.y = height; this.vy *= -1; }

      // Add random walk component
      this.vx += rand(-0.02, 0.02);
      this.vy += rand(-0.02, 0.02);

      // Normalize velocity
      const mag = Math.hypot(this.vx, this.vy) || 1;
      this.vx /= mag;
      this.vy /= mag;

      // Track positions for trail visualization
      this.trail.push([this.x, this.y]);
      if (this.trail.length > 8) this.trail.shift();
    }

    /**
     * Transition to infected state
     */
    infect(params, asymptomatic = false) {
      if (this.state === 'healthy') {
        this.state = asymptomatic ? 'asymptomatic' : 'infected';
        this.infectedTime = 0;
        this.recoveryTime = params.recoveryTime;
        this.incubation = params.incubation;
      }
    }

    /**
     * Update infection progression
     */
    update(dt) {
      if (this.state === 'infected' || this.state === 'asymptomatic') {
        this.infectedTime += dt;
        if (this.infectedTime >= this.recoveryTime) {
          this.state = 'recovered';
        }
      }
    }
  }

  // ============================================================================
  // SIMULATION CLASS - Main engine
  // ============================================================================

  class Simulation {
    constructor(canvas, chartCanvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.chartCanvas = chartCanvas;
      this.chartCtx = chartCanvas.getContext('2d');

      this.agents = [];
      this.params = {
        population: 120,
        initialInfected: 3,
        speed: 1,
        radius: 14,
        baseProb: 0.45,
        recoveryTime: 12,
        incubation: 0,
        vaccinated: 0
      };

      // Timeseries data for analysis
      this.running = false;
      this.last = 0;
      this.time = 0;
      this.sampleTimer = 0;
      this.timeseries = [];

      // Spatial grid for O(1) neighbor lookup
      this.grid = {
        cellSize: 50,
        cols: 0,
        rows: 0,
        cells: []
      };

      // Mouse tracking for tooltips
      this.mouse = { x: 0, y: 0, hover: null };

      // FPS counter
      this.fps = 0;
      this.frameCount = 0;
      this.fpsTimer = 0;

      window.addEventListener('resize', () => this.resize());
      this.resize();
    }

    /**
     * Initialize simulation with new parameters
     */
    init(params) {
      Object.assign(this.params, params);
      this.agents = [];
      this.time = 0;
      this.timeseries = [];

      // Create agents
      for (let i = 0; i < this.params.population; i++) {
        const x = rand(10, this.canvas.width - 10);
        const y = rand(10, this.canvas.height - 10);
        const agent = new Agent(i, x, y, this.params);

        // Assign vaccinated
        if (Math.random() < this.params.vaccinated / 100) {
          agent.state = 'vaccinated';
        }

        this.agents.push(agent);
      }

      // Seed initial infections
      let seeded = 0;
      let attempts = 0;
      while (seeded < this.params.initialInfected && attempts < this.agents.length * 5) {
        const idx = Math.floor(rand(0, this.agents.length));
        const agent = this.agents[idx];
        if (agent.state === 'healthy') {
          agent.infect(this.params);
          seeded++;
        }
        attempts++;
      }

      this.updateGrid();
    }

    /**
     * Handle window resize - recalculate canvas dimensions
     */
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();

      this.canvas.width = Math.max(200, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(200, Math.floor((window.innerHeight - 200) * dpr));
      this.canvas.style.width = '100%';
      this.canvas.style.height = '60vh';

      const crect = this.chartCanvas.getBoundingClientRect();
      this.chartCanvas.width = crect.width * dpr;
      this.chartCanvas.height = crect.height * dpr;

      // Adjust grid based on infection radius
      this.grid.cellSize = Math.max(24, this.params.radius * 2);
      this.grid.cols = Math.ceil(this.canvas.width / this.grid.cellSize);
      this.grid.rows = Math.ceil(this.canvas.height / this.grid.cellSize);

      this.updateGrid();
      this.render();
    }

    /**
     * Rebuild spatial grid - O(n)
     */
    updateGrid() {
      const cols = this.grid.cols;
      const rows = this.grid.rows;
      const cells = new Array(cols * rows);

      for (let i = 0; i < cells.length; i++) {
        cells[i] = [];
      }

      // Assign agents to grid cells
      for (const agent of this.agents) {
        const cx = clamp(Math.floor(agent.x / this.grid.cellSize), 0, cols - 1);
        const cy = clamp(Math.floor(agent.y / this.grid.cellSize), 0, rows - 1);
        cells[cx + cy * cols].push(agent);
      }

      this.grid.cells = cells;
    }

    /**
     * Get neighboring agents within ±1 cells (9 cells total)
     * O(1) lookup + small constant
     */
    neighbors(agent) {
      const cs = this.grid.cellSize;
      const cols = this.grid.cols;
      const rows = this.grid.rows;

      const cx = clamp(Math.floor(agent.x / cs), 0, cols - 1);
      const cy = clamp(Math.floor(agent.y / cs), 0, rows - 1);

      const out = [];
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;

          const cell = this.grid.cells[nx + ny * cols];
          for (const other of cell) {
            if (other !== agent) out.push(other);
          }
        }
      }
      return out;
    }

    /**
     * Simulation step: movement → infection → recovery
     */
    step(dt) {
      const p = this.params;
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Phase 1: Movement
      for (const agent of this.agents) {
        agent.move(dt, p.speed, w, h);
      }
      this.updateGrid();

      // Phase 2: Infection spread
      const infRadius = p.radius;
      for (const agent of this.agents) {
        if (agent.state !== 'infected' && agent.state !== 'asymptomatic') continue;

        const nearby = this.neighbors(agent);
        for (const target of nearby) {
          if (target.state !== 'healthy') continue;

          const dx = agent.x - target.x;
          const dy = agent.y - target.y;
          const dist = Math.hypot(dx, dy);

          if (dist > infRadius) continue;

          // Probability decreases with distance (linear falloff)
          const base = p.baseProb * (1 - dist / infRadius);
          const multiplier = agent.superSpreader ? 2 : 1;
          const prob = base * multiplier;

          if (Math.random() < prob) {
            target.infect(p);
          }
        }
      }

      // Phase 3: Recovery
      for (const agent of this.agents) {
        agent.update(dt);
      }

      // Record sample periodically
      this.sampleTimer += dt;
      if (this.sampleTimer >= 0.5) {
        this.sampleTimer = 0;
        this.recordSample();
      }
    }

    /**
     * Record population counts at current time
     */
    recordSample() {
      const counts = {
        healthy: 0,
        infected: 0,
        recovered: 0,
        vaccinated: 0,
        asymptomatic: 0
      };

      for (const agent of this.agents) {
        counts[agent.state] = (counts[agent.state] || 0) + 1;
      }

      const sample = {
        t: Math.round(this.time),
        ...counts
      };

      this.timeseries.push(sample);
    }

    /**
     * Main animation loop - called via requestAnimationFrame
     */
    run = (now) => {
      if (!this.running) return;

      if (!this.last) this.last = now;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;

      this.time += dt;
      this.step(dt);
      this.render();

      // FPS calculation
      this.frameCount++;
      this.fpsTimer += dt;
      if (this.fpsTimer > 0.5) {
        this.fps = Math.round(this.frameCount / this.fpsTimer);
        this.frameCount = 0;
        this.fpsTimer = 0;
      }

      requestAnimationFrame(this.run);
    };

    /**
     * Start simulation
     */
    start() {
      if (!this.running) {
        this.running = true;
        this.last = 0;
        requestAnimationFrame(this.run);
      }
    }

    /**
     * Pause simulation
     */
    pause() {
      this.running = false;
      this.last = 0;
    }

    /**
     * Render agents and trails to canvas
     */
    render() {
      const ctx = this.ctx;
      const cw = this.canvas.width;
      const ch = this.canvas.height;

      ctx.clearRect(0, 0, cw, ch);

      // Draw trails
      for (const agent of this.agents) {
        if (agent.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(agent.trail[0][0], agent.trail[0][1]);
          for (let i = 1; i < agent.trail.length; i++) {
            ctx.lineTo(agent.trail[i][0], agent.trail[i][1]);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.03)';
          ctx.stroke();
        }
      }

      // Draw agents
      for (const agent of this.agents) {
        let color = '#76c893'; // healthy (green)
        if (agent.state === 'infected') color = '#ff6b6b'; // red
        else if (agent.state === 'recovered') color = '#f6c85f'; // gold
        else if (agent.state === 'vaccinated') color = '#8fb3ff'; // blue
        else if (agent.state === 'asymptomatic') color = 'rgba(80,120,255,0.6)'; // blue transparent

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;
        ctx.arc(agent.x, agent.y, agent.r, 0, Math.PI * 2);
        ctx.fill();

        // Highlight super-spreaders
        if (agent.superSpreader) {
          ctx.strokeStyle = 'rgba(255,200,50,0.9)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Tooltip on hover
      const tooltip = document.getElementById('tooltip');
      if (this.mouse.hover) {
        tooltip.style.display = 'block';
        tooltip.style.left = (this.mouse.x + 12) + 'px';
        tooltip.style.top = (this.mouse.y + 12) + 'px';
        tooltip.innerHTML = `ID: ${this.mouse.hover.id}<br>State: ${this.mouse.hover.state}<br>Infected t: ${this.mouse.hover.infectedTime.toFixed(1)}s`;
      } else {
        tooltip.style.display = 'none';
      }

      this.updateStats();
      this.drawChart();
    }

    /**
     * Update statistics panel
     */
    updateStats() {
      const healthy = this.agents.filter(a => a.state === 'healthy').length;
      const infected = this.agents.filter(a => a.state === 'infected' || a.state === 'asymptomatic').length;
      const recovered = this.agents.filter(a => a.state === 'recovered').length;
      const vaccinated = this.agents.filter(a => a.state === 'vaccinated').length;

      document.getElementById('healthyCount').textContent = healthy;
      document.getElementById('infectedCount').textContent = infected;
      document.getElementById('recoveredCount').textContent = recovered;
      document.getElementById('vaccinatedCount').textContent = vaccinated;
      document.getElementById('timeLabel').textContent = Math.floor(this.time) + 's';
      document.getElementById('fps').textContent = this.fps;
    }

    /**
     * Draw timeseries chart (infected curve)
     */
    drawChart() {
      const ctx = this.chartCtx;
      const c = this.chartCanvas;

      ctx.clearRect(0, 0, c.width, c.height);

      if (this.timeseries.length < 2) return;

      const dpr = window.devicePixelRatio || 1;
      const w = c.width;
      const h = c.height;
      const len = this.timeseries.length;
      const max = Math.max(...this.timeseries.map(s => s.infected + s.recovered + s.vaccinated + s.healthy));

      // Draw infected curve
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,107,107,0.9)';
      ctx.lineWidth = 2 * dpr;
      for (let i = 0; i < len; i++) {
        const x = (i / (len - 1)) * w;
        const y = h - (this.timeseries[i].infected / max) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw recovered curve
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(246,200,95,0.9)';
      ctx.lineWidth = 1.5 * dpr;
      for (let i = 0; i < len; i++) {
        const x = (i / (len - 1)) * w;
        const y = h - (this.timeseries[i].recovered / max) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ============================================================================
  // UI INITIALIZATION
  // ============================================================================

  document.addEventListener('DOMContentLoaded', () => {
    const simCanvas = document.getElementById('simCanvas');
    const chartCanvas = document.getElementById('chart');
    const sim = new Simulation(simCanvas, chartCanvas);

    // Initialize agents on page load
    sim.init(sim.params);

    // Backend API endpoint
    const BACKEND_URL = window.BACKEND_URL ||
      (typeof process !== 'undefined' && process.env.REACT_APP_BACKEND_URL) ||
      'http://localhost:5000';

    // ========================================================================
    // FILE IMPORT - CSV/JSON
    // ========================================================================

    document.getElementById('importBtn').addEventListener('click', async () => {
      const fileEl = document.getElementById('importFile');
      if (!fileEl.files.length) {
        alert('Select a file first');
        return;
      }

      const file = fileEl.files[0];
      try {
        const text = await file.text();
        let data = null;

        if (file.name.endsWith('.json')) {
          data = JSON.parse(text);
          if (!Array.isArray(data)) throw new Error('JSON must be an array');
        } else if (file.name.endsWith('.csv')) {
          const lines = text.trim().split(/\r?\n/).filter(Boolean);
          if (lines.length < 2) throw new Error('CSV must have header and data');

          const header = lines.shift().split(',').map(h => h.trim());
          data = lines.map(line => {
            const cols = line.split(',').map(c => c.trim());
            const obj = {};
            for (let i = 0; i < header.length; i++) {
              obj[header[i]] = Number(cols[i]) || 0;
            }
            return obj;
          });
        } else {
          throw new Error('File must be .csv or .json');
        }

        // Normalize data
        sim.timeseries = data.map(s => ({
          t: Number(s.t) || 0,
          healthy: Number(s.healthy) || 0,
          infected: Number(s.infected) || 0,
          recovered: Number(s.recovered) || 0,
          vaccinated: Number(s.vaccinated) || 0
        }));

        sim.time = sim.timeseries.length ? sim.timeseries[sim.timeseries.length - 1].t : 0;
        sim.drawChart();
        alert('Data loaded: ' + sim.timeseries.length + ' records');
        fileEl.value = '';
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    });

    // ========================================================================
    // STATISTICAL ANALYSIS
    // ========================================================================

    document.getElementById('analyzeBtn').addEventListener('click', async () => {
      if (!sim.timeseries || sim.timeseries.length === 0) {
        alert('No data to analyze');
        return;
      }

      const resultsEl = document.getElementById('analysisResults');
      const textEl = document.getElementById('analysisText');
      textEl.textContent = 'Analyzing...';
      resultsEl.style.display = 'block';

      try {
        const response = await fetch(BACKEND_URL + '/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeseries: sim.timeseries })
        });

        if (!response.ok) {
          throw new Error('Backend error: ' + response.statusText);
        }

        const analysis = await response.json();

        // Format results
        let txt = 'STATISTICAL ANALYSIS\n' + '='.repeat(40) + '\n';
        txt += 'Peak Infected: ' + Math.round(analysis.peak_infected) + '\n';
        txt += 'Peak Time: ' + analysis.peak_time.toFixed(1) + 's\n';
        txt += 'Attack Rate: ' + (analysis.attack_rate * 100).toFixed(1) + '%\n';
        txt += 'Total Duration: ' + analysis.duration.toFixed(1) + 's\n';
        txt += 'Final Recovered: ' + Math.round(analysis.final_recovered) + '\n';
        txt += 'R² (fit quality): ' + analysis.r_squared.toFixed(3) + '\n';

        if (analysis.doubling_time && analysis.doubling_time !== Infinity) {
          txt += 'Doubling Time: ' + analysis.doubling_time.toFixed(2) + 's\n';
        }

        txt += 'Residual Std Dev: ' + analysis.std_residual.toFixed(2) + '\n';
        textEl.textContent = txt;
      } catch (err) {
        textEl.textContent = 'Analysis failed: ' + err.message + '\n(Is backend running?)';
      }
    });

    // ========================================================================
    // UI CONTROLS
    // ========================================================================

    const ui = {
      population: document.getElementById('population'),
      popVal: document.getElementById('popVal'),
      initialInfected: document.getElementById('initialInfected'),
      initVal: document.getElementById('initVal'),
      speed: document.getElementById('speed'),
      speedVal: document.getElementById('speedVal'),
      radius: document.getElementById('radius'),
      radiusVal: document.getElementById('radiusVal'),
      prob: document.getElementById('prob'),
      probVal: document.getElementById('probVal'),
      recovery: document.getElementById('recovery'),
      recVal: document.getElementById('recVal'),
      vaccinated: document.getElementById('vaccinated'),
      vacVal: document.getElementById('vacVal')
    };

    /**
     * Apply UI parameters to simulation
     */
    function applyParams() {
      const params = {
        population: Number(ui.population.value),
        initialInfected: Number(ui.initialInfected.value),
        speed: Number(ui.speed.value),
        radius: Number(ui.radius.value),
        baseProb: Number(ui.prob.value) / 100,
        recoveryTime: Number(ui.recovery.value),
        incubation: 0,
        vaccinated: Number(ui.vaccinated.value)
      };
      sim.params = Object.assign(sim.params, params);
      sim.grid.cellSize = Math.max(24, params.radius * 2);
    }

    // Slider listeners
    ui.population.addEventListener('input', () => {
      ui.popVal.textContent = ui.population.value;
    });

    ui.initialInfected.addEventListener('input', () => {
      ui.initVal.textContent = ui.initialInfected.value;
    });

    ui.speed.addEventListener('input', () => {
      ui.speedVal.textContent = Number(ui.speed.value).toFixed(1);
      applyParams();
    });

    ui.radius.addEventListener('input', () => {
      ui.radiusVal.textContent = ui.radius.value;
      applyParams();
      sim.resize();
    });

    ui.prob.addEventListener('input', () => {
      ui.probVal.textContent = ui.prob.value;
      applyParams();
    });

    ui.recovery.addEventListener('input', () => {
      ui.recVal.textContent = ui.recovery.value;
      applyParams();
    });

    ui.vaccinated.addEventListener('input', () => {
      ui.vacVal.textContent = ui.vaccinated.value;
      applyParams();
    });

    // Control buttons
    document.getElementById('start').addEventListener('click', () => {
      applyParams();
      sim.start();
    });

    document.getElementById('pause').addEventListener('click', () => {
      sim.pause();
    });

    document.getElementById('reset').addEventListener('click', () => {
      sim.pause();
      applyParams();
      sim.init(sim.params);
      sim.render();
    });

    // Preset scenarios
    document.getElementById('presetFast').addEventListener('click', () => {
      ui.population.value = 200;
      ui.popVal.textContent = 200;
      ui.prob.value = 70;
      ui.probVal.textContent = 70;
      ui.speed.value = 1.4;
      ui.speedVal.textContent = '1.4';
      ui.radius.value = 18;
      ui.radiusVal.textContent = 18;
      applyParams();
      sim.init(sim.params);
    });

    document.getElementById('presetVacc').addEventListener('click', () => {
      ui.vaccinated.value = 60;
      ui.vacVal.textContent = 60;
      ui.prob.value = 20;
      ui.probVal.textContent = 20;
      applyParams();
      sim.init(sim.params);
    });

    document.getElementById('presetLow').addEventListener('click', () => {
      ui.prob.value = 10;
      ui.probVal.textContent = 10;
      ui.radius.value = 8;
      ui.radiusVal.textContent = 8;
      applyParams();
      sim.init(sim.params);
    });

    // ====================================================================
    // FILE EXPORT
    // ====================================================================

    /**
     * Trigger browser download
     */
    function download(filename, content) {
      const blob = new Blob([content], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }

    document.getElementById('exportJSON').addEventListener('click', () => {
      download('simulation.json', JSON.stringify(sim.timeseries, null, 2));
    });

    document.getElementById('exportCSV').addEventListener('click', () => {
      if (sim.timeseries.length === 0) {
        alert('No data - run simulation first');
        return;
      }

      const keys = ['t', 'healthy', 'infected', 'recovered', 'vaccinated'];
      const csv = [keys.join(',')]
        .concat(sim.timeseries.map(s => keys.map(k => s[k] || 0).join(',')))
        .join('\n');

      download('simulation.csv', csv);
    });
  });
})();
