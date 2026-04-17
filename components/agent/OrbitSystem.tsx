'use client'

import { useEffect, useState } from 'react'

import { Core } from './Core'
import { MissionNode, type NodeMission } from './MissionNode'

type Sizes = {
  core: number
  orbit: number
  nodeW: number
  nodeH: number
}

const ORBIT_DURATIONS = [48, 54, 44, 58, 50] // seconds, one per slot (max 5)

function computeSizes(w: number): Sizes {
  if (w < 640) return { core: 220, orbit: 148, nodeW: 130, nodeH: 44 }
  if (w < 1024) return { core: 280, orbit: 195, nodeW: 148, nodeH: 44 }
  return { core: 340, orbit: 238, nodeW: 164, nodeH: 44 }
}

type Props = {
  missions: NodeMission[]
  onNodeClick: (id: string) => void
}

export function OrbitSystem({ missions, onNodeClick }: Props) {
  const [sizes, setSizes] = useState<Sizes>({ core: 340, orbit: 238, nodeW: 164, nodeH: 44 })

  useEffect(() => {
    const update = () => setSizes(computeSizes(window.innerWidth))
    update()
    const mq = window.matchMedia('(max-width: 640px)')
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const visibleMissions = missions.slice(0, 5)
  const N = visibleMissions.length
  const { core, orbit, nodeW, nodeH } = sizes

  // Core status
  const coreStatus =
    missions.some((m) => m.status === 'active') ? 'running'
    : missions.some((m) => ['paused', 'needs_review'].includes(m.status)) ? 'paused'
    : 'idle'

  return (
    // Full-area container — orbit is positioned absolutely from center
    <div className="pointer-events-none absolute inset-0">
      {/* Core — centered */}
      <div
        className="pointer-events-auto absolute"
        style={{
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%)`,
        }}
      >
        <Core size={core} status={coreStatus} />
      </div>

      {/* Orbit nodes */}
      {visibleMissions.map((mission, i) => {
        const initialAngle = N === 1 ? 0 : (360 / N) * i
        const duration = ORBIT_DURATIONS[i] ?? 50
        // Negative delay starts animation mid-cycle so node appears at initialAngle
        const delay = -(initialAngle / 360) * duration

        return (
          <div
            key={mission.id}
            // Outer arm: rotates CW around orbit center
            className="pointer-events-none absolute"
            style={{
              top: '50%',
              left: '50%',
              width: 0,
              height: 0,
              animationName: 'ai-orbit-cw',
              animationDuration: `${duration}s`,
              animationTimingFunction: 'linear',
              animationDelay: `${delay}s`,
              animationIterationCount: 'infinite',
            }}
          >
            {/* Arm extension: static translateY positions node at orbit radius */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(-${orbit}px)`,
                // Center node at the arm endpoint
                marginLeft: -nodeW / 2,
                marginTop: -nodeH / 2,
              }}
            >
              {/* Counter-rotation: keeps node text upright */}
              <div
                className="pointer-events-auto"
                style={{
                  animationName: 'ai-orbit-ccw',
                  animationDuration: `${duration}s`,
                  animationTimingFunction: 'linear',
                  animationDelay: `${delay}s`,
                  animationIterationCount: 'infinite',
                }}
              >
                <MissionNode
                  mission={mission}
                  onClick={() => onNodeClick(mission.id)}
                  width={nodeW}
                />
              </div>
            </div>
          </div>
        )
      })}

      {/* Empty state hint — rendered below core when no missions */}
      {N === 0 && (
        <div
          className="pointer-events-none absolute text-center"
          style={{
            top: `calc(50% + ${core / 2 + 28}px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.14em' }}>
            No missions running
          </span>
        </div>
      )}
    </div>
  )
}
