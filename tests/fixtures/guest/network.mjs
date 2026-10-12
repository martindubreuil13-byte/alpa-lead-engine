import {enrichEmailV2} from '../../../lib/scraper/email-enrichment.ts'
import {inspectionFromOutcome} from '../../../lib/scraper/email-inspection.ts'
import {state} from './server.mjs'
export async function searchSerperMaps({maxResults,city}) {
 state.searchCalls++
 return Array.from({length:Math.min(maxResults,25)},(_,i)=>({company_name:`Offline ${['Acorn','Birch','Cedar','Daisy','Elm','Fir','Grove','Hazel','Iris','Juniper','Kiwi','Laurel','Maple','Nutmeg','Oak','Pine','Quartz','Rose','Spruce','Thyme','Umber','Violet','Willow','Xenia','Zebra'][i]} Advisors`,city,phone:`+1416555${String(i+1000)}`,website:i===24?null:`https://fixturebusiness${i+1}.ca/`,industry:'Business consultant',source:'serper_maps',source_url:null,email:null}))
}
export async function searchGooglePlaces(){return []}
export async function enrichEmailWithInspection(website) {
 const host=new URL(website).hostname
 const outcome=await enrichEmailV2(website,{
  fetchRobots:async()=>[],
  fetchPage:async url=>({html:`<title>Fixture site</title><meta name="description" content="Local consulting"><h1>Small business support</h1><a href="mailto:info@${host}">Contact</a>`,resolvedUrl:url}),
 })
 return {record:outcome.best,inspection:inspectionFromOutcome(outcome),websiteFacts:outcome.websiteFacts}
}
export async function enrichEmail(website){return (await enrichEmailWithInspection(website)).record}
