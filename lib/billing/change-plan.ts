import { PLANS } from './plans.ts'

export function decidePlanChange(current: string, target: 'starter' | 'pro') {
  const next = target === 'starter' ? 'starter_100' : 'pro'
  if (current !== 'starter_100' && current !== 'pro') {
    throw new Error('Legacy subscriptions require a reviewed migration before changing plans.')
  }
  if (current === next) throw new Error('You already have this plan.')
  return { next, downgrade: PLANS[next].businesses < PLANS[current].businesses }
}
