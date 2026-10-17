/**
 * Disease Spread Simulation Engine
 *
 * Agent-based epidemiological model with spatial optimization.
 * Demonstrates:
 * - Object-oriented design (Agent, Simulation classes)
 * - Spatial grid optimization for O(1) neighbor lookup
 * - Canvas API for real-time, high-DPI visualization
 * - In-browser epidemic analysis (peak, attack rate, doubling time, R0)
 * - Reactive UI with parameter binding and keyboard shortcuts
 */

(function() {
  'use strict';

  // Colours shared with css/style.css
  const COLORS = {
    healthy: '#76c893',
    infected: '#ff6b6b',
    recovered: '#f6c85f',
    vaccinated: '#8fb3ff'
  };

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
   * Count agents (or one timeseries sample) by state
   */
  function countStates(agents) {
    const counts = { healthy: 0, infected: 0, recovered: 0, vaccinated: 0 };
    for (const agent of agents) counts[agent.state]++;
    return counts;
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

      // Disease state: 'healthy', 'infected', 'recovered', 'vaccinated'
      this.state = 'healthy';
      this.infectedTime = 0;
      this.infectedBy = null;
      this.recoveryTime = params.recoveryTime;
    }

    /**
     * Update position, bouncing off the edges of the world
     */
    move(dt, speed, width, height) {
      this.x += this.vx * dt * 50 * speed;
      this.y += this.vy * dt * 50 * speed;

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
     * Transition to infected state
     */
    infect(params, source = null) {
      if (this.state === 'healthy') {
        this.state = 'infected';
        this.infectedTime = 0;
        this.infectedBy = source;
        this.recoveryTime = params.recoveryTime;
      }
    }

    /**
     * Update infection progression
     */
    update(dt) {
      if (this.state === 'infected') {
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
        recoveryTime: 12,
        vaccinated: 0
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

      // Spatial grid for O(1) neighbor lookup
      this.grid = { cellSize: 50, cols: 0, rows: 0, cells: [] };

      // Mouse tracking for the hover tooltip
      this.mouse = { x: 0, y: 0, hover: null };

      // FPS counter
      this.fps = 0;
      this.frameCount = 0;
      this.fpsTimer = 0;

      this.bindHover();
      window.addEventListener('resize', () => this.resize());
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

      // Seed initial infections
      let seeded = 0;
      let attempts = 0;
      while (seeded < this.params.initialInfected && attempts < this.agents.length * 5) {
        const agent = this.agents[Math.floor(rand(0, this.agents.length))];
        if (agent.state === 'healthy') {
          agent.infect(this.params);
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
     */
    updateGrid() {
      const cs = Math.max(24, this.params.radius * 2);
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
     * Simulation step: movement → infection → recovery
     */
    step(dt) {
      const p = this.params;

      // Phase 1: Movement
      for (const agent of this.agents) {
        agent.move(dt, p.speed, this.width, this.height);
      }
      this.updateGrid();

      // Phase 2: Infection spread
      // baseProb is the chance per contact per 1/60 s, converted to this frame's
      // length so the spread no longer depends on the screen's frame rate
      const frames = dt * 60;
      for (const agent of this.agents) {
        if (agent.state !== 'infected') continue;

        for (const target of this.neighbors(agent)) {
          if (target.state !== 'healthy') continue;

          const dist = Math.hypot(agent.x - target.x, agent.y - target.y);
          if (dist > p.radius) continue;

          // Probability decreases with distance (linear falloff)
          const perFrame = p.baseProb * (1 - dist / p.radius);
          const prob = 1 - Math.pow(1 - perFrame, frames);
          if (Math.random() < prob) {
            target.infect(p, agent.id);
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

      // The outbreak is over when nobody is infected any more
      if (!this.agents.some(a => a.state === 'infected')) {
        this.recordSample();
        this.pause();
        this.setStatus('ended');
        this.render();
        this.onEnd(Simulation.analyze(this.timeseries, this.params.recoveryTime));
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
      ctx.clearRect(0, 0, this.width, this.height);

      // Infection zones around infected people
      ctx.fillStyle = 'rgba(255,107,107,0.06)';
      for (const agent of this.agents) {
        if (agent.state !== 'infected') continue;
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, this.params.radius, 0, Math.PI * 2);
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
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.arc(agent.x, agent.y, agent.r + 4, 0, Math.PI * 2);
      ctx.stroke();

      let detail = '';
      if (agent.state === 'infected') {
        const left = Math.max(0, agent.recoveryTime - agent.infectedTime);
        detail = `<br>Infected for ${agent.infectedTime.toFixed(1)}s, recovers in ${left.toFixed(1)}s`;
        if (agent.infectedBy !== null) detail += `<br>Caught it from person #${agent.infectedBy}`;
      } else if (agent.state === 'recovered' && agent.infectedBy !== null) {
        detail = `<br>Caught it from person #${agent.infectedBy}`;
      }
      tooltip.innerHTML = `Person #${agent.id}<br>State: <b style="color:${COLORS[agent.state]}">${agent.state}</b>${detail}`;
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
      const total = (counts.healthy + counts.infected + counts.recovered + counts.vaccinated) || 1;

      for (const state of ['healthy', 'infected', 'recovered', 'vaccinated']) {
        document.getElementById(state + 'Count').textContent = counts[state];
        document.getElementById(state + 'Bar').style.transform = `scaleX(${counts[state] / total})`;
      }
      document.getElementById('timeLabel').textContent = Math.floor(this.time) + 's';
      document.getElementById('fps').textContent = this.fps;
    }

    /**
     * Draw stacked area chart of all four states over time
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

      const total = Math.max(1, ...series.map(s => s.healthy + s.infected + s.recovered + s.vaccinated));
      const tMax = len ? Math.max(1, series[len - 1].t) : 1;
      const xOf = (t) => padLeft + (t / tMax) * chartW;
      const yOf = (v) => padTop + chartH - (v / total) * chartH;

      // Grid and y-axis labels (share of population)
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

      if (len < 2) {
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('Press Start to draw the epidemic curve', padLeft + chartW / 2, padTop + chartH / 2);
        return;
      }

      // Stacked areas, from the bottom: infected, recovered, vaccinated, healthy
      const layers = ['infected', 'recovered', 'vaccinated', 'healthy'];
      const base = new Array(len).fill(0);
      for (const layer of layers) {
        const top = series.map((s, i) => base[i] + s[layer]);
        ctx.beginPath();
        ctx.moveTo(xOf(series[0].t), yOf(top[0]));
        for (let i = 1; i < len; i++) ctx.lineTo(xOf(series[i].t), yOf(top[i]));
        for (let i = len - 1; i >= 0; i--) ctx.lineTo(xOf(series[i].t), yOf(base[i]));
        ctx.closePath();
        ctx.globalAlpha = layer === 'healthy' ? 0.35 : 0.8;
        ctx.fillStyle = COLORS[layer];
        ctx.fill();
        ctx.globalAlpha = 1;
        for (let i = 0; i < len; i++) base[i] = top[i];
      }

      // Peak marker on the infected curve
      if (this.peak.infected > 0 && this.status !== 'imported') {
        const x = xOf(this.peak.t);
        ctx.setLineDash([3, 3]);
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

      // Time axis: 5 evenly spaced, distinct labels
      ctx.fillStyle = '#64748b';
      for (let i = 0; i <= 4; i++) {
        const t = (tMax / 4) * i;
        // first and last labels align to the edges so they are never cut off
        ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
        ctx.fillText(Math.round(t) + 's', xOf(t), padTop + chartH + 14);
      }
    }

    /**
     * Epidemic metrics from a timeseries (works for live and imported data)
     *
     * - Attack rate: share of people who could catch it (not vaccinated) who did
     * - Doubling time and growth rate: log-linear fit to the early growth phase
     * - R0 estimate: 1 + r × D (SIR approximation, D = recovery time)
     */
    static analyze(series, recoveryTime) {
      if (!series || series.length < 2) return null;

      const first = series[0];
      const last = series[series.length - 1];
      const population = first.healthy + first.infected + first.recovered + first.vaccinated;
      const susceptible = Math.max(1, population - first.vaccinated);

      let peak = first;
      for (const s of series) if (s.infected > peak.infected) peak = s;

      const everInfected = last.infected + last.recovered;
      const ongoing = last.infected > 0;

      // Early growth: from the start until infections first reach half the peak
      const growth = [];
      for (const s of series) {
        if (s.infected > 0) growth.push(s);
        if (s.infected >= peak.infected / 2) break;
      }

      let growthRate = null;
      let fitR2 = null;
      if (growth.length >= 3) {
        const fit = linearFit(growth.map(s => s.t), growth.map(s => Math.log(s.infected)));
        if (fit.slope > 0) {
          growthRate = fit.slope;
          fitR2 = fit.r2;
        }
      }

      const r0 = growthRate !== null && recoveryTime ? 1 + growthRate * recoveryTime : null;

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
        herdImmunity: r0 && r0 > 1 ? 1 - 1 / r0 : null
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
      vacVal: document.getElementById('vacVal'),
      start: document.getElementById('start'),
      pause: document.getElementById('pause'),
      status: document.getElementById('statusPill'),
      endBanner: document.getElementById('endBanner'),
      chartSource: document.getElementById('chartSource')
    };

    // ========================================================================
    // NOTICES (non-blocking replacement for alert)
    // ========================================================================

    let noticeTimer = null;
    function notify(text, type = 'info') {
      const el = document.getElementById('notice');
      el.textContent = text;
      el.dataset.type = type;
      el.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { el.hidden = true; }, 3200);
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
      ui.chartSource.textContent = status === 'imported' ? ui.chartSource.textContent : 'Live simulation';
    };

    sim.onEnd = (a) => {
      ui.endBanner.innerHTML = `<strong>Outbreak over after ${Math.round(a.duration)}s.</strong> ` +
        `Peak of ${a.peakInfected} infected at ${Math.round(a.peakTime)}s; ` +
        `${Math.round(a.attackRate * 100)}% of people who could catch it did.`;
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
      ui.popVal.textContent = ui.population.value;
      ui.initVal.textContent = ui.initialInfected.value;
      ui.speedVal.textContent = Number(ui.speed.value).toFixed(1);
      ui.radiusVal.textContent = ui.radius.value;
      ui.probVal.textContent = ui.prob.value;
      ui.recVal.textContent = ui.recovery.value;
      ui.vacVal.textContent = ui.vaccinated.value;
      document.querySelectorAll('input[type="range"]').forEach(paintSlider);
    }

    /**
     * Apply UI parameters to simulation
     */
    function applyParams() {
      Object.assign(sim.params, {
        population: Number(ui.population.value),
        initialInfected: Number(ui.initialInfected.value),
        speed: Number(ui.speed.value),
        radius: Number(ui.radius.value),
        baseProb: Number(ui.prob.value) / 100,
        recoveryTime: Number(ui.recovery.value),
        vaccinated: Number(ui.vaccinated.value)
      });
    }

    function resetSim() {
      applyParams();
      sim.init(sim.params);
      hideAnalysis();
    }

    function clearPresetHighlight() {
      document.querySelectorAll('.preset').forEach(b => { b.dataset.active = 'false'; });
    }

    // Population settings rebuild the population straight away unless a run is in progress
    for (const key of ['population', 'initialInfected', 'vaccinated']) {
      ui[key].addEventListener('input', () => {
        syncLabels();
        clearPresetHighlight();
        if (sim.status !== 'running') resetSim();
      });
    }

    // Transmission settings change live
    for (const key of ['speed', 'radius', 'prob', 'recovery']) {
      ui[key].addEventListener('input', () => {
        syncLabels();
        clearPresetHighlight();
        applyParams();
        if (!sim.running) sim.render();
      });
    }

    // ========================================================================
    // PRESET SCENARIOS (each sets every parameter, so they never mix)
    // ========================================================================

    const PRESETS = {
      presetBase: { population: 120, initialInfected: 3, speed: 1, radius: 14, prob: 45, recovery: 12, vaccinated: 0 },
      presetFast: { population: 200, initialInfected: 3, speed: 1.4, radius: 18, prob: 70, recovery: 12, vaccinated: 0 },
      presetVacc: { population: 120, initialInfected: 3, speed: 1, radius: 14, prob: 20, recovery: 12, vaccinated: 60 },
      presetLow: { population: 120, initialInfected: 3, speed: 0.6, radius: 8, prob: 10, recovery: 12, vaccinated: 0 }
    };

    for (const [id, values] of Object.entries(PRESETS)) {
      document.getElementById(id).addEventListener('click', (e) => {
        for (const [key, value] of Object.entries(values)) ui[key].value = value;
        syncLabels();
        clearPresetHighlight();
        e.currentTarget.dataset.active = 'true';
        resetSim();
      });
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
    document.getElementById('reset').addEventListener('click', resetSim);

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
    // FILE IMPORT - CSV/JSON
    // ========================================================================

    const fileEl = document.getElementById('importFile');
    fileEl.addEventListener('change', () => {
      document.getElementById('importLabel').textContent = fileEl.files.length
        ? fileEl.files[0].name
        : 'Choose a CSV or JSON file to import';
    });

    document.getElementById('importBtn').addEventListener('click', async () => {
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

        const series = data.map(s => ({
          t: Number(s.t) || 0,
          healthy: Number(s.healthy) || 0,
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
        document.getElementById('importLabel').textContent = 'Choose a CSV or JSON file to import';
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
      const el = document.getElementById('analysisResults');
      const pct = (x) => (x * 100).toFixed(0) + '%';
      el.innerHTML =
        metric('Peak infected', a.peakInfected, `${pct(a.peakShare)} of people, at ${a.peakTime.toFixed(0)}s`) +
        metric('Attack rate', pct(a.attackRate), `${a.everInfected} people infected`) +
        metric('Doubling time', a.doublingTime ? a.doublingTime.toFixed(1) + 's' : '—',
          a.fitR2 !== null ? `early growth fit R² = ${a.fitR2.toFixed(2)}` : 'not enough early growth') +
        metric('Estimated R₀', a.r0 ? a.r0.toFixed(2) : '—',
          a.herdImmunity ? `herd immunity at about ${pct(a.herdImmunity)}` : 'needs a growing outbreak') +
        metric('Duration', a.duration.toFixed(0) + 's', a.ongoing ? 'outbreak still going' : 'until the last recovery', true);
      el.hidden = false;
      document.getElementById('analysisEmpty').hidden = true;
    }

    function hideAnalysis() {
      document.getElementById('analysisResults').hidden = true;
      document.getElementById('analysisEmpty').hidden = false;
    }

    document.getElementById('analyzeBtn').addEventListener('click', () => {
      const a = Simulation.analyze(sim.timeseries, sim.params.recoveryTime);
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

    document.getElementById('exportJSON').addEventListener('click', () => {
      if (!hasData()) return;
      download('simulation.json', JSON.stringify(sim.timeseries, null, 2), 'application/json');
    });

    document.getElementById('exportCSV').addEventListener('click', () => {
      if (!hasData()) return;
      const keys = ['t', 'healthy', 'infected', 'recovered', 'vaccinated'];
      const csv = [keys.join(',')]
        .concat(sim.timeseries.map(s => keys.map(k => s[k] || 0).join(',')))
        .join('\n');
      download('simulation.csv', csv, 'text/csv');
    });

    // First draw
    syncLabels();
    sim.init(sim.params);
  });
})();
