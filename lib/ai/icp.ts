import { z } from 'zod'

export const icpRequestSchema = z.object({
  description: z.string().trim().min(20).max(4000),
})

const listItemSchema = z.string().trim().min(1).max(120)

export const icpSchema = z.object({
  industries: z.array(listItemSchema).min(1).max(8),
  excluded: z.array(listItemSchema).max(8),
  location: z.array(listItemSchema).max(8),
  company_size: z.string().trim().min(1).max(120),
  pain_points: z.array(listItemSchema).min(1).max(8),
  angles: z.array(listItemSchema).min(1).max(8),
  summary: z.string().trim().min(1).max(320),
})

export type ICPData = z.infer<typeof icpSchema>
