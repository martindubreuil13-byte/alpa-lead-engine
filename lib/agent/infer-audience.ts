/**
 * Infer who the LEAD SERVES — i.e. their own customers.
 *
 * audience_input describes the LEAD TYPE (who we contact).
 * inferAudience returns who THAT LEAD sells to.
 *
 * Used in email generation so we never produce phrases like
 * "marketing agency clients" (which conflates the lead with their audience).
 */

const AUDIENCE_MAP: Array<[RegExp, string]> = [
  [/marketing.agenc|growth.studio|seo.agenc|digital.agenc|ad.agenc|media.agenc|creative.agenc/i, 'businesses'],
  [/business.coach|executive.coach|life.coach|career.coach|leadership.coach/i, 'founders and entrepreneurs'],
  [/recruiter|staffing|headhunter|talent.agenc|hiring/i, 'candidates and companies'],
  [/real.estate|realtor|broker|property.manag/i, 'buyers and sellers'],
  [/law.firm|lawyer|attorney|legal.service|solicitor/i, 'individuals and companies'],
  [/web.dev|web.design|developer|designer|digital.studio/i, 'businesses needing an online presence'],
  [/saas|software|tech.startup|platform|app.develop/i, 'users and customers'],
  [/accountant|bookkeep|cpa|tax.prep|financial.advis/i, 'businesses and individuals'],
  [/consultant|consulting.firm|management.consult/i, 'businesses'],
  [/pr.agenc|public.relation|communications/i, 'brands and companies'],
  [/insurance|financial.plann/i, 'individuals and families'],
  [/healthcare|medical.practice|dental|clinic|therapy|therapist/i, 'patients'],
  [/restaurant|food.service|catering|hospitality/i, 'diners and guests'],
  [/e.commerce|online.store|retail|ecommerce/i, 'shoppers and customers'],
  [/photograph|videograph/i, 'couples, families, and businesses'],
  [/interior.design|architect|home.builder|contractor/i, 'homeowners and businesses'],
  [/fitness|personal.train|gym|wellness/i, 'individuals seeking results'],
  [/education|tutor|training.provider|e.learning/i, 'students and learners'],
  [/event.plann|event.manag/i, 'individuals and businesses'],
  [/logistics|supply.chain|freight|shipping/i, 'businesses'],
]

export function inferAudience(category: string): string {
  const lower = category.toLowerCase()
  for (const [pattern, audience] of AUDIENCE_MAP) {
    if (pattern.test(lower)) return audience
  }
  return 'clients'
}
