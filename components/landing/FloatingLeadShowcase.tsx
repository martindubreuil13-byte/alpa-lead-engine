'use client'

import { useEffect, useState } from 'react'

import FloatingLeadCard from '@/components/landing/FloatingLeadCard'

type ShowcaseLead = {
  company: string
  email: string
  website: string
  city: string
  industry: string
  confidence: 'HIGH' | 'MEDIUM'
}

type ShowcaseCard = ShowcaseLead & {
  className: string
  delay: string
}

const LEADS: ShowcaseLead[] = [
  {
    company: 'Brickell Growth Studio',
    email: 'hello@brickellgrowth.com',
    website: 'brickellgrowth.com',
    city: 'Miami, FL',
    industry: 'Marketing agency',
    confidence: 'HIGH',
  },
  {
    company: 'Sunset Local Media',
    email: 'team@sunsetlocalmedia.com',
    website: 'sunsetlocalmedia.com',
    city: 'Miami, FL',
    industry: 'Local marketing',
    confidence: 'MEDIUM',
  },
  {
    company: 'Palm Reach Creative',
    email: 'growth@palmreachcreative.com',
    website: 'palmreachcreative.com',
    city: 'Miami, FL',
    industry: 'Marketing agency',
    confidence: 'HIGH',
  },
  {
    company: 'Biscayne Demand Co',
    email: 'contact@biscaynedemand.co',
    website: 'biscaynedemand.co',
    city: 'Miami, FL',
    industry: 'Demand generation',
    confidence: 'MEDIUM',
  },
  {
    company: 'Coral Gables Creative',
    email: 'sales@coralgablescreative.com',
    website: 'coralgablescreative.com',
    city: 'Miami, FL',
    industry: 'Creative agency',
    confidence: 'HIGH',
  },
]

const SLOT_CLASSES = [
  'right-[0.9rem] top-[8rem] sm:right-[1.2rem] sm:top-[8.4rem]',
  'left-[1rem] top-[18.6rem] sm:left-[1.3rem] sm:top-[19rem]',
  'hidden sm:block right-[1.3rem] top-[20.2rem] sm:right-[1.8rem] sm:top-[20.6rem]',
  'hidden sm:block left-[1.4rem] bottom-[1.2rem] sm:left-[2rem] sm:bottom-[1.4rem]',
  'hidden lg:block right-[1rem] bottom-[1.1rem] sm:right-[1.3rem] sm:bottom-[1.3rem]',
]

function shuffle<T>(items: T[]) {
  const next = [...items]

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

function buildShowcaseCards() {
  const shuffled = shuffle(LEADS)

  return shuffled.map((lead, index) => ({
    ...lead,
    className: SLOT_CLASSES[index],
    delay: `${(Math.random() * 2.8 + index * 0.18).toFixed(2)}s`,
  }))
}

export default function FloatingLeadShowcase() {
  const [cards, setCards] = useState<ShowcaseCard[]>(
    LEADS.map((lead, index) => ({
      ...lead,
      className: SLOT_CLASSES[index],
      delay: `${(0.35 + index * 0.45).toFixed(2)}s`,
    }))
  )

  useEffect(() => {
    setCards(buildShowcaseCards())
  }, [])

  return (
    <>
      {cards.map((card) => (
        <FloatingLeadCard
          key={`${card.company}-${card.city}`}
          company={card.company}
          email={card.email}
          website={card.website}
          city={card.city}
          industry={card.industry}
          confidence={card.confidence}
          className={card.className}
          style={{ animationDelay: card.delay }}
        />
      ))}
    </>
  )
}
