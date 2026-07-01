'use client'

import { useState, useEffect } from 'react'

interface Lead {
  id: string
  company_name: string
  website: string | null
  ci_enrichment_status?: string | null
  ci_enriched_at?: string | null
  ci_last_error?: string | null
}

interface EnrichmentResult {
  ok: boolean
  leadId: string
  data?: {
    website_snapshot: any
    business_signals: any
    commercial_profile: any
  }
  error?: {
    code: string
    message: string
  }
  processingDurationMs: number
  cost: number
}

export default function CommercialIntelligenceTestPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [isEnriching, setIsEnriching] = useState(false)
  const [result, setResult] = useState<EnrichmentResult | null>(null)
  const [forceRefresh, setForceRefresh] = useState(false)

  useEffect(() => {
    loadRecentLeads()
  }, [])

  async function loadRecentLeads() {
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/recent-leads')
      if (response.ok) {
        const data = await response.json()
        if (data.leads && data.leads.length > 0) {
          setLeads(data.leads)
          setSelectedLeadId(data.leads[0].id)
        }
      }
    } catch {
      console.error('Failed to load leads')
    }
    setIsLoading(false)
  }

  async function handleEnrich() {
    if (!selectedLeadId) return

    setIsEnriching(true)
    setResult(null)

    try {
      const response = await fetch('/api/admin/enrich-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLeadId,
          forceRefresh,
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.ok) {
        loadRecentLeads()
      }
    } catch (err) {
      setResult({
        ok: false,
        leadId: selectedLeadId,
        error: {
          code: 'REQUEST_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
        processingDurationMs: 0,
        cost: 0,
      })
    } finally {
      setIsEnriching(false)
    }
  }

  const selectedLead = leads.find((l) => l.id === selectedLeadId)

  return (
    <div className="space-y-8 p-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-2">Commercial Intelligence Test</h1>
        <p className="text-gray-600">Admin-only testing interface for enrichment pipeline</p>
      </div>

      {/* Lead selection */}
      <section className="border rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-semibold">Select Lead</h2>

        {isLoading ? (
          <div className="text-gray-500">Loading leads...</div>
        ) : (
          <div className="space-y-2">
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">-- Select a lead --</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.company_name || 'Unnamed'} ({lead.id.slice(0, 8)})
                </option>
              ))}
            </select>

            {selectedLead && (
              <div className="text-sm space-y-1 bg-gray-50 p-3 rounded mt-4">
                <div>
                  <span className="font-semibold">Company:</span> {selectedLead.company_name}
                </div>
                <div>
                  <span className="font-semibold">Website:</span> {selectedLead.website || '(none)'}
                </div>
                <div>
                  <span className="font-semibold">Status:</span>{' '}
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs font-mono ${
                      selectedLead.ci_enrichment_status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : selectedLead.ci_enrichment_status === 'processing'
                          ? 'bg-blue-100 text-blue-800'
                          : selectedLead.ci_enrichment_status === 'failed'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {selectedLead.ci_enrichment_status || 'pending'}
                  </span>
                </div>
                {selectedLead.ci_enriched_at && (
                  <div>
                    <span className="font-semibold">Enriched:</span>{' '}
                    {new Date(selectedLead.ci_enriched_at).toLocaleString()}
                  </div>
                )}
                {selectedLead.ci_last_error && (
                  <div>
                    <span className="font-semibold text-red-700">Error:</span> {selectedLead.ci_last_error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Enrichment controls */}
      <section className="border rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-semibold">Enrich Lead</h2>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="force-refresh"
            checked={forceRefresh}
            onChange={(e) => setForceRefresh(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="force-refresh" className="text-sm">
            Force refresh (re-enrich even if already complete)
          </label>
        </div>

        <button
          onClick={handleEnrich}
          disabled={isEnriching || !selectedLeadId}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded font-semibold"
        >
          {isEnriching ? 'Enriching...' : 'Start Enrichment'}
        </button>
      </section>

      {/* Results */}
      {result && (
        <section className="border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold">Results</h2>

          <div className="text-sm">
            <div
              className={`inline-block px-3 py-1 rounded font-semibold ${
                result.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              {result.ok ? '✅ Success' : '❌ Failed'}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 p-3 rounded">
              <div className="font-semibold text-gray-700">Duration</div>
              <div className="font-mono text-lg">{result.processingDurationMs}ms</div>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <div className="font-semibold text-gray-700">Cost</div>
              <div className="font-mono text-lg">${result.cost.toFixed(4)}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <div className="font-semibold text-gray-700">Lead ID</div>
              <div className="font-mono text-xs">{result.leadId.slice(0, 12)}...</div>
            </div>
          </div>

          {result.error && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <div className="font-semibold text-red-800">{result.error.code}</div>
              <div className="text-sm text-red-700">{result.error.message}</div>
            </div>
          )}

          {result.data && (
            <div className="space-y-4">
              {/* Website Snapshot */}
              {result.data.website_snapshot && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">📸 Website Snapshot</h3>
                  <div className="bg-gray-50 p-3 rounded text-xs space-y-1 overflow-x-auto">
                    <pre>{JSON.stringify(result.data.website_snapshot, null, 2).slice(0, 500)}</pre>
                  </div>
                </div>
              )}

              {/* Business Signals */}
              {result.data.business_signals && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">🎯 Business Signals</h3>
                  <div className="bg-gray-50 p-3 rounded text-xs space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(result.data.business_signals).map(([key, value]) => (
                        <div key={key}>
                          <span className="font-mono text-xs text-gray-700">{key}:</span>{' '}
                          {String(value)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Commercial Profile */}
              {result.data.commercial_profile && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">💼 Commercial Profile</h3>
                  <div className="bg-gray-50 p-3 rounded text-sm space-y-2">
                    <div>
                      <div className="font-semibold text-gray-700">Summary</div>
                      <div>{result.data.commercial_profile.summary}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="font-semibold text-gray-700">Industry</div>
                        <div>{result.data.commercial_profile.industry}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-700">Category</div>
                        <div>{result.data.commercial_profile.business_category}</div>
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-700">Keywords</div>
                      <div className="flex gap-1 flex-wrap">
                        {result.data.commercial_profile.keywords.map((kw: string) => (
                          <span key={kw} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
