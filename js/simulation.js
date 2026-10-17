/**
 * Disease Spread Simulation Engine
 *
 * Agent-based SEIR epidemiological model with spatial optimization.
 * Demonstrates:
 * - Object-oriented design (Agent, Simulation classes)
 * - SEIR disease stages: healthy (S) -> exposed (E) -> infected (I) -> recovered (R)
 * - Interventions: quarantine, social distancing, super-spreaders
 * - Spatial grid optimization for O(1) neighbor lookup
 * - Canvas API for real-time, high-DPI visualization
 * - In-browser epidemic analysis (peak, attack rate, doubling time, R0, spreading)
 * - Run comparison and shareable scenario links
 */

(function() {
  'use strict';

  // Colours shared with css/style.css
  const COLORS = {
    healthy: '#76c893',
    exposed: '#ff9f43',
    infected: '#ff6b6b',
    recovered: '#f6c85f',
    vaccinated: '#8fb3ff'
  };

  const STATES = ['healthy', 'exposed', 'infected', 'recovered', 'vaccinated'];

  // Line colours for saved runs on the chart
  const PIN_COLORS = ['#e6eef8', '#c084fc', '#22d3ee'];
  const MAX_PINS = 3;

  // Super-spreaders infect at twice the chance over a larger radius
  const SUPER_PROB = 2;
  const SUPER_RADIUS = 1.5;

  const STATUS_TEXT = {
    ready: 'Ready',
    running: 'Running',
    paused: 'Paused',
    ended: 'Outbreak over',
    imported: 'Imported data'
  };

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
   * Clamp value to [min, max]
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Count agents by state
   */
  function countStates(agents) {
    const counts = { healthy: 0, exposed: 0, infected: 0, recovered: 0, vaccinated: 0 };
    for (const agent of agents) counts[agent.state]++;
    return counts;
  }

  /**
   * Total population in one timeseries sample
   */
  function sampleTotal(s) {
    return s.healthy + (s.exposed || 0) + s.infected + s.recovered + s.vaccinated;
  }

  /**
   * Least-squares line through (x, y) points; returns slope and R²
   */
  function linearFit(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    const slope = sxx ? sxy / sxx : 0;
    const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
    return { slope, r2 };
  }

  /**
   * Escape text before putting it into HTML
   */
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============================================================================
  // AGENT CLASS - Represents individual person in simulation
  // ============================================================================

  class Agent {
    constructor(id, x, y, params) {
      this.id = id;
      this.x = x;
      this.y = y;
      this.r = 4; // radius for rendering (CSS pixels)

      // Movement
      this.vx = rand(-1, 1);
      this.vy = rand(-1, 1);
      this.trail = [];

      // Fixed random draws: a person distances / is a super-spreader when their draw
      // is below the slider value, so the sliders can change live without a reset
      this.distanceDraw = Math.random();
      this.superDraw = Math.random();

      // Disease state: 'healthy', 'exposed', 'infected', 'recovered', 'vaccinated'
      this.state = 'healthy';
      this.stageTime = 0;       // time spent in the current exposed/infected stage
      this.recoveryTime = params.recoveryTime;
      this.infectedBy = null;
      this.secondary = 0;       // how many people this person infected
      this.quarantined = false;
    }

    /**
     * True if this person spreads more than others
     */
    isSuperSpreader(params) {
      return this.superDraw < params.superSpreaders / 100;
    }

    /**
     * True if this person does not move (distancing or in quarantine)
     */
    isStill(params) {
      return this.quarantined || this.distanceDraw < params.distancing / 100;
    }

    /**
     * Update position, bouncing off the edges of the world
     */
    move(dt, params, width, height) {
      if (this.isStill(params)) {
        this.trail = [];
        return;
      }

      this.x += this.vx * dt * 50 * params.speed;
      this.y += this.vy * dt * 50 * params.speed;

      if (this.x < 0) { this.x = 0; this.vx *= -1; }
      if (this.y < 0) { this.y = 0; this.vy *= -1; }
      if (this.x > width) { this.x = width; this.vx *= -1; }
      if (this.y > height) { this.y = height; this.vy *= -1; }

      // Random walk component
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
     * Catch the infection: exposed first (if there is an incubation period), then infected
     */
    infect(params, source = null) {
      if (this.state !== 'healthy') return false;
      this.state = params.incubation > 0 ? 'exposed' : 'infected';
      this.stageTime = 0;
      this.infectedBy = source;
      this.recoveryTime = params.recoveryTime;
      return true;
    }

    /**
     * Update disease progression: exposed -> infected -> recovered
     */
    update(dt, params) {
      if (this.state === 'exposed') {
        this.stageTime += dt;
        if (this.stageTime >= params.incubation) {
          this.state = 'infected';
          this.stageTime = 0;
        }
      } else if (this.state === 'infected') {
        this.stageTime += dt;
        if (params.quarantine && !this.quarantined && this.stageTime >= params.quarantineDelay) {
          this.quarantined = true;
        }
        if (this.stageTime >= this.recoveryTime) {
          this.state = 'recovered';
          this.quarantined = false;
        }
      }
    }
  }

  // ============================================================================
  // SIMULATION CLASS - Main engine
  // ============================================================================

  class Simulation {
    constructor(canvas, chartCanvas, stage) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.chartCanvas = chartCanvas;
      this.chartCtx = chartCanvas.getContext('2d');
      this.stage = stage;

      this.agents = [];
      this.params = {
        population: 120,
        initialInfected: 3,
        speed: 1,
        radius: 14,
        baseProb: 0.45,
        incubation: 3,
        recoveryTime: 12,
        vaccinated: 0,
        quarantine: false,
        quarantineDelay: 2,
        distancing: 0,
        superSpreaders: 0
      };

      // World size in CSS pixels; the canvas is scaled for high-DPI screens,
      // so the infection radius means the same thing on every device
      this.width = 0;
      this.height = 0;

      this.status = 'ready';
      this.onStatus = () => {};
      this.onEnd = () => {};

      this.running = false;
      this.last = 0;
      this.time = 0;
      this.sampleTimer = 0;
      this.timeseries = [];
      this.peak = { infected: 0, t: 0 };

      // Runs saved for comparison: { label, color, series, metrics }
      this.pinned = [];

      // Spatial grid for O(1) neighbor lookup
      this.grid = { cellSize: 50, cols: 0, rows: 0, cells: [] };

      // Mouse tracking for the hover tooltip
      this.mouse = { x: 0, y: 0, hover: null };

      // FPS counter
      this.fps = 0;
      this.frameCount = 0;
      this.fpsTimer = 0;

      this.bindHover();
      // Redraw whenever the stage or the chart changes size (window resize or layout changes)
      if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => this.resize());
        observer.observe(stage);
        observer.observe(chartCanvas.parentElement);
      } else {
        window.addEventListener('resize', () => this.resize());
      }
      this.resize();
    }

    /**
     * Change the run status and notify the UI
     */
    setStatus(status) {
      this.status = status;
      this.onStatus(status);
    }

    /**
     * Initialize simulation with new parameters
     */
    init(params) {
      Object.assign(this.params, params);
      this.pause();
      this.agents = [];
      this.time = 0;
      this.sampleTimer = 0;
      this.timeseries = [];
      this.peak = { infected: 0, t: 0 };

      for (let i = 0; i < this.params.population; i++) {
        const x = rand(10, Math.max(11, this.width - 10));
        const y = rand(10, Math.max(11, this.height - 10));
        const agent = new Agent(i, x, y, this.params);
        if (Math.random() < this.params.vaccinated / 100) {
          agent.state = 'vaccinated';
        }
        this.agents.push(agent);
      }

      // Seed initial infections (already infectious, so the outbreak can start)
      let seeded = 0;
      let attempts = 0;
      while (seeded < this.params.initialInfected && attempts < this.agents.length * 5) {
        const agent = this.agents[Math.floor(rand(0, this.agents.length))];
        if (agent.state === 'healthy') {
          agent.state = 'infected';
          agent.stageTime = 0;
          seeded++;
        }
        attempts++;
      }

      this.updateGrid();
      this.recordSample();
      this.setStatus('ready');
      this.render();
    }

    /**
     * Handle window resize - match canvas pixels to its displayed size
     */
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const oldW = this.width;
      const oldH = this.height;

      // clientWidth/clientHeight exclude the stage border, so canvas pixels match exactly
      this.width = Math.max(200, this.stage.clientWidth);
      this.height = Math.max(200, this.stage.clientHeight);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Keep people in the same relative position when the stage changes size
      if (oldW && oldH) {
        for (const agent of this.agents) {
          agent.x = clamp(agent.x * (this.width / oldW), 0, this.width);
          agent.y = clamp(agent.y * (this.height / oldH), 0, this.height);
          agent.trail = [];
        }
      }

      const crect = this.chartCanvas.getBoundingClientRect();
      this.chartW = Math.max(100, crect.width);
      this.chartH = Math.max(80, crect.height);
      this.chartCanvas.width = Math.round(this.chartW * dpr);
      this.chartCanvas.height = Math.round(this.chartH * dpr);
      this.chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.updateGrid();
      this.render();
    }

    /**
     * Rebuild spatial grid - O(n)
     * Cells are as large as the biggest infection radius (a super-spreader's)
     */
    updateGrid() {
      const cs = Math.max(24, this.params.radius * SUPER_RADIUS);
      const cols = Math.max(1, Math.ceil(this.width / cs));
      const rows = Math.max(1, Math.ceil(this.height / cs));
      const cells = new Array(cols * rows);
      for (let i = 0; i < cells.length; i++) cells[i] = [];

      for (const agent of this.agents) {
        const cx = clamp(Math.floor(agent.x / cs), 0, cols - 1);
        const cy = clamp(Math.floor(agent.y / cs), 0, rows - 1);
        cells[cx + cy * cols].push(agent);
      }

      this.grid = { cellSize: cs, cols, rows, cells };
    }

    /**
     * Get neighboring agents within ±1 cells (9 cells total)
     * O(1) lookup + small constant
     */
    neighbors(agent) {
      const { cellSize: cs, cols, rows, cells } = this.grid;
      const cx = clamp(Math.floor(agent.x / cs), 0, cols - 1);
      const cy = clamp(Math.floor(agent.y / cs), 0, rows - 1);

      const out = [];
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          for (const other of cells[nx + ny * cols]) {
            if (other !== agent) out.push(other);
          }
        }
      }
      return out;
    }

    /**
     * Infection radius of one person (larger for super-spreaders)
     */
    radiusOf(agent) {
      return this.params.radius * (agent.isSuperSpreader(this.params) ? SUPER_RADIUS : 1);
    }

    /**
     * Simulation step: movement -> infection -> disease progression
     */
    step(dt) {
      const p = this.params;

      // Phase 1: Movement
      for (const agent of this.agents) {
        agent.move(dt, p, this.width, this.height);
      }
      this.updateGrid();

      // Phase 2: Infection spread (only infectious, non-isolated people spread)
      // baseProb is the chance per contact per 1/60 s, converted to this frame's
      // length so the spread does not depend on the screen's frame rate
      const frames = dt * 60;
      for (const agent of this.agents) {
        if (agent.state !== 'infected' || agent.quarantined) continue;

        const isSuper = agent.isSuperSpreader(p);
        const radius = p.radius * (isSuper ? SUPER_RADIUS : 1);
        const baseProb = Math.min(1, p.baseProb * (isSuper ? SUPER_PROB : 1));

        for (const target of this.neighbors(agent)) {
          if (target.state !== 'healthy') continue;

          const dist = Math.hypot(agent.x - target.x, agent.y - target.y);
          if (dist > radius) continue;

          // Probability decreases with distance (linear falloff)
          const perFrame = baseProb * (1 - dist / radius);
          const prob = 1 - Math.pow(1 - perFrame, frames);
          if (Math.random() < prob && target.infect(p, agent.id)) {
            agent.secondary++;
          }
        }
      }

      // Phase 3: Disease progression
      for (const agent of this.agents) {
        agent.update(dt, p);
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
      const counts = countStates(this.agents);
      this.timeseries.push({ t: Math.round(this.time * 10) / 10, ...counts });
      if (counts.infected > this.peak.infected) {
        this.peak = { infected: counts.infected, t: this.time };
      }
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

      // The outbreak is over when nobody is exposed or infected any more
      if (!this.agents.some(a => a.state === 'infected' || a.state === 'exposed')) {
        this.recordSample();
        this.pause();
        this.setStatus('ended');
        this.render();
        this.onEnd(this.analyzeCurrent());
        return;
      }

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
        this.setStatus('running');
        requestAnimationFrame(this.run);
      }
    }

    /**
     * Pause simulation
     */
    pause() {
      if (this.running) this.setStatus('paused');
      this.running = false;
      this.last = 0;
      this.fps = 0;
    }

    /**
     * Load an imported timeseries for charting and analysis
     */
    loadSeries(series) {
      this.pause();
      this.timeseries = series;
      this.time = series.length ? series[series.length - 1].t : 0;
      this.setStatus('imported');
      this.render();
    }

    /**
     * Metrics for the current data (live agents give extra spreading statistics)
     */
    analyzeCurrent() {
      const agents = this.status === 'imported' ? null : this.agents;
      return Simulation.analyze(this.timeseries, this.params, agents);
    }

    /**
     * Save the current run so it stays on the chart for comparison
     */
    pin(label) {
      if (this.timeseries.length < 2) return false;
      if (this.pinned.length >= MAX_PINS) this.pinned.shift();
      const used = this.pinned.map(r => r.color);
      const color = PIN_COLORS.find(c => !used.includes(c)) || PIN_COLORS[0];
      this.pinned.push({
        label,
        color,
        series: this.timeseries.map(s => ({ ...s })),
        metrics: this.analyzeCurrent()
      });
      this.drawChart();
      return true;
    }

    /**
     * Track the mouse so hovering shows details about one person
     */
    bindHover() {
      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;

        let best = null;
        let bestDist = 12;
        for (const agent of this.agents) {
          const d = Math.hypot(agent.x - this.mouse.x, agent.y - this.mouse.y);
          if (d < bestDist) {
            best = agent;
            bestDist = d;
          }
        }
        this.mouse.hover = best;
        if (!this.running) this.render();
      });

      this.canvas.addEventListener('mouseleave', () => {
        this.mouse.hover = null;
        if (!this.running) this.render();
      });
    }

    /**
     * Render agents and trails to canvas
     */
    render() {
      const ctx = this.ctx;
      const p = this.params;
      ctx.clearRect(0, 0, this.width, this.height);

      // Infection zones around people who can currently spread
      ctx.fillStyle = 'rgba(255,107,107,0.06)';
      for (const agent of this.agents) {
        if (agent.state !== 'infected' || agent.quarantined) continue;
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, this.radiusOf(agent), 0, Math.PI * 2);
        ctx.fill();
      }

      // Trails
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      for (const agent of this.agents) {
        if (agent.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(agent.trail[0][0], agent.trail[0][1]);
          for (let i = 1; i < agent.trail.length; i++) {
            ctx.lineTo(agent.trail[i][0], agent.trail[i][1]);
          }
          ctx.stroke();
        }
      }

      // Agents
      for (const agent of this.agents) {
        ctx.beginPath();
        ctx.fillStyle = COLORS[agent.state];
        ctx.arc(agent.x, agent.y, agent.r, 0, Math.PI * 2);
        ctx.fill();

        // Isolated people: square outline
        if (agent.quarantined) {
          ctx.strokeStyle = COLORS.infected;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(agent.x - 7, agent.y - 7, 14, 14);
        }
        // Super-spreaders: gold ring
        if (agent.isSuperSpreader(p)) {
          ctx.beginPath();
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 1.5;
          ctx.arc(agent.x, agent.y, agent.r + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      this.renderHover();
      this.updateStats();
      this.drawChart();
    }

    /**
     * Highlight the hovered person and position the tooltip
     */
    renderHover() {
      const tooltip = document.getElementById('tooltip');
      const agent = this.mouse.hover;
      if (!agent) {
        tooltip.hidden = true;
        return;
      }

      const ctx = this.ctx;
      const p = this.params;
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.arc(agent.x, agent.y, agent.r + 5, 0, Math.PI * 2);
      ctx.stroke();

      const lines = [`Person #${agent.id}`, `State: <b style="color:${COLORS[agent.state]}">${agent.state}</b>`];
      if (agent.state === 'exposed') {
        lines.push(`Infectious in ${Math.max(0, p.incubation - agent.stageTime).toFixed(1)}s`);
      }
      if (agent.state === 'infected') {
        lines.push(`Infectious for ${agent.stageTime.toFixed(1)}s, recovers in ${Math.max(0, agent.recoveryTime - agent.stageTime).toFixed(1)}s`);
        if (agent.quarantined) lines.push('Isolated: cannot infect anyone');
      }
      if (agent.infectedBy !== null) lines.push(`Caught it from person #${agent.infectedBy}`);
      if (agent.secondary > 0) lines.push(`Infected ${agent.secondary} ${agent.secondary === 1 ? 'person' : 'people'}`);
      if (agent.isSuperSpreader(p)) lines.push('Super-spreader');
      if (agent.distanceDraw < p.distancing / 100) lines.push('Social distancing');
      tooltip.innerHTML = lines.join('<br>');
      tooltip.hidden = false;

      // Keep the tooltip inside the stage
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      let left = this.mouse.x + 14;
      let top = this.mouse.y + 14;
      if (left + tw > this.width - 8) left = this.mouse.x - tw - 14;
      if (top + th > this.height - 8) top = this.mouse.y - th - 14;
      tooltip.style.left = Math.max(8, left) + 'px';
      tooltip.style.top = Math.max(8, top) + 'px';
    }

    /**
     * Update statistics panel
     */
    updateStats() {
      const counts = this.status === 'imported' && this.timeseries.length
        ? this.timeseries[this.timeseries.length - 1]
        : countStates(this.agents);
      const total = sampleTotal(counts) || 1;

      for (const state of STATES) {
        const value = counts[state] || 0;
        document.getElementById(state + 'Count').textContent = value;
        document.getElementById(state + 'Bar').style.transform = `scaleX(${value / total})`;
      }
      document.getElementById('quarCount').textContent = this.agents.filter(a => a.quarantined).length;
      document.getElementById('timeLabel').textContent = Math.floor(this.time) + 's';
      document.getElementById('fps').textContent = this.fps;
    }

    /**
     * Draw stacked area chart of all states, plus saved runs as dashed lines
     */
    drawChart() {
      const ctx = this.chartCtx;
      const w = this.chartW;
      const h = this.chartH;
      ctx.clearRect(0, 0, w, h);

      const series = this.timeseries;
      const len = series.length;
      const padLeft = 38;
      const padRight = 8;
      const padTop = 8;
      const padBottom = 24;
      const chartW = w - padLeft - padRight;
      const chartH = h - padTop - padBottom;

      const allSeries = [series, ...this.pinned.map(r => r.series)];
      const total = Math.max(1, ...allSeries.flat().map(sampleTotal));
      const tMax = Math.max(1, ...allSeries.filter(s => s.length).map(s => s[s.length - 1].t));
      const xOf = (t) => padLeft + (t / tMax) * chartW;
      const yOf = (v) => padTop + chartH - (v / total) * chartH;

      // Grid and y-axis labels
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const y = padTop + chartH - (i / 4) * chartH;
        ctx.strokeStyle = 'rgba(148,170,210,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round((total / 4) * i), padLeft - 8, y);
      }

      if (len < 2 && !this.pinned.length) {
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('Press Start to draw the epidemic curve', padLeft + chartW / 2, padTop + chartH / 2);
        return;
      }

      // Stacked areas, from the bottom: infected, exposed, recovered, vaccinated, healthy
      if (len >= 2) {
        const layers = ['infected', 'exposed', 'recovered', 'vaccinated', 'healthy'];
        const base = new Array(len).fill(0);
        for (const layer of layers) {
          const top = series.map((s, i) => base[i] + (s[layer] || 0));
          ctx.beginPath();
          ctx.moveTo(xOf(series[0].t), yOf(top[0]));
          for (let i = 1; i < len; i++) ctx.lineTo(xOf(series[i].t), yOf(top[i]));
          for (let i = len - 1; i >= 0; i--) ctx.lineTo(xOf(series[i].t), yOf(base[i]));
          ctx.closePath();
          ctx.globalAlpha = layer === 'healthy' ? 0.3 : 0.8;
          ctx.fillStyle = COLORS[layer];
          ctx.fill();
          ctx.globalAlpha = 1;
          for (let i = 0; i < len; i++) base[i] = top[i];
        }
      }

      // Saved runs: active cases (exposed + infected) as dashed lines
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const run of this.pinned) {
        ctx.strokeStyle = run.color;
        ctx.beginPath();
        run.series.forEach((s, i) => {
          const x = xOf(s.t);
          const y = yOf(s.infected + (s.exposed || 0));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Current run's active cases as a solid line on top, so it can be compared
      if (this.pinned.length && len >= 2) {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        series.forEach((s, i) => {
          const x = xOf(s.t);
          const y = yOf(s.infected + (s.exposed || 0));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      // Peak marker
      if (this.peak.infected > 0 && this.status !== 'imported' && len >= 2) {
        const x = xOf(this.peak.t);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e6eef8';
        ctx.textAlign = x > padLeft + chartW - 80 ? 'right' : 'left';
        ctx.fillText(`Peak ${this.peak.infected}`, x + (ctx.textAlign === 'left' ? 6 : -6), padTop + 10);
      }

      // Time axis: 5 evenly spaced labels; the edge labels align inward so they are never cut off
      ctx.fillStyle = '#64748b';
      for (let i = 0; i <= 4; i++) {
        const t = (tMax / 4) * i;
        ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
        ctx.fillText(Math.round(t) + 's', xOf(t), padTop + chartH + 14);
      }
    }

    /**
     * Epidemic metrics from a timeseries (works for live and imported data)
     *
     * - Attack rate: share of people who could catch it (not vaccinated) who did
     * - Growth rate r and doubling time: log-linear fit to early growth of active cases
     * - R0 estimate for SEIR: (1 + r*D)(1 + r*L), D = infectious period, L = incubation
     *   (with no incubation this is the SIR formula 1 + r*D)
     * - With live agents: observed average spread and the share caused by the top 20%
     */
    static analyze(series, params, agents = null) {
      if (!series || series.length < 2) return null;

      const first = series[0];
      const last = series[series.length - 1];
      const population = sampleTotal(first);
      const susceptible = Math.max(1, population - first.vaccinated);
      const active = (s) => s.infected + (s.exposed || 0);

      let peak = first;
      for (const s of series) if (s.infected > peak.infected) peak = s;
      let activePeak = 0;
      for (const s of series) activePeak = Math.max(activePeak, active(s));

      const everInfected = active(last) + last.recovered;
      const ongoing = active(last) > 0;

      // Early growth: from the start until active cases first reach half their peak
      const growth = [];
      for (const s of series) {
        if (active(s) > 0) growth.push(s);
        if (active(s) >= activePeak / 2) break;
      }

      let growthRate = null;
      let fitR2 = null;
      if (growth.length >= 3) {
        const fit = linearFit(growth.map(s => s.t), growth.map(s => Math.log(active(s))));
        if (fit.slope > 0) {
          growthRate = fit.slope;
          fitR2 = fit.r2;
        }
      }

      const D = params.recoveryTime;
      const L = params.incubation || 0;
      const r0 = growthRate !== null && D ? (1 + growthRate * D) * (1 + growthRate * L) : null;

      // Who did the spreading (only possible with live agents)
      let observedR = null;
      let topShare = null;
      if (agents) {
        const finished = agents.filter(a => a.state === 'recovered' && a.infectedBy !== null);
        if (finished.length) {
          observedR = finished.reduce((sum, a) => sum + a.secondary, 0) / finished.length;
        }
        const spreaders = agents.filter(a => a.state === 'recovered' || a.state === 'infected' || a.state === 'exposed')
          .map(a => a.secondary)
          .sort((a, b) => b - a);
        const totalSecondary = spreaders.reduce((a, b) => a + b, 0);
        if (totalSecondary > 0) {
          const top = spreaders.slice(0, Math.max(1, Math.ceil(spreaders.length * 0.2)));
          topShare = top.reduce((a, b) => a + b, 0) / totalSecondary;
        }
      }

      return {
        population,
        peakInfected: peak.infected,
        peakTime: peak.t,
        peakShare: peak.infected / population,
        attackRate: everInfected / susceptible,
        everInfected,
        duration: last.t,
        ongoing,
        doublingTime: growthRate ? Math.LN2 / growthRate : null,
        growthRate,
        fitR2,
        r0,
        herdImmunity: r0 && r0 > 1 ? 1 - 1 / r0 : null,
        observedR,
        topShare
      };
    }
  }

  // ============================================================================
  // UI INITIALIZATION
  // ============================================================================

  document.addEventListener('DOMContentLoaded', () => {
    const sim = new Simulation(
      document.getElementById('simCanvas'),
      document.getElementById('chart'),
      document.getElementById('stage')
    );

    // Slider id -> label id, URL key, and how to turn the slider value into a parameter
    const SLIDERS = {
      population: { label: 'popVal', key: 'pop', param: 'population', reset: true },
      initialInfected: { label: 'initVal', key: 'init', param: 'initialInfected', reset: true },
      vaccinated: { label: 'vacVal', key: 'vac', param: 'vaccinated', reset: true },
      prob: { label: 'probVal', key: 'prob', param: 'baseProb', scale: 0.01 },
      radius: { label: 'radiusVal', key: 'radius', param: 'radius' },
      incubation: { label: 'incVal', key: 'inc', param: 'incubation' },
      recovery: { label: 'recVal', key: 'rec', param: 'recoveryTime' },
      speed: { label: 'speedVal', key: 'speed', param: 'speed', decimals: 1 },
      quarDelay: { label: 'quarVal', key: 'qd', param: 'quarantineDelay', decimals: 1 },
      distancing: { label: 'distVal', key: 'dist', param: 'distancing' },
      superSpreaders: { label: 'ssVal', key: 'ss', param: 'superSpreaders' }
    };

    const el = (id) => document.getElementById(id);
    const quarantine = el('quarantine');
    const ui = {
      start: el('start'),
      pause: el('pause'),
      status: el('statusPill'),
      endBanner: el('endBanner'),
      chartSource: el('chartSource')
    };

    // ========================================================================
    // NOTICES (non-blocking replacement for alert)
    // ========================================================================

    let noticeTimer = null;
    function notify(text, type = 'info') {
      const box = el('notice');
      box.textContent = text;
      box.dataset.type = type;
      box.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { box.hidden = true; }, 3200);
    }

    // ========================================================================
    // STATUS AND END-OF-OUTBREAK SUMMARY
    // ========================================================================

    sim.onStatus = (status) => {
      ui.status.dataset.status = status;
      ui.status.textContent = STATUS_TEXT[status];
      ui.start.disabled = status === 'running';
      ui.pause.disabled = status !== 'running';
      if (status === 'running' || status === 'ready') ui.endBanner.hidden = true;
      if (status !== 'imported') ui.chartSource.textContent = 'Live simulation';
    };

    sim.onEnd = (a) => {
      let text = `<strong>Outbreak over after ${Math.round(a.duration)}s.</strong> ` +
        `Peak of ${a.peakInfected} infected at ${Math.round(a.peakTime)}s; ` +
        `${Math.round(a.attackRate * 100)}% of people who could catch it did.`;
      if (a.topShare !== null) text += ` The top 20% of spreaders caused ${Math.round(a.topShare * 100)}% of infections.`;
      ui.endBanner.innerHTML = text;
      ui.endBanner.hidden = false;
      showAnalysis(a);
    };

    // ========================================================================
    // PARAMETERS
    // ========================================================================

    /**
     * Show slider progress as a filled track
     */
    function paintSlider(slider) {
      const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--fill', pct + '%');
    }

    function syncLabels() {
      for (const [id, cfg] of Object.entries(SLIDERS)) {
        const value = Number(el(id).value);
        el(cfg.label).textContent = cfg.decimals ? value.toFixed(cfg.decimals) : value;
        paintSlider(el(id));
      }
      el('quarDelayField').classList.toggle('is-disabled', !quarantine.checked);
      el('quarDelay').disabled = !quarantine.checked;
    }

    /**
     * Apply UI parameters to simulation
     */
    function applyParams() {
      for (const [id, cfg] of Object.entries(SLIDERS)) {
        sim.params[cfg.param] = Number(el(id).value) * (cfg.scale || 1);
      }
      sim.params.quarantine = quarantine.checked;
      updateUrl();
    }

    function resetSim() {
      applyParams();
      sim.init(sim.params);
      hideAnalysis();
    }

    function clearPresetHighlight() {
      document.querySelectorAll('.preset').forEach(b => { b.dataset.active = 'false'; });
    }

    for (const [id, cfg] of Object.entries(SLIDERS)) {
      el(id).addEventListener('input', () => {
        syncLabels();
        clearPresetHighlight();
        // Population settings rebuild the population straight away unless a run is in progress
        if (cfg.reset && sim.status !== 'running') {
          resetSim();
        } else {
          applyParams();
          if (!sim.running) sim.render();
        }
      });
    }

    quarantine.addEventListener('change', () => {
      syncLabels();
      clearPresetHighlight();
      applyParams();
      if (!sim.running) sim.render();
    });

    // ========================================================================
    // SHAREABLE LINKS (every setting lives in the page address)
    // ========================================================================

    function currentQuery() {
      const q = new URLSearchParams();
      for (const [id, cfg] of Object.entries(SLIDERS)) q.set(cfg.key, el(id).value);
      q.set('q', quarantine.checked ? '1' : '0');
      return q.toString();
    }

    function updateUrl() {
      const url = location.pathname + '?' + currentQuery();
      if (url !== location.pathname + location.search) history.replaceState(null, '', url);
    }

    /**
     * Read settings from the address bar; returns true if any were found
     */
    function loadFromUrl() {
      const q = new URLSearchParams(location.search);
      let found = false;
      for (const [id, cfg] of Object.entries(SLIDERS)) {
        if (!q.has(cfg.key)) continue;
        const slider = el(id);
        const value = Number(q.get(cfg.key));
        if (Number.isFinite(value)) {
          slider.value = clamp(value, Number(slider.min), Number(slider.max));
          found = true;
        }
      }
      if (q.has('q')) {
        quarantine.checked = q.get('q') === '1';
        found = true;
      }
      return found;
    }

    el('copyLink').addEventListener('click', async () => {
      updateUrl();
      try {
        await navigator.clipboard.writeText(location.href);
        notify('Link copied. Anyone who opens it gets this exact scenario.');
      } catch (err) {
        notify('Could not copy automatically. Copy the address from your browser bar.', 'error');
      }
    });

    // ========================================================================
    // PRESET SCENARIOS (each sets every parameter, so they never mix)
    // ========================================================================

    const BASE = {
      population: 120, initialInfected: 3, vaccinated: 0, prob: 45, radius: 14, incubation: 3,
      recovery: 12, speed: 1, quarantine: false, quarDelay: 2, distancing: 0, superSpreaders: 0
    };
    const PRESETS = {
      presetBase: { ...BASE },
      presetFast: { ...BASE, population: 200, prob: 70, radius: 18, speed: 1.4 },
      presetVacc: { ...BASE, vaccinated: 60, prob: 20 },
      presetLow: { ...BASE, distancing: 60 },
      presetQuar: { ...BASE, quarantine: true, quarDelay: 2 },
      presetSuper: { ...BASE, prob: 25, superSpreaders: 10 }
    };
    const PRESET_NAMES = {
      presetBase: 'Baseline', presetFast: 'Fast spread', presetVacc: 'Vaccinated',
      presetLow: 'Distancing', presetQuar: 'Quarantine', presetSuper: 'Super-spreaders'
    };

    for (const [id, values] of Object.entries(PRESETS)) {
      el(id).addEventListener('click', (e) => {
        for (const [key, value] of Object.entries(values)) {
          if (key === 'quarantine') quarantine.checked = value;
          else el(key).value = value;
        }
        syncLabels();
        clearPresetHighlight();
        e.currentTarget.dataset.active = 'true';
        resetSim();
      });
    }

    function scenarioName() {
      const active = document.querySelector('.preset[data-active="true"]');
      return active ? PRESET_NAMES[active.id] : 'Custom';
    }

    // ========================================================================
    // CONTROL BUTTONS AND KEYBOARD SHORTCUTS
    // ========================================================================

    function startSim() {
      // Starting again after an outbreak (or imported data) begins a fresh run
      if (sim.status === 'ended' || sim.status === 'imported') resetSim();
      applyParams();
      sim.start();
    }

    ui.start.addEventListener('click', startSim);
    ui.pause.addEventListener('click', () => sim.pause());
    el('reset').addEventListener('click', resetSim);

    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        sim.running ? sim.pause() : startSim();
      } else if (e.key === 'r' || e.key === 'R') {
        resetSim();
      }
    });

    // ========================================================================
    // RUN COMPARISON
    // ========================================================================

    function renderPinnedLegend() {
      const legend = el('pinnedLegend');
      if (!sim.pinned.length) {
        legend.hidden = true;
        return;
      }
      legend.innerHTML = '<span class="current" style="color:#ffffff"><i></i>Current run (active cases)</span>' +
        sim.pinned.map(r => `<span style="color:${r.color}"><i></i>${escapeHtml(r.label)}</span>`).join('');
      legend.hidden = false;
    }

    function fmt(value, kind) {
      if (value === null || value === undefined) return '—';
      if (kind === 'pct') return Math.round(value * 100) + '%';
      if (kind === 's') return value.toFixed(value < 10 ? 1 : 0) + 's';
      if (kind === 'n') return value.toFixed(2);
      return String(Math.round(value));
    }

    function renderComparison() {
      const card = el('compareCard');
      if (!sim.pinned.length) {
        card.hidden = true;
        return;
      }

      const current = sim.analyzeCurrent();
      const columns = sim.pinned.map(r => ({ label: r.label, color: r.color, sub: 'saved', m: r.metrics }));
      if (current) columns.push({ label: 'Current run', color: '#ffffff', sub: STATUS_TEXT[sim.status].toLowerCase(), m: current });

      // [label, metric key, format, which direction is better]
      const rows = [
        ['Peak infected', 'peakInfected', 'count', 'low'],
        ['Peak time', 'peakTime', 's', null],
        ['Attack rate', 'attackRate', 'pct', 'low'],
        ['Doubling time', 'doublingTime', 's', 'high'],
        ['Estimated R₀', 'r0', 'n', 'low'],
        ['Avg. people infected per case', 'observedR', 'n', 'low'],
        ['Duration', 'duration', 's', null]
      ];

      let html = '<thead><tr><th>Metric</th>' +
        columns.map(c => `<th style="color:${c.color}">${escapeHtml(c.label)}<span>${escapeHtml(c.sub)}</span></th>`).join('') +
        '</tr></thead><tbody>';
      for (const [name, key, kind, better] of rows) {
        const values = columns.map(c => (c.m ? c.m[key] : null));
        const valid = values.filter(v => v !== null && v !== undefined);
        const best = better && valid.length > 1 ? (better === 'low' ? Math.min(...valid) : Math.max(...valid)) : null;
        html += `<tr><td>${name}</td>` +
          values.map(v => `<td class="${best !== null && v === best ? 'best' : ''}">${fmt(v, kind)}</td>`).join('') +
          '</tr>';
      }
      el('compareTable').innerHTML = html + '</tbody>';
      card.hidden = false;
    }

    el('pinRun').addEventListener('click', () => {
      if (sim.status === 'running') sim.pause();
      const label = `Run ${sim.pinned.length + 1}: ${scenarioName()}`;
      if (!sim.pin(label)) {
        notify('Run the simulation first, then save it for comparison.', 'error');
        return;
      }
      renderPinnedLegend();
      renderComparison();
      notify(`Saved "${label}". Change a setting and run again to compare.`);
    });

    el('clearPins').addEventListener('click', () => {
      sim.pinned = [];
      sim.drawChart();
      renderPinnedLegend();
      renderComparison();
    });

    // ========================================================================
    // FILE IMPORT - CSV/JSON
    // ========================================================================

    const fileEl = el('importFile');
    fileEl.addEventListener('change', () => {
      el('importLabel').textContent = fileEl.files.length
        ? fileEl.files[0].name
        : 'Choose a CSV or JSON file to import';
    });

    el('importBtn').addEventListener('click', async () => {
      if (!fileEl.files.length) {
        notify('Choose a file first', 'error');
        return;
      }

      const file = fileEl.files[0];
      try {
        const text = await file.text();
        let data = null;

        if (file.name.toLowerCase().endsWith('.json')) {
          data = JSON.parse(text);
          if (!Array.isArray(data)) throw new Error('JSON must be an array');
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          const lines = text.trim().split(/\r?\n/).filter(Boolean);
          if (lines.length < 2) throw new Error('CSV must have a header and data rows');

          const header = lines.shift().split(',').map(h => h.trim());
          data = lines.map(line => {
            const cols = line.split(',').map(c => c.trim());
            const obj = {};
            for (let i = 0; i < header.length; i++) obj[header[i]] = Number(cols[i]) || 0;
            return obj;
          });
        } else {
          throw new Error('File must be .csv or .json');
        }

        // "exposed" is optional so older SIR files still load
        const series = data.map(s => ({
          t: Number(s.t) || 0,
          healthy: Number(s.healthy) || 0,
          exposed: Number(s.exposed) || 0,
          infected: Number(s.infected) || 0,
          recovered: Number(s.recovered) || 0,
          vaccinated: Number(s.vaccinated) || 0
        }));
        if (series.length < 2) throw new Error('Need at least two rows');

        ui.chartSource.textContent = 'Imported: ' + file.name;
        sim.loadSeries(series);
        hideAnalysis();
        notify(`Loaded ${series.length} records from ${file.name}`);
        fileEl.value = '';
        el('importLabel').textContent = 'Choose a CSV or JSON file to import';
      } catch (err) {
        notify('Import failed: ' + err.message, 'error');
      }
    });

    // ========================================================================
    // STATISTICAL ANALYSIS (runs in the browser, no backend needed)
    // ========================================================================

    function metric(label, value, note = '', wide = false) {
      return `<div class="metric${wide ? ' wide' : ''}"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
    }

    function showAnalysis(a) {
      const pct = (x) => (x * 100).toFixed(0) + '%';
      let html =
        metric('Peak infected', a.peakInfected, `${pct(a.peakShare)} of people, at ${a.peakTime.toFixed(0)}s`) +
        metric('Attack rate', pct(a.attackRate), `${a.everInfected} people infected`) +
        metric('Doubling time', a.doublingTime ? a.doublingTime.toFixed(1) + 's' : '—',
          a.fitR2 !== null ? `early growth fit R² = ${a.fitR2.toFixed(2)}` : 'not enough early growth') +
        metric('Estimated R₀', a.r0 ? a.r0.toFixed(2) : '—',
          a.herdImmunity ? `herd immunity at about ${pct(a.herdImmunity)}` : 'needs a growing outbreak');
      if (a.observedR !== null || a.topShare !== null) {
        html +=
          metric('Avg. infected per case', a.observedR !== null ? a.observedR.toFixed(2) : '—', 'counted from finished cases') +
          metric('Top 20% of spreaders', a.topShare !== null ? pct(a.topShare) : '—', 'share of all infections they caused');
      }
      html += metric('Duration', a.duration.toFixed(0) + 's', a.ongoing ? 'outbreak still going' : 'until the last recovery', true);

      el('analysisResults').innerHTML = html;
      el('analysisResults').hidden = false;
      el('analysisEmpty').hidden = true;
      renderComparison();
    }

    function hideAnalysis() {
      el('analysisResults').hidden = true;
      el('analysisEmpty').hidden = false;
      renderComparison();
    }

    el('analyzeBtn').addEventListener('click', () => {
      const a = sim.analyzeCurrent();
      if (!a) {
        notify('No data yet. Run the simulation or import a file first.', 'error');
        return;
      }
      showAnalysis(a);
    });

    // ========================================================================
    // FILE EXPORT
    // ========================================================================

    /**
     * Trigger browser download
     */
    function download(filename, content, type) {
      const blob = new Blob([content], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function hasData() {
      if (sim.timeseries.length < 2) {
        notify('No data yet. Run the simulation first.', 'error');
        return false;
      }
      return true;
    }

    el('exportJSON').addEventListener('click', () => {
      if (!hasData()) return;
      download('simulation.json', JSON.stringify(sim.timeseries, null, 2), 'application/json');
    });

    el('exportCSV').addEventListener('click', () => {
      if (!hasData()) return;
      const keys = ['t', ...STATES];
      const csv = [keys.join(',')]
        .concat(sim.timeseries.map(s => keys.map(k => s[k] || 0).join(',')))
        .join('\n');
      download('simulation.csv', csv, 'text/csv');
    });

    // First draw: a shared link restores its scenario
    if (loadFromUrl()) clearPresetHighlight();
    syncLabels();
    applyParams();
    sim.init(sim.params);
  });
})();
