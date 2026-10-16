-- The one configuration row the research controls need (default: research OFF, every limit unset, nobody allowed). Not customer data.
INSERT INTO public.ci_research_controls (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
