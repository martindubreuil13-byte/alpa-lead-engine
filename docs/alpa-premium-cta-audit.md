# ALPA Premium CTA Audit

Date: June 9, 2026

## Scope

- Scanned 376 interactive `button`, `Link`, anchor, checkout, and CTA component usages.
- Reviewed shared action primitives, authentication, landing pages, pricing, dashboard activation, lead generation, lead delivery, exports, onboarding, upgrades, and purchases.
- Standardized 54 primary action usages across 38 UI files.

## Shared Standard

`app/globals.css` now owns the `btn-primary-gold` variant.

- Base: `#D8C28A`
- Hover: `#E2CF9A`
- Pressed: `#CBB57A`
- Text: `#081225`
- Height: `60px`
- Radius: `13px`
- Horizontal padding: `28px`
- Transition: `250ms`
- Glow: `rgba(216, 194, 138, 0.25)`

The legacy `btn-conversion` selector remains as a compatibility alias, but all audited UI call sites use `btn-primary-gold`.

## CTAs Converted

### Acquisition and landing pages

- Homepage: `Get 25 Free Leads`, `Start free`, and final `Get 25 free leads`
- About page: `Get 25 Free Leads`
- Resources index and all lead-generation resource articles: `Get 25 Free Leads`

### Authentication and activation

- Login/signup submit: `Continue` and `Create account`
- Post-checkout account creation: `Create my account`
- Free-trial search: `Run free lead search`
- Trial lead delivery: `Send my leads`
- Trial result progression: `View leads` and `Run another free search`
- Prospector onboarding: `Start Prospecting`
- Agent setup: `Build my strategy` and `Activate Mission`

### Pricing, upgrades, and purchases

- Plan cards: `Start Free`, `Start Prospecting`, and `Start Building`
- Pricing footer free and paid CTAs
- Dashboard checkout cards: `Activate command center`
- Dashboard shell: `Unlock full access`
- Billing page: `Upgrade to Starter`
- Feature-lock notices and modals: upgrade/unlock actions
- Trial-limit checkout: `Start Prospecting - $9.99/mo`
- Locked outreach modal: `Upgrade`

### Lead delivery and export

- Prospector completion: `Download leads` and `View my leads`
- Trial leads: `Download CSV` and `Send to my email`
- Selected leads: `Export CSV`
- Lead library export actions
- Lead delivery modal: `Save my leads`
- Partial completion modal: `View my leads`
- First-success modal: `Continue Prospecting`

## Intentionally Unchanged

These remain dark, neutral, blue, green, or status-specific because they are navigation, utility, data, or operational controls rather than conversion actions.

- Header and dashboard navigation
- `Learn more`, `View Plans`, documentation, contact, back, cancel, close, dismiss, and skip actions
- Search fields, filters, selectors, tabs, checkboxes, pagination, and view toggles
- Save settings, save template, edit, delete, copy, archive, and pipeline-management controls
- Send email/campaign execution controls
- Generate drafts and other operator workflow actions
- Mission pause, resume, relaunch, scheduling, and status controls
- Admin analytics exports and admin-only operational controls
- Blue statuses, charts, progress indicators, lead states, and selected states
- `OperationalLeadPreview` export controls, which are non-interactive product mockup elements

## Inconsistencies Removed

- Multiple blue/cyan marketing gradients used for signup, upgrade, onboarding, and checkout
- Mixed CTA heights from 42px to 58px
- Mixed radii from `rounded-lg` to `rounded-2xl`
- Local cyan checkout styles in dashboard activation cards
- Blue export actions in user-facing lead workflows
- Green or blue activation actions in agent onboarding
- Duplicated glow and hover definitions across landing and resource pages

## Files Modified

Core system:

- `app/globals.css`

Landing and acquisition:

- `app/page.tsx`
- `app/about/page.tsx`
- `app/resources/page.tsx`
- All 15 article pages under `app/resources/*/page.tsx`

Authentication, pricing, and billing:

- `app/login/page.tsx`
- `app/plans/page.tsx`
- `app/dashboard/billing/page.tsx`
- `components/auth/PostCheckoutAccountForm.tsx`
- `components/plans/PlanCard.tsx`
- `components/access/FeatureLockNotice.tsx`
- `components/modals/FeatureLockModal.tsx`
- `components/scraper/TrialLimitModal.tsx`

Dashboard, activation, and lead workflows:

- `app/dashboard/page.tsx`
- `app/dashboard/scraper/page.tsx`
- `app/dashboard/leads/LeadsPageClient.tsx`
- `app/dashboard/library/page.tsx`
- `app/dashboard/enrich/page.tsx`
- `app/agent/setup/page.tsx`
- `components/dashboard/DashboardShell.tsx`
- `components/email/SendCampaignModal.tsx`
- `components/landing/FreeTrialCommandFlow.tsx`
- `components/modals/FirstSuccessModal.tsx`
- `components/modals/PartialCompletionModal.tsx`
- `components/modals/SendLeadsModal.tsx`
- `components/scraper/FirstRunOverlay.tsx`
- `components/scraper/ProspectorOnboardingOverlay.tsx`

## Final Hierarchy

- Gold: acquisition, signup, activation, lead delivery/export, upgrade, and purchase
- Dark: secondary, navigation, exploration, and utility
- Blue: product state, data, selection, and interface information
