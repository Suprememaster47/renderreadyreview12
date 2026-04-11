/**
 * components/Dashboard.jsx
 *
 * AdminJS v7 custom dashboard component.
 */
import React, { useEffect, useState, useRef } from 'react'
import { ApiClient } from 'adminjs'

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
      const formatted = Number.isInteger(raw) ? Math.round(current).toString() : current.toFixed(1)
      setDisplay(isPercent ? `${formatted}%` : formatted)
      if (progress < 1) frameRef.current = requestAnimationFrame(tick)
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
            display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '99px',
            fontSize: '10px', fontWeight: '700', background: m.bg, color: m.color, whiteSpace: 'nowrap',
          }}>
            {m.icon} {m.label} {count} <span style={{ opacity: 0.7 }}>({pct}%)</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Animated components ───────────────────────────────────────────────────
const AnimatedNumber = ({ value, color, animStart }) => {
  const counted = useCountUp(value, 1500, animStart)
  const chars = String(counted).split('')
  return (
    <div style={{ fontSize: '32px', fontWeight: '800', color, display: 'flex', justifyContent: 'center' }}>
      {chars.map((ch, i) => (
        <span key={`${i}-${ch}`} style={{ animation: animStart ? 'slideUp 0.1s ease-out' : 'none' }}>{ch}</span>
      ))}
    </div>
  )
}

const TiltCard = ({ children, color }) => {
  const ref = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0, scale: 1 })
  const handleMove = (e) => {
    const rect = ref.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: -y * 15, y: x * 15, scale: 1.03 })
  }
  return (
    <div ref={ref} onMouseMove={handleMove} onMouseLeave={() => setTilt({ x: 0, y: 0, scale: 1 })}
      style={{
        background: '#fff', borderRadius: '12px', padding: '20px', flex: '1 1 140px', textAlign: 'center',
        borderTop: `4px solid ${color}`, transition: 'transform 0.1s ease',
        transform: `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${tilt.scale})`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
      }}>
      {children}
    </div>
  )
}

const StatCard = ({ value, label, sublabel, color, loading, sources, total, animStart }) => (
  <TiltCard color={color}>
    {loading ? <div>...</div> : <AnimatedNumber value={value} color={color} animStart={animStart} />}
    <div style={{ fontSize: '12px', fontWeight: '700', marginTop: '8px' }}>{label}</div>
    <div style={{ fontSize: '10px', color: '#aaa' }}>{sublabel}</div>
    {!loading && sources && <SourcePills sources={sources} total={total} />}
  </TiltCard>
)

// ── Main Dashboard ────────────────────────────────────────────────────────────
const Dashboard = () => {
  const [data, setData] = useState({
    viewsToday: 0, views7Days: 0, views30Days: 0, viewsAllTime: 0,
    leadsCount: 0, botAlerts24h: 0, recentContacts: [], serviceBreakdown: [],
    sourcesToday: {}, sources7Days: {}, sources30Days: {}, sourcesAllTime: {},
    viewsByPath: [], lastLogin: null,
  })
  const [loading, setLoading] = useState(true)
  const [animStart, setAnimStart] = useState(false)

  useEffect(() => {
    const api = new ApiClient()
    api.getDashboard()
      .then((res) => {
        setData(res.data)
        setLoading(false)
        setTimeout(() => setAnimStart(true), 150)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '30px', background: '#f4f7f9', minHeight: '100vh' }}>
      <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontWeight: '800', fontSize: '24px' }}>Hydro Sweep Services Command Center</h1>
        <p style={{ color: '#666' }}>Live overview of exterior maintenance leads and traffic.</p>
      </div>

      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '30px' }}>
        <StatCard loading={loading} animStart={animStart} value={data.viewsToday} label="Today" color="#2563eb" sources={data.sourcesToday} total={data.viewsToday} />
        <StatCard loading={loading} animStart={animStart} value={data.views7Days} label="7 Days" color="#7c3aed" sources={data.sources7Days} total={data.views7Days} />
        <StatCard loading={loading} animStart={animStart} value={data.views30Days} label="30 Days" color="#0891b2" sources={data.sources30Days} total={data.views30Days} />
        <StatCard loading={loading} animStart={animStart} value={data.viewsAllTime} label="All Time" color="#059669" sources={data.sourcesAllTime} total={data.viewsAllTime} />
      </div>

      <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
         <h2 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#999', marginBottom: '15px' }}>Recent Lead History</h2>
         {/* Table or list of recentContacts mapping goes here */}
         {data.recentContacts?.length > 0 ? (
           <div style={{ overflowX: 'auto' }}>
             <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
               <thead>
                 <tr style={{ color: '#aaa', fontSize: '11px' }}>
                   <th style={{ padding: '10px' }}>NAME</th>
                   <th style={{ padding: '10px' }}>SERVICE</th>
                   <th style={{ padding: '10px' }}>DATE</th>
                 </tr>
               </thead>
               <tbody>
                 {data.recentContacts.map((c, i) => (
                   <tr key={i} style={{ borderTop: '1px solid #eee', fontSize: '13px' }}>
                     <td style={{ padding: '10px', fontWeight: '600' }}>{c.fullName}</td>
                     <td style={{ padding: '10px' }}>{c.message}</td>
                     <td style={{ padding: '10px', color: '#aaa' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         ) : <p>No leads yet.</p>}
      </div>
    </div>
  )
}

export default Dashboard
