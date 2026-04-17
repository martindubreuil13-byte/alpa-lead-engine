'use client'

type CoreStatus = 'running' | 'paused' | 'idle'

type Props = {
  size: number
  status: CoreStatus
}

const STATUS_LABEL: Record<CoreStatus, string> = {
  running: 'AGENT RUNNING',
  paused: 'PAUSED',
  idle: 'STANDBY',
}

export function Core({ size, status }: Props) {
  const glowSize = size + 140

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Outer ambient glow — pulses */}
      <div
        className="ai-core-glow pointer-events-none absolute rounded-full"
        style={{
          width: glowSize,
          height: glowSize,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          background: 'radial-gradient(circle, rgba(59,130,246,0.28) 0%, rgba(59,130,246,0.08) 45%, transparent 70%)',
          filter: 'blur(28px)',
        }}
      />

      {/* Core body — breathes */}
      <div
        className="ai-core-breathe relative flex items-center justify-center overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          background:
            'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.13) 0%, rgba(59,130,246,0.22) 38%, rgba(15,23,42,0.92) 72%, rgba(2,6,23,0.98) 100%)',
          border: '1px solid rgba(59,130,246,0.18)',
          boxShadow: '0 0 40px 8px rgba(59,130,246,0.12), inset 0 0 60px rgba(59,130,246,0.06)',
        }}
      >
        {/* Inner highlight (static — gives glass depth) */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: '44%',
            height: '38%',
            top: '12%',
            left: '18%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%)',
          }}
        />

        {/* Status label */}
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.22em',
            color: 'rgba(255,255,255,0.28)',
            userSelect: 'none',
            zIndex: 1,
          }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  )
}
