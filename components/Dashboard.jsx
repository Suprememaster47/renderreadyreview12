import React, { useEffect, useState, useRef } from 'react'

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target, duration, start) {
  const [display, setDisplay] = useState('0')
  const frameRef = useRef(null)

  useEffect(() => {
    if (!start) return

    const strTarget = String(target)
    const isPercent = strTarget.endsWith('%')
    const raw = parseFloat(strTarget.replace('%', ''))

    if (isNaN(raw)) {
      setDisplay(target)
      return
    }

    const startTime = performance.now()

    const tick = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      const current = raw * eased

      const formatted = Number.isInteger(raw)
        ? Math.round(current).toString()
        : current.toFixed(1)

      setDisplay(isPercent ? `${formatted}%` : formatted)

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration, start])

  return display
}

// ── Source pill badges ────────────────────────────────────────────────────────

const SOURCE_META = {
  instagram: { label: 'Instagram', color: '#e1306c', bg: '#fde8f0', icon: '📸' },
  tiktok:    { label: 'TikTok',    color: '#010101', bg: '#f0f0f0', icon: '🎵' },
  facebook:  { label: 'Facebook',  color: '#1877f2', bg: '#e7f0fd', icon: '👍' },
  direct:    { label: 'Direct',    color: '#059669', bg: '#d1fae5', icon: '🌐' },
}

const SourcePills = ({ sources, total }) => {
  if (!sources || total === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '10px', justifyContent: 'center' }}>
      {Object.entries(sources).map(([key, count]) => {
        if (count === 0) return null
        const m = SOURCE_META[key] || SOURCE_META.direct
        const pct = total > 0 ? Math.round((count / total) * 100) : 0
        return (
          <span key={key} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            padding: '2px 8px',
            borderRadius: '99px',
            fontSize: '10px',
            fontWeight: '700',
            background: m.bg,
            color: m.color,
            whiteSpace: 'nowrap',
          }}>
            {m.icon} {m.label} {count} <span style={{ opacity: 0.7 }}>({pct}%)</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Animated number display ───────────────────────────────────────────────────

const AnimatedNumber = ({ value, color, animStart }) => {
  const counted = useCountUp(value, 1500, animStart)
  const chars = String(counted).split('')

  return (
    <div style={{
      fontSize: 'clamp(22px, 6vw, 38px)',
      fontWeight: '800',
      color,
      lineHeight: 1.1,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      flexWrap: 'wrap',
      overflow: 'hidden',
      minHeight: '46px',
      width: '100%',
      boxSizing: 'border-box',
      wordBreak: 'break-all',
    }}>
      {chars.map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          style={{
            display: 'inline-block',
            animation: animStart ? 'slideUp 0.08s ease-out' : 'none',
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  )
}

// ── Tilt card ─────────────────────────────────────────────────────────────────

const TiltCard = ({ children, color }) => {
  const ref = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0, scale: 1, shadow: '0 1px 6px rgba(0,0,0,0.07)' })

  const handleMove = (e) => {
    const card = ref.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width  - 0.5
    const py = (e.clientY - rect.top)  / rect.height - 0.5
    const rotateY =  px * 16
    const rotateX = -py * 16
    setTilt({
      x: rotateX,
      y: rotateY,
      scale: 1.04,
      shadow: `${-rotateY * 0.8}px ${rotateX * 0.8 + 8}px 28px rgba(0,0,0,0.18)`,
    })
  }

  const handleLeave = () => {
    setTilt({ x: 0, y: 0, scale: 1, shadow: '0 1px 6px rgba(0,0,0,0.07)' })
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '22px 12px',
        flex: '1 1 130px',
        minWidth: '120px',
        textAlign: 'center',
        borderTop: `4px solid ${color}`,
        boxSizing: 'border-box',
        cursor: 'default',
        willChange: 'transform',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        transform: `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${tilt.scale})`,
        boxShadow: tilt.shadow,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

const StatCard = ({ value, label, sublabel, color, loading, sources, total, animStart }) => (
  <TiltCard color={color}>
    {loading ? (
      <div style={{ fontSize: '38px', fontWeight: '800', color: '#ccc', lineHeight: 1.1, minHeight: '46px' }}>—</div>
    ) : (
      <AnimatedNumber value={value} color={color} animStart={animStart} />
    )}
    <div style={{ fontSize: '12px', fontWeight: '700', color: '#1c1c1c', marginTop: '8px', letterSpacing: '0.2px' }}>
      {label}
    </div>
    {sublabel && (
      <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>{sublabel}</div>
    )}
    {!loading && sources && <SourcePills sources={sources} total={total} />}
  </TiltCard>
)

const PlainStatCard = ({ value, label, sublabel, color, loading, animStart }) => (
  <TiltCard color={color}>
    {loading ? (
      <div style={{ fontSize: '38px', fontWeight: '800', color: '#ccc', lineHeight: 1.1, minHeight: '46px' }}>—</div>
    ) : (
      <AnimatedNumber value={value} color={color} animStart={animStart} />
    )}
    <div style={{ fontSize: '12px', fontWeight: '700', color: '#1c1c1c', marginTop: '8px', letterSpacing: '0.2px' }}>
      {label}
    </div>
    {sublabel && (
      <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>{sublabel}</div>
    )}
  </TiltCard>
)

// ── Section title ─────────────────────────────────────────────────────────────

const SectionTitle = ({ children }) => (
  <h2 style={{
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    color: '#aaa',
    margin: '0 0 12px',
  }}>
    {children}
  </h2>
)

// ── Format last login ─────────────────────────────────────────────────────────

const formatLoginDate = (iso) => {
  if (!iso) return 'No login recorded yet'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ── Page label prettifier ─────────────────────────────────────────────────────

const PAGE_LABELS = {
  '/':             '🏠 Home (index)',
  '/home.html':    '🏠 Home',
  '/about.html':   'ℹ️  About',
  '/pricing.html': '💰 Pricing',
  '/contact.html': '📬 Contact',
}

const prettyPath = (p) => PAGE_LABELS[p] || p || '(unknown)'

// Distinct bar colours per path so each row stands out
const PATH_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626']

// ── Views by Landing Page panel ───────────────────────────────────────────────

const ViewsByPath = ({ viewsByPath, viewsAllTime, loading }) => {
  const panel = {
    background: '#fff',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
    marginBottom: '24px',
    boxSizing: 'border-box',
    width: '100%',
    overflowX: 'hidden',
  }

  if (loading) {
    return (
      <div style={panel}>
        <p style={{ color: '#ccc', margin: 0, fontSize: '13px' }}>Loading...</p>
      </div>
    )
  }

  if (!viewsByPath || viewsByPath.length === 0) {
    return (
      <div style={panel}>
        <p style={{ color: '#aaa', margin: 0, fontSize: '13px' }}>No page view data yet.</p>
      </div>
    )
  }

  const maxCount = Math.max(...viewsByPath.map((r) => r.count), 1)

  return (
    <div style={panel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {viewsByPath.map((row, i) => {
          const color = PATH_COLORS[i % PATH_COLORS.length]
          const pct   = viewsAllTime > 0 ? Math.round((row.count / viewsAllTime) * 100) : 0
          const barW  = Math.round((row.count / maxCount) * 100)

          return (
            <div key={row._id || i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '12px', gap: '8px' }}>
                <span style={{ fontWeight: '700', color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                  {prettyPath(row._id)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span style={{
                    background: color,
                    color: '#fff',
                    borderRadius: '99px',
                    padding: '1px 8px',
                    fontSize: '11px',
                    fontWeight: '800',
                  }}>
                    {row.count}
                  </span>
                  <span style={{ color: '#aaa', fontSize: '11px', fontWeight: '600' }}>
                    {pct}%
                  </span>
                </span>
              </div>
              <div style={{ background: '#f0f0f0', borderRadius: '99px', height: '7px', overflow: 'hidden' }}>
                <div style={{ width: `${barW}%`, background: color, height: '100%', borderRadius: '99px', transition: 'width 0.6s ease' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

const Dashboard = () => {
  const [data, setData] = useState({
    viewsToday: 0, views7Days: 0, views30Days: 0, viewsAllTime: 0,
    leadsCount: 0, botAlerts24h: 0,
    recentContacts: [], serviceBreakdown: [],
    sourcesToday:   { instagram: 0, tiktok: 0, facebook: 0, direct: 0 },
    sources7Days:   { instagram: 0, tiktok: 0, facebook: 0, direct: 0 },
    sources30Days:  { instagram: 0, tiktok: 0, facebook: 0, direct: 0 },
    sourcesAllTime: { instagram: 0, tiktok: 0, facebook: 0, direct: 0 },
    viewsByPath: [],
    lastLogin: null,
  })
  const [loading, setLoading] = useState(true)
  const [animStart, setAnimStart] = useState(false)

  useEffect(() => {
    const api = new window.AdminJS.ApiClient()
    api.getDashboard()
      .then((response) => {
        setData(response.data)
        setLoading(false)
        setTimeout(() => setAnimStart(true), 120)
      })
      .catch((err) => { console.error('Dashboard fetch error:', err); setLoading(false) })
  }, [])

  const conversionRate = data.viewsAllTime > 0
    ? ((data.leadsCount / data.viewsAllTime) * 100).toFixed(1)
    : '0.0'

  const wrap = {
    padding: '20px 16px',
    background: '#f3f5f8',
    minHeight: '100vh',
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    boxSizing: 'border-box',
  }

  const panel = {
    background: '#fff',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
    marginBottom: '24px',
    boxSizing: 'border-box',
    width: '100%',
    overflowX: 'hidden',
  }

  const cardRow = {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '24px',
  }

  return (
    <div style={wrap}>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(12px); opacity: 0.4; }
          to   { transform: translateY(0);    opacity: 1;   }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={panel}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#111' }}>
              Hydro Sweep Services
            </h1>
            <p style={{ margin: '4px 0 0', color: '#999', fontSize: '12px' }}>
              Admin Dashboard · Live business overview
            </p>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: '#f3f5f8', border: '1px solid #e5e7eb',
            borderRadius: '8px', padding: '8px 12px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '14px' }}>🔐</span>
            <div>
              <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: '#aaa' }}>
                Last Login
              </div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#333', whiteSpace: 'nowrap' }}>
                {loading ? '—' : formatLoginDate(data.lastLogin)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Traffic KPIs ── */}
      <SectionTitle>Site Traffic</SectionTitle>
      <div style={cardRow}>
        <StatCard loading={loading} animStart={animStart} value={data.viewsToday}   label="Views Today"    sublabel="Since midnight" color="#2563eb" sources={data.sourcesToday}   total={data.viewsToday} />
        <StatCard loading={loading} animStart={animStart} value={data.views7Days}   label="Last 7 Days"    sublabel="Rolling week"   color="#7c3aed" sources={data.sources7Days}   total={data.views7Days} />
        <StatCard loading={loading} animStart={animStart} value={data.views30Days}  label="Last 30 Days"   sublabel="Rolling month"  color="#0891b2" sources={data.sources30Days}  total={data.views30Days} />
        <StatCard loading={loading} animStart={animStart} value={data.viewsAllTime} label="All-Time Views" sublabel="Since launch"   color="#059669" sources={data.sourcesAllTime} total={data.viewsAllTime} />
      </div>

      {/* ── Views by Landing Page ── */}
      <SectionTitle>All-Time Views by Landing Page</SectionTitle>
      <ViewsByPath
        viewsByPath={data.viewsByPath}
        viewsAllTime={data.viewsAllTime}
        loading={loading}
      />

      {/* ── Leads, Conversion, Security ── */}
      <SectionTitle>Leads, Conversion &amp; Security</SectionTitle>
      <div style={cardRow}>
        <PlainStatCard loading={loading} animStart={animStart} value={data.leadsCount}        label="Total Leads"      sublabel="Contact form entries"   color="#d97706" />
        <PlainStatCard loading={loading} animStart={animStart} value={`${conversionRate}%`}   label="Conversion Rate"  sublabel="Leads ÷ All-Time Views" color="#16a34a" />
        <PlainStatCard loading={loading} animStart={animStart} value={data.botAlerts24h}      label="Bot Alerts (24h)" sublabel="Honeypot / /admin hits"  color="#dc2626" />
      </div>

      {/* ── Recent Contacts ── */}
      <SectionTitle>Recent Contacts</SectionTitle>
      <div style={panel}>
        {loading ? (
          <p style={{ color: '#ccc', margin: 0, fontSize: '13px' }}>Loading...</p>
        ) : data.recentContacts.length === 0 ? (
          <p style={{ color: '#aaa', margin: 0, fontSize: '13px' }}>No contacts yet.</p>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '520px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f0f0f0' }}>
                  {['Name', 'Email', 'Phone', 'Service / Message', 'Date'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '7px 10px', fontWeight: '700',
                      color: '#888', fontSize: '10px', textTransform: 'uppercase',
                      letterSpacing: '0.8px', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentContacts.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f7f7f7' }}>
                    <td style={{ padding: '9px 10px', fontWeight: '600', color: '#111', whiteSpace: 'nowrap' }}>{c.fullName || '—'}</td>
                    <td style={{ padding: '9px 10px', color: '#555', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email || '—'}</td>
                    <td style={{ padding: '9px 10px', color: '#555', whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                    <td style={{ padding: '9px 10px', color: '#555', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message || '—'}</td>
                    <td style={{ padding: '9px 10px', color: '#aaa', whiteSpace: 'nowrap', fontSize: '11px' }}>
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Service Breakdown ── */}
      <SectionTitle>Service Breakdown</SectionTitle>
      <div style={panel}>
        {loading ? (
          <p style={{ color: '#ccc', margin: 0, fontSize: '13px' }}>Loading...</p>
        ) : data.serviceBreakdown.length === 0 ? (
          <p style={{ color: '#aaa', margin: 0, fontSize: '13px' }}>No data yet.</p>
        ) : (() => {
          const max = Math.max(...data.serviceBreakdown.map((s) => s.count), 1)
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.serviceBreakdown.map((s, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '12px' }}>
                    <span style={{ fontWeight: '600', color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                      {s._id || 'Unspecified'}
                    </span>
                    <span style={{ color: '#888', fontWeight: '700', flexShrink: 0, marginLeft: '8px' }}>{s.count}</span>
                  </div>
                  <div style={{ background: '#f0f0f0', borderRadius: '99px', height: '7px', overflow: 'hidden' }}>
                    <div style={{ width: `${(s.count / max) * 100}%`, background: '#2563eb', height: '100%', borderRadius: '99px' }} />
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

    </div>
  )
}

export default Dashboard
