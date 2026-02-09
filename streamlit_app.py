import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from scipy.optimize import curve_fit
from scipy.stats import linregress
import io

st.set_page_config(
    page_title="Disease Spread Analysis",
    page_icon="🦠",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    .metric-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 20px;
        border-radius: 10px;
        color: white;
        text-align: center;
        margin: 10px 0;
    }
    .metric-value {
        font-size: 32px;
        font-weight: bold;
        margin: 10px 0;
    }
    .metric-label {
        font-size: 14px;
        opacity: 0.9;
    }
</style>
""", unsafe_allow_html=True)

st.title("🦠 Disease Spread Analysis Dashboard")
st.markdown("Upload simulation data and explore advanced statistical analysis")

# Sidebar
st.sidebar.header("📁 Data Upload")

uploaded_file = st.sidebar.file_uploader(
    "Upload CSV or JSON file",
    type=["csv", "json"],
    help="Format: t, healthy, infected, recovered, vaccinated"
)

# Load data
df = None
if uploaded_file:
    try:
        if uploaded_file.name.endswith('.csv'):
            df = pd.read_csv(uploaded_file)
        else:  # JSON
            df = pd.read_json(uploaded_file)
        st.sidebar.success("✅ File loaded successfully")
    except Exception as e:
        st.sidebar.error(f"❌ Error loading file: {e}")

# Demo data option
if st.sidebar.checkbox("Use demo data", value=not uploaded_file):
    if df is None:
        t = np.arange(0, 100, 1)
        # Logistic-like curve
        healthy = 100 / (1 + np.exp((t - 30) / 10)) + np.random.normal(0, 2, len(t))
        infected = 50 * np.exp(-t / 20) + np.random.normal(0, 1, len(t))
        recovered = 100 - healthy - np.abs(infected)
        vaccinated = np.linspace(0, 30, len(t))
        
        df = pd.DataFrame({
            't': t,
            'healthy': np.maximum(healthy, 0),
            'infected': np.maximum(infected, 0),
            'recovered': np.maximum(recovered, 0),
            'vaccinated': np.maximum(vaccinated, 0)
        })
        st.sidebar.info("Using demo epidemic data for visualization")

if df is not None:
    st.sidebar.success(f"📊 {len(df)} data points loaded")
    
    # Data preview
    with st.sidebar.expander("📋 Data Preview"):
        st.dataframe(df.head(10), use_container_width=True)
    
    # Analysis parameters
    st.sidebar.header("⚙️ Parameters")
    log_scale = st.sidebar.checkbox("Log scale for infected", value=False)
    show_vaccination = st.sidebar.checkbox("Show vaccination", value=True)
    
    # ============================================================================
    # MAIN CONTENT
    # ============================================================================
    
    # Tabs
    tab1, tab2, tab3, tab4 = st.tabs(["📈 Timeseries", "📊 Statistics", "🔬 Analysis", "📥 Export"])
    
    # TAB 1: TIMESERIES
    with tab1:
        col1, col2 = st.columns([3, 1])
        
        with col2:
            st.markdown("**Legend:**")
            st.markdown("🟢 Healthy")
            st.markdown("🔴 Infected")
            st.markdown("🔵 Recovered")
            st.markdown("💉 Vaccinated")
        
        with col1:
            fig = go.Figure()
            
            # Add traces
            fig.add_trace(go.Scatter(
                x=df['t'], y=df['healthy'],
                name='Healthy', fill='tozeroy',
                line=dict(color='#2ecc71', width=2),
                hovertemplate='<b>Time:</b> %{x}<br><b>Healthy:</b> %{y:.0f}<extra></extra>'
            ))
            
            fig.add_trace(go.Scatter(
                x=df['t'], y=df['infected'],
                name='Infected', fill='tozeroy',
                line=dict(color='#e74c3c', width=2),
                yaxis='y2',
                hovertemplate='<b>Time:</b> %{x}<br><b>Infected:</b> %{y:.0f}<extra></extra>'
            ))
            
            fig.add_trace(go.Scatter(
                x=df['t'], y=df['recovered'],
                name='Recovered', fill='tozeroy',
                line=dict(color='#3498db', width=2),
                hovertemplate='<b>Time:</b> %{x}<br><b>Recovered:</b> %{y:.0f}<extra></extra>'
            ))
            
            if show_vaccination and 'vaccinated' in df.columns:
                fig.add_trace(go.Scatter(
                    x=df['t'], y=df['vaccinated'],
                    name='Vaccinated',
                    line=dict(color='#f39c12', width=2, dash='dash'),
                    hovertemplate='<b>Time:</b> %{x}<br><b>Vaccinated:</b> %{y:.0f}<extra></extra>'
                ))
            
            fig.update_layout(
                title='Disease Spread Over Time',
                xaxis_title='Time (days)',
                yaxis_title='Healthy / Recovered',
                yaxis2=dict(
                    title='Infected',
                    overlaying='y',
                    side='right'
                ),
                hovermode='x unified',
                template='plotly_dark',
                height=500
            )
            
            if log_scale:
                fig.update_yaxes(type='log', secondary_y=True)
            
            st.plotly_chart(fig, use_container_width=True)
    
    # TAB 2: STATISTICS
    with tab2:
        col1, col2, col3, col4 = st.columns(4)
        
        peak_infected = df['infected'].max()
        peak_time = df.loc[df['infected'].idxmax(), 't']
        total_infected = df['infected'].sum()
        attack_rate = (df['recovered'].max() / (df['healthy'].max() + df['recovered'].max() + df['infected'].max())) * 100 if df['healthy'].max() > 0 else 0
        
        with col1:
            st.metric(
                "Peak Infected",
                f"{peak_infected:.0f}",
                delta=f"at t={peak_time:.0f}",
                help="Maximum number of infected individuals"
            )
        
        with col2:
            st.metric(
                "Total Infected",
                f"{total_infected:.0f}",
                help="Sum of infected over all timepoints"
            )
        
        with col3:
            st.metric(
                "Attack Rate",
                f"{attack_rate:.1f}%",
                help="% of population that got infected"
            )
        
        with col4:
            st.metric(
                "Duration",
                f"{df['t'].max():.0f} days",
                help="Simulation duration"
            )
        
        st.divider()
        
        # Heatmap style chart
        st.subheader("📊 Stacked Area Chart")
        fig = go.Figure()
        
        fig.add_trace(go.Scatter(
            x=df['t'], y=df['healthy'],
            name='Healthy', fill='tonexty',
            line=dict(color='#2ecc71', width=0)
        ))
        fig.add_trace(go.Scatter(
            x=df['t'], y=df['infected'],
            name='Infected', fill='tonexty',
            line=dict(color='#e74c3c', width=0)
        ))
        fig.add_trace(go.Scatter(
            x=df['t'], y=df['recovered'],
            name='Recovered', fill='tonexty',
            line=dict(color='#3498db', width=0)
        ))
        
        fig.update_layout(
            title='Population Distribution Over Time',
            xaxis_title='Time (days)',
            yaxis_title='Population',
            template='plotly_dark',
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)
    
    # TAB 3: ADVANCED ANALYSIS
    with tab3:
        st.subheader("🔬 Curve Fitting & Forecasting")
        
        # Sigmoid fit for infected curve
        try:
            def sigmoid(t, a, b, c):
                return a / (1 + np.exp(-b * (t - c)))
            
            # Fit only to early exponential phase
            early_data = df[df['infected'] < df['infected'].max() * 0.5]
            if len(early_data) > 3:
                popt, _ = curve_fit(
                    sigmoid,
                    early_data['t'].values,
                    early_data['infected'].values,
                    p0=[df['infected'].max(), 0.1, 20],
                    maxfev=10000
                )
                
                # Calculate R²
                infected_pred = sigmoid(df['t'].values, *popt)
                ss_res = np.sum((df['infected'].values - infected_pred) ** 2)
                ss_tot = np.sum((df['infected'].values - df['infected'].mean()) ** 2)
                r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
                
                col1, col2, col3 = st.columns(3)
                col1.metric("R² Score", f"{r2:.4f}", help="Model fit quality (1.0 = perfect)")
                col2.metric("Peak (fitted)", f"{popt[0]:.0f}", help="Maximum infected from fit")
                col3.metric("Doubling Time", f"{np.log(2)/popt[1]:.1f} days", help="Early exponential phase")
                
                # Plot fit
                fig = go.Figure()
                fig.add_trace(go.Scatter(
                    x=df['t'], y=df['infected'],
                    name='Actual Data',
                    mode='markers+lines',
                    line=dict(color='#e74c3c', width=3)
                ))
                fig.add_trace(go.Scatter(
                    x=df['t'], y=infected_pred,
                    name='Sigmoid Fit',
                    line=dict(color='#f39c12', width=2, dash='dash')
                ))
                fig.update_layout(
                    title=f'Logistic Curve Fit (R² = {r2:.4f})',
                    xaxis_title='Time (days)',
                    yaxis_title='Infected',
                    template='plotly_dark',
                    height=400
                )
                st.plotly_chart(fig, use_container_width=True)
        except Exception as e:
            st.warning(f"Could not fit curve: {e}")
        
        st.divider()
        st.subheader("📉 Daily Change Rate")
        
        # Calculate daily changes
        df_copy = df.copy()
        df_copy['infected_change'] = df_copy['infected'].diff()
        df_copy['recovered_change'] = df_copy['recovered'].diff()
        
        fig = go.Figure()
        fig.add_trace(go.Bar(
            x=df_copy['t'],
            y=df_copy['infected_change'],
            name='Daily New Infections',
            marker=dict(color='#e74c3c')
        ))
        fig.add_trace(go.Bar(
            x=df_copy['t'],
            y=df_copy['recovered_change'],
            name='Daily Recoveries',
            marker=dict(color='#3498db')
        ))
        fig.update_layout(
            title='Daily Changes',
            xaxis_title='Time (days)',
            yaxis_title='Change',
            barmode='stack',
            template='plotly_dark',
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)
    
    # TAB 4: EXPORT
    with tab4:
        st.subheader("📥 Download Results")
        
        # CSV
        csv_buffer = io.StringIO()
        df.to_csv(csv_buffer, index=False)
        csv_bytes = csv_buffer.getvalue()
        
        st.download_button(
            label="📥 Download as CSV",
            data=csv_bytes,
            file_name="disease_data.csv",
            mime="text/csv"
        )
        
        # JSON
        json_bytes = df.to_json(orient='records')
        st.download_button(
            label="📥 Download as JSON",
            data=json_bytes,
            file_name="disease_data.json",
            mime="application/json"
        )
        
        st.divider()
        st.subheader("📊 Summary Statistics")
        
        summary = {
            'Metric': ['Peak Infected', 'Total Infected (sum)', 'Attack Rate (%)', 'Duration (days)', 'Max Healthy', 'Max Recovered'],
            'Value': [
                f"{peak_infected:.0f}",
                f"{total_infected:.0f}",
                f"{attack_rate:.2f}%",
                f"{df['t'].max():.0f}",
                f"{df['healthy'].max():.0f}",
                f"{df['recovered'].max():.0f}"
            ]
        }
        summary_df = pd.DataFrame(summary)
        st.dataframe(summary_df, use_container_width=True)
        
        summary_csv = summary_df.to_csv(index=False)
        st.download_button(
            label="📥 Download Summary",
            data=summary_csv,
            file_name="summary.csv",
            mime="text/csv"
        )

else:
    st.info("👆 Upload a CSV or JSON file to get started, or check the 'Use demo data' option in the sidebar!")
    
    st.markdown("""
    ### 📝 Expected File Format
    
    **CSV:**
    ```
    t,healthy,infected,recovered,vaccinated
    0,100,5,0,0
    1,95,10,3,0
    2,90,15,5,0
    ```
    
    **JSON:**
    ```json
    [
      {"t":0,"healthy":100,"infected":5,"recovered":0,"vaccinated":0},
      {"t":1,"healthy":95,"infected":10,"recovered":3,"vaccinated":0}
    ]
    ```
    """)
