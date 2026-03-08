"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ScrapeForm() {
  const [mode, setMode] = useState<"search" | "directory">("search");
  const [startUrl, setStartUrl] = useState("");
  const [listingUrlIncludes, setListingUrlIncludes] = useState("/listing");
  const [maxPages, setMaxPages] = useState("3");
  const [maxLeads, setMaxLeads] = useState("40");
  const [city, setCity] = useState("Montreal");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRun = async () => {
    if (!startUrl) {
      setStatus("Provide a starting URL from a public directory.");
      return;
    }

    setLoading(true);
    setStatus(null);
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        startUrl,
        listingUrlIncludes: listingUrlIncludes || null,
        maxPages: Number(maxPages),
        maxLeads: Number(maxLeads),
        city,
        sourceType: mode,
        notes
      })
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? "Scrape failed.");
      setLoading(false);
      return;
    }

    setStatus(`Scrape completed. ${data.leadsCount ?? 0} leads saved.`);
    setLoading(false);
  };

  return (
    <div className="rounded-3xl border border-white/80 bg-white/90 p-6 shadow-soft">
      <Tabs value={mode} onValueChange={(value) => setMode(value as "search" | "directory")}>
        <TabsList>
          <TabsTrigger value="search">Search-based</TabsTrigger>
          <TabsTrigger value="directory">Directory-based</TabsTrigger>
        </TabsList>

        <TabsContent value="search">
          <div className="mt-4 space-y-4">
            <p className="text-sm text-ink/70">
              Use a public directory search URL (example: a Yellow Pages search results page). The crawler
              will follow listing links and extract contact details.
            </p>
            <Input
              placeholder="Paste search results URL"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
            />
          </div>
        </TabsContent>

        <TabsContent value="directory">
          <div className="mt-4 space-y-4">
            <p className="text-sm text-ink/70">
              Use a public business directory category page. The crawler will paginate through pages and
              collect listing links.
            </p>
            <Input
              placeholder="Paste directory URL"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate/60">Listing URL contains</label>
          <Input
            className="mt-2"
            value={listingUrlIncludes}
            onChange={(event) => setListingUrlIncludes(event.target.value)}
            placeholder="/listing"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate/60">Default city</label>
          <Input className="mt-2" value={city} onChange={(event) => setCity(event.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate/60">Max pages to crawl</label>
          <Input className="mt-2" value={maxPages} onChange={(event) => setMaxPages(event.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate/60">Max leads</label>
          <Input className="mt-2" value={maxLeads} onChange={(event) => setMaxLeads(event.target.value)} />
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs uppercase tracking-[0.2em] text-slate/60">Notes for this job</label>
        <Textarea
          className="mt-2"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional notes about the source or intent"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="pine" onClick={handleRun} disabled={loading}>
          {loading ? "Running scrape..." : "Run scrape"}
        </Button>
        {status ? <span className="text-sm text-ink/70">{status}</span> : null}
      </div>
    </div>
  );
}
