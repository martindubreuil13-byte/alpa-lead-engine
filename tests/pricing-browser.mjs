import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base=process.env.BASE_URL || 'http://localhost:3317'
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local preview only')
const browser=await chromium.launch({headless:true,channel:'chrome'})
try {
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport})
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort())
  const page=await context.newPage()
  await page.goto(base+'/plans')
  for(const text of ['ALPA Free','ALPA Starter','ALPA Pro','$9.99','$24.99','100 businesses / month','500 businesses / month']) await page.getByText(text,{exact:true}).first().waitFor()
  assert.equal(await page.getByText(/Upcoming offer|Not active yet|coupon/i).count(),0,'no unfinished offer text')
  await page.getByText(/Free includes 25 businesses, lifetime/).waitFor()
  for(const link of ['Terms','Privacy Policy','Refund & Cancellation Policy']) assert.ok(await page.getByRole('link',{name:link}).count()>0,`${link} link`)
  assert.equal(await page.getByText('Prospector',{exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(process.env.PRICING_SCREENSHOT_DIR) await page.screenshot({path:process.env.PRICING_SCREENSHOT_DIR+`/pricing-${name}.png`,fullPage:true})
  await page.getByRole('button',{name:'Choose Starter',exact:true}).click()
  await page.waitForURL('**/login?mode=signup&plan=starter&source=plans_starter')
  await page.goto(base+'/plans')
  await page.getByRole('button',{name:'Choose Pro',exact:true}).click()
  await page.waitForURL('**/login?mode=signup&plan=pro&source=plans_pro')
  console.log(`PASS ${name}: prices, allowances, no offer text, legal links, fit and both account-first plan selections`)
  await context.close()
 }
} finally {await browser.close()}
