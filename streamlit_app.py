"""
Disease Spread Analysis Dashboard

Streamlit companion to the browser simulator. Upload one or more CSV/JSON files
exported from the simulator (or use the built-in SEIR demo data) to explore the
epidemic curve, early growth, R0 and to compare scenarios side by side.

Same colours and metric definitions as js/simulation.js.
"""

import io
import json

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.integrate import solve_ivp
from scipy.optimize import curve_fit

st.set_page_config(
    page_title="Disease Spread Analysis",
    page_icon="🦠",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ============================================================================
# THEME (matches the simulator)
# ============================================================================

COLORS = {
    "healthy": "#76c893",
    "exposed": "#ff9f43",
    "infected": "#ff6b6b",
    "recovered": "#f6c85f",
    "vaccinated": "#8fb3ff",
}
RUN_COLORS = ["#e6eef8", "#c084fc", "#22d3ee", "#3b82f6", "#76c893"]
STATES = ["healthy", "exposed", "infected", "recovered", "vaccinated"]


def rgba(hex_color, alpha):
    """'#ff6b6b' + 0.8 -> 'rgba(255,107,107,0.8)' (Plotly does not accept 8-digit hex)."""
    h = hex_color.lstrip("#")
    return f"rgba({int(h[0:2], 16)},{int(h[2:4], 16)},{int(h[4:6], 16)},{alpha})"

st.markdown(
    """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
html, body, [class*="css"], .stMarkdown, .stMetric { font-family: 'Inter', system-ui, sans-serif; }
.block-container { padding-top: 2rem; max-width: 1400px; }
[data-testid="stMetric"] {
    background: rgba(13, 21, 36, 0.82);
    border: 1px solid rgba(148, 170, 210, 0.13);
    border-radius: 14px;
    padding: 14px 16px;
}
[data-testid="stMetricLabel"] p { color: #94a3b8; font-size: 13px; }
[data-testid="stMetricValue"] { font-variant-numeric: tabular-nums; }
.subtitle { color: #94a3b8; margin-top: -0.6rem; margin-bottom: 1.2rem; }
.note { color: #64748b; font-size: 13px; }
</style>
""",
    unsafe_allow_html=True,
)


def style_figure(fig, height=420, title=None):
    """Shared Plotly layout: dark, transparent, Inter font, legend on top."""
    fig.update_layout(
        template="plotly_dark",
        height=height,
        title=title,
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, system-ui, sans-serif", color="#e6eef8"),
        margin=dict(l=10, r=10, t=50 if title else 20, b=10),
        # legend under the chart, so it never collides with the title
        legend=dict(orientation="h", yanchor="top", y=-0.18, xanchor="left", x=0),
        hovermode="x unified",
    )
    fig.update_xaxes(gridcolor="rgba(148,170,210,0.12)", zeroline=False, title="Time (s)")
    fig.update_yaxes(gridcolor="rgba(148,170,210,0.12)", zeroline=False)
    return fig


# ============================================================================
# DATA
# ============================================================================


@st.cache_data
def demo_run(beta, incubation, infectious, population=120, infected0=3, t_end=90):
    """Deterministic SEIR model (same stages as the simulator), sampled every 0.5 s."""
    sigma = 1 / incubation if incubation > 0 else None
    gamma = 1 / infectious

    def seir(t, y):
        s, e, i, r = y
        new = beta * s * i / population
        if sigma is None:  # plain SIR
            return [-new, 0, new - gamma * i, gamma * i]
        return [-new, new - sigma * e, sigma * e - gamma * i, gamma * i]

    t = np.arange(0, t_end + 0.5, 0.5)
    sol = solve_ivp(seir, (0, t_end), [population - infected0, 0, infected0, 0], t_eval=t)
    s, e, i, r = np.round(sol.y).astype(int)
    df = pd.DataFrame({"t": t, "healthy": s, "exposed": e, "infected": i, "recovered": r, "vaccinated": 0})
    # keep the total exactly equal to the population after rounding
    df["recovered"] = population - df[["healthy", "exposed", "infected", "vaccinated"]].sum(axis=1)
    return df


def normalize(df):
    """Check columns and fill optional ones, so SIR and SEIR files both work."""
    df = df.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]
    missing = [c for c in ["t", "healthy", "infected", "recovered"] if c not in df.columns]
    if missing:
        raise ValueError(f"missing column(s): {', '.join(missing)}")
    for col in ["exposed", "vaccinated"]:
        if col not in df.columns:
            df[col] = 0
    df = df[["t"] + STATES].apply(pd.to_numeric, errors="coerce").fillna(0)
    return df.sort_values("t").reset_index(drop=True)


def read_upload(file):
    if file.name.lower().endswith(".csv"):
        return pd.read_csv(file)
    return pd.DataFrame(json.load(file))


# ============================================================================
# ANALYSIS (same definitions as the simulator's Analyze button)
# ============================================================================


def analyze(df, infectious, incubation):
    first, last = df.iloc[0], df.iloc[-1]
    population = first[STATES].sum()
    susceptible = max(1, population - first["vaccinated"])
    active = df["infected"] + df["exposed"]

    peak_idx = df["infected"].idxmax()
    ever_infected = active.iloc[-1] + last["recovered"]

    # early growth: from the start until active cases first reach half their peak
    half = np.argmax(active.values >= active.max() / 2)
    growth = df.iloc[: half + 1]
    growth = growth[(growth["infected"] + growth["exposed"]) > 0]

    growth_rate = fit_r2 = None
    if len(growth) >= 3:
        x = growth["t"].values
        y = np.log(growth["infected"].values + growth["exposed"].values)
        slope, intercept = np.polyfit(x, y, 1)
        if slope > 0:
            pred = slope * x + intercept
            ss_res = np.sum((y - pred) ** 2)
            ss_tot = np.sum((y - y.mean()) ** 2)
            growth_rate = slope
            fit_r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    r0 = (1 + growth_rate * infectious) * (1 + growth_rate * incubation) if growth_rate else None

    return {
        "population": int(population),
        "peak_infected": int(df.loc[peak_idx, "infected"]),
        "peak_time": float(df.loc[peak_idx, "t"]),
        "attack_rate": ever_infected / susceptible,
        "ever_infected": int(ever_infected),
        "duration": float(last["t"]),
        "growth_rate": growth_rate,
        "doubling_time": np.log(2) / growth_rate if growth_rate else None,
        "fit_r2": fit_r2,
        "r0": r0,
        "herd_immunity": 1 - 1 / r0 if r0 and r0 > 1 else None,
        "growth_end": float(df.loc[half, "t"]),
    }


def fmt(value, kind="n"):
    if value is None:
        return "—"
    if kind == "pct":
        return f"{value * 100:.0f}%"
    if kind == "s":
        return f"{value:.1f}s"
    if kind == "int":
        return f"{value:.0f}"
    return f"{value:.2f}"


# ============================================================================
# SIDEBAR
# ============================================================================

st.sidebar.header("Data")
uploads = st.sidebar.file_uploader(
    "Upload CSV or JSON (one or more)",
    type=["csv", "json"],
    accept_multiple_files=True,
    help="Columns: t, healthy, infected, recovered, and optionally exposed and vaccinated. "
         "Upload several files to compare scenarios.",
)

runs = {}
for f in uploads or []:
    try:
        runs[f.name.rsplit(".", 1)[0]] = normalize(read_upload(f))
    except Exception as e:  # show the problem but keep the other files
        st.sidebar.error(f"{f.name}: {e}")

use_demo = st.sidebar.toggle("Include demo data", value=not runs,
                             help="Two SEIR runs from the same model: without and with fewer contacts.")
if use_demo:
    runs["Demo: baseline"] = demo_run(beta=0.55, incubation=3, infectious=12)
    runs["Demo: distancing"] = demo_run(beta=0.3, incubation=3, infectious=12)

st.sidebar.header("Disease timing")
st.sidebar.caption("Used to turn the growth rate into an R₀ estimate. Match the simulator settings.")
infectious = st.sidebar.number_input("Infectious period (s)", 1.0, 120.0, 12.0, 1.0)
incubation = st.sidebar.number_input("Incubation / exposed period (s)", 0.0, 60.0, 3.0, 1.0,
                                     help="Set to 0 for SIR data without an exposed stage.")

st.sidebar.header("Display")
log_scale = st.sidebar.toggle("Log scale on growth charts", value=False)

# ============================================================================
# HEADER
# ============================================================================

st.title("🦠 Disease Spread Analysis")
st.markdown(
    '<p class="subtitle">Explore epidemic curves exported from the '
    '<a href="https://sameeha0.github.io/Disease-Spread-Animation-Web-Game/" target="_blank">browser simulator</a>, '
    "estimate R₀ and compare scenarios.</p>",
    unsafe_allow_html=True,
)

if not runs:
    st.info("Upload a CSV or JSON file in the sidebar, or turn on the demo data.")
    st.markdown(
        """
**Expected format** (exported by the simulator):

```
t,healthy,exposed,infected,recovered,vaccinated
0,117,0,3,0,0
0.5,116,1,3,0,0
```
`exposed` and `vaccinated` are optional, so older SIR files also work.
"""
    )
    st.stop()

names = list(runs)
selected = st.selectbox("Run to analyse", names) if len(names) > 1 else names[0]
df = runs[selected]
m = analyze(df, infectious, incubation)

# ============================================================================
# TABS
# ============================================================================

tab_overview, tab_growth, tab_daily, tab_compare, tab_export = st.tabs(
    ["Overview", "Growth & R₀", "New cases", "Compare runs", "Export"]
)

# ---------- Overview ----------
with tab_overview:
    c = st.columns(6)
    c[0].metric("Peak infected", fmt(m["peak_infected"], "int"), help="Most people infectious at the same time")
    c[1].metric("Peak time", fmt(m["peak_time"], "s"))
    c[2].metric("Attack rate", fmt(m["attack_rate"], "pct"),
                help="Share of people who could catch it (not vaccinated) who did")
    c[3].metric("Doubling time", fmt(m["doubling_time"], "s"), help="From the early exponential growth")
    c[4].metric("Estimated R₀", fmt(m["r0"]), help="(1 + r·D)(1 + r·L) for SEIR")
    c[5].metric("Duration", fmt(m["duration"], "s"))

    fig = go.Figure()
    # stacked from the bottom, same order as the simulator chart
    for state in ["infected", "exposed", "recovered", "vaccinated", "healthy"]:
        if state in ("exposed", "vaccinated") and df[state].sum() == 0:
            continue
        fig.add_trace(go.Scatter(
            x=df["t"], y=df[state], name=state.capitalize(), stackgroup="one",
            mode="lines", line=dict(width=0.5, color=COLORS[state]),
            fillcolor=rgba(COLORS[state], 0.33 if state == "healthy" else 0.8),
            hovertemplate="%{y:.0f}",
        ))
    fig.add_vline(x=m["peak_time"], line_dash="dot", line_color="rgba(255,255,255,0.5)",
                  annotation_text=f"Peak {m['peak_infected']}", annotation_position="top right")
    st.plotly_chart(style_figure(fig, 440, "Population by state over time"))
    st.markdown(
        f'<p class="note">{m["ever_infected"]} of {m["population"]} people were infected. '
        + (f'Herd immunity threshold for this R₀: about {m["herd_immunity"] * 100:.0f}%.' if m["herd_immunity"] else "")
        + "</p>",
        unsafe_allow_html=True,
    )

# ---------- Growth & R0 ----------
with tab_growth:
    st.subheader("Early exponential growth")
    st.markdown(
        '<p class="note">A straight line on a log scale means exponential growth. The slope r gives the doubling '
        "time ln 2 / r, and R₀ ≈ (1 + r·D)(1 + r·L) with D the infectious period and L the incubation period.</p>",
        unsafe_allow_html=True,
    )
    active = df["infected"] + df["exposed"]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=df["t"], y=active, name="Active cases (E + I)", mode="lines",
                             line=dict(color=COLORS["infected"], width=2.5)))
    if m["growth_rate"]:
        early = df[df["t"] <= m["growth_end"]]
        a0 = active[df["t"] <= m["growth_end"]]
        intercept = np.mean(np.log(a0[a0 > 0])) - m["growth_rate"] * early.loc[a0 > 0, "t"].mean()
        fit_t = np.linspace(0, m["growth_end"], 50)
        fig.add_trace(go.Scatter(x=fit_t, y=np.exp(intercept + m["growth_rate"] * fit_t),
                                 name=f"Exponential fit (r = {m['growth_rate']:.3f}/s)",
                                 line=dict(color="#e6eef8", dash="dash", width=2)))
    if log_scale:
        fig.update_yaxes(type="log")
    st.plotly_chart(style_figure(fig, 400))

    c = st.columns(4)
    c[0].metric("Growth rate r", f"{m['growth_rate']:.3f} /s" if m["growth_rate"] else "—")
    c[1].metric("Fit R²", fmt(m["fit_r2"]))
    c[2].metric("Doubling time", fmt(m["doubling_time"], "s"))
    c[3].metric("Estimated R₀", fmt(m["r0"]))

    st.divider()
    st.subheader("Logistic fit of cumulative infections")
    cumulative = (df["exposed"] + df["infected"] + df["recovered"]).values
    try:
        def logistic(t, k, rate, mid):
            return k / (1 + np.exp(-rate * (t - mid)))

        popt, _ = curve_fit(logistic, df["t"].values, cumulative,
                            p0=[cumulative.max(), 0.2, df["t"].iloc[np.argmax(cumulative >= cumulative.max() / 2)]],
                            maxfev=20000)
        pred = logistic(df["t"].values, *popt)
        ss_tot = np.sum((cumulative - cumulative.mean()) ** 2)
        r2 = 1 - np.sum((cumulative - pred) ** 2) / ss_tot if ss_tot > 0 else 0

        fig = go.Figure()
        fig.add_trace(go.Scatter(x=df["t"], y=cumulative, name="Ever infected", mode="lines",
                                 line=dict(color=COLORS["recovered"], width=2.5)))
        fig.add_trace(go.Scatter(x=df["t"], y=pred, name="Logistic fit",
                                 line=dict(color="#e6eef8", dash="dash", width=2)))
        st.plotly_chart(style_figure(fig, 360))
        c = st.columns(3)
        c[0].metric("Final size (fitted)", f"{popt[0]:.0f}")
        c[1].metric("Midpoint", f"{popt[2]:.1f}s", help="When half of all eventual infections had happened")
        c[2].metric("Fit R²", f"{r2:.3f}")
    except Exception as e:
        st.warning(f"Could not fit a logistic curve to this data ({e}).")

# ---------- New cases ----------
with tab_daily:
    st.subheader("New infections and recoveries per sample")
    new_cases = (-df["healthy"].diff()).clip(lower=0).fillna(0)
    new_recoveries = df["recovered"].diff().clip(lower=0).fillna(0)
    fig = go.Figure()
    fig.add_trace(go.Bar(x=df["t"], y=new_cases, name="New infections", marker_color=COLORS["infected"]))
    fig.add_trace(go.Bar(x=df["t"], y=-new_recoveries, name="Recoveries (shown below zero)",
                         marker_color=COLORS["recovered"]))
    fig.update_layout(barmode="relative")
    st.plotly_chart(style_figure(fig, 420))
    st.markdown('<p class="note">New infections are the drop in healthy people between samples.</p>',
                unsafe_allow_html=True)

# ---------- Compare runs ----------
with tab_compare:
    if len(runs) < 2:
        st.info("Upload two or more files (for example the same scenario with and without quarantine) "
                "or turn on the demo data to compare runs.")
    else:
        fig = go.Figure()
        for i, (name, run) in enumerate(runs.items()):
            fig.add_trace(go.Scatter(x=run["t"], y=run["infected"] + run["exposed"], name=name, mode="lines",
                                     line=dict(color=RUN_COLORS[i % len(RUN_COLORS)], width=2.5)))
        fig.update_yaxes(title="Active cases (E + I)")
        st.plotly_chart(style_figure(fig, 420, "Active cases by run"))

        rows = []
        for name, run in runs.items():
            r = analyze(run, infectious, incubation)
            rows.append({
                "Run": name,
                "Peak infected": r["peak_infected"],
                "Peak time (s)": round(r["peak_time"], 1),
                "Attack rate": f"{r['attack_rate'] * 100:.0f}%",
                "Doubling time (s)": round(r["doubling_time"], 1) if r["doubling_time"] else None,
                "Estimated R₀": round(r["r0"], 2) if r["r0"] else None,
                "Duration (s)": round(r["duration"], 1),
            })
        st.dataframe(pd.DataFrame(rows), hide_index=True)

# ---------- Export ----------
with tab_export:
    st.subheader("Download")
    c = st.columns(3)
    c[0].download_button("Data as CSV", df.to_csv(index=False), file_name=f"{selected}.csv", mime="text/csv")
    c[1].download_button("Data as JSON", df.to_json(orient="records"), file_name=f"{selected}.json",
                         mime="application/json")
    summary = pd.DataFrame({
        "Metric": ["Population", "Peak infected", "Peak time (s)", "Attack rate", "Ever infected",
                   "Doubling time (s)", "Estimated R0", "Herd immunity threshold", "Duration (s)"],
        "Value": [str(m["population"]), str(m["peak_infected"]), fmt(m["peak_time"], "s"), fmt(m["attack_rate"], "pct"),
                  str(m["ever_infected"]), fmt(m["doubling_time"], "s"), fmt(m["r0"]), fmt(m["herd_immunity"], "pct"),
                  fmt(m["duration"], "s")],
    })
    buffer = io.StringIO()
    summary.to_csv(buffer, index=False)
    c[2].download_button("Summary as CSV", buffer.getvalue(), file_name=f"{selected}_summary.csv", mime="text/csv")
    st.dataframe(summary, hide_index=True)
