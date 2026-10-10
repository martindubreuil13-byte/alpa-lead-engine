import type { FormEvent, MutableRefObject } from 'react'

type DiscoverSearchFormProps = {
  businessType: string
  location: string
  resultCount: string
  resultOptions: string[]
  disabled: boolean
  showValidation: boolean
  missingBusinessType: boolean
  missingLocation: boolean
  validationMessage: string
  usageText: string
  submitDisabled: boolean
  isMobile: boolean
  onBusinessTypeChange: (value: string) => void
  onLocationChange: (value: string) => void
  onResultCountChange: (value: string) => void
  onSubmit: () => void
  businessTypeRef: MutableRefObject<HTMLInputElement | null>
  locationRef: MutableRefObject<HTMLInputElement | null>
}

const FIELD =
  'block w-full border-0 border-b bg-transparent px-0 py-3 text-2xl text-white outline-none transition-colors placeholder:text-base placeholder:font-normal placeholder:text-white/35 disabled:opacity-60 sm:text-3xl sm:placeholder:text-lg'

// The editorial search entry: a serif question, two underlined fields, a quiet result-count
// selector and one gold action. No enclosing card; hairlines do the structure.
export default function DiscoverSearchForm({
  businessType,
  location,
  resultCount,
  resultOptions,
  disabled,
  showValidation,
  missingBusinessType,
  missingLocation,
  validationMessage,
  usageText,
  submitDisabled,
  isMobile,
  onBusinessTypeChange,
  onLocationChange,
  onResultCountChange,
  onSubmit,
  businessTypeRef,
  locationRef,
}: DiscoverSearchFormProps) {
  const typeInvalid = showValidation && missingBusinessType
  const locationInvalid = showValidation && missingLocation

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="dash-rise mx-auto w-full max-w-3xl pt-2 sm:pt-6" noValidate>
      <h1 className="font-display text-[2.75rem] leading-[1.02] tracking-tight text-white/95 sm:text-[4rem]">
        Who are we looking for?
      </h1>

      <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
        <div>
          <label htmlFor="discover-business-type" className="text-xs font-medium uppercase tracking-[0.2em] text-white/70">
            Business type
          </label>
          <input
            id="discover-business-type"
            ref={businessTypeRef}
            value={businessType}
            disabled={disabled}
            onChange={(event) => onBusinessTypeChange(event.target.value)}
            placeholder={isMobile ? 'e.g. dentists, law firms' : 'dentists, law firms, architects'}
            autoComplete="off"
            aria-invalid={typeInvalid}
            aria-describedby="discover-business-type-help"
            className={`${FIELD} ${typeInvalid ? 'border-[#d8c28a]' : 'border-white/25 focus:border-[#d8c28a]'}`}
          />
          <p
            id="discover-business-type-help"
            className={`mt-2 text-xs ${typeInvalid ? 'text-[#d8c28a]' : 'text-white/60'}`}
          >
            {typeInvalid ? 'Add a business type.' : 'Use 1–3 simple keywords.'}
          </p>
        </div>

        <div>
          <label htmlFor="discover-location" className="text-xs font-medium uppercase tracking-[0.2em] text-white/70">
            Location
          </label>
          <input
            id="discover-location"
            ref={locationRef}
            value={location}
            disabled={disabled}
            onChange={(event) => onLocationChange(event.target.value)}
            placeholder={isMobile ? 'e.g. Miami or California' : 'Miami, California, United Kingdom'}
            autoComplete="off"
            aria-invalid={locationInvalid}
            aria-describedby="discover-location-help"
            className={`${FIELD} ${locationInvalid ? 'border-[#d8c28a]' : 'border-white/25 focus:border-[#d8c28a]'}`}
          />
          <p id="discover-location-help" className={`mt-2 text-xs ${locationInvalid ? 'text-[#d8c28a]' : 'text-white/60'}`}>
            {locationInvalid ? 'Add a location.' : 'City, state, province, or country'}
          </p>
        </div>
      </div>

      <fieldset className="mt-10">
        <legend className="text-xs font-medium uppercase tracking-[0.2em] text-white/70">Businesses</legend>
        <div className="mt-3 flex items-center gap-8">
          {resultOptions.map((option) => {
            const selected = resultCount === option
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => onResultCountChange(option)}
                aria-pressed={selected}
                className={`min-h-[44px] border-b-2 px-0.5 font-display text-4xl tabular-nums transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a] ${
                  selected
                    ? 'border-[#d8c28a] text-white'
                    : 'border-transparent text-white/50 hover:text-white/85'
                }`}
              >
                {option}
              </button>
            )
          })}
        </div>
      </fieldset>

      {validationMessage ? (
        <p role="alert" className="mt-8 text-sm text-[#d8c28a]">
          {validationMessage}
        </p>
      ) : null}

      <div className="mt-12 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          disabled={submitDisabled}
          className="btn-primary-gold btn-quiet w-full uppercase tracking-[0.14em] sm:w-auto"
        >
          {disabled ? 'Finding businesses...' : 'Find businesses'}
        </button>
        <p className="text-sm text-white/60">{usageText}</p>
      </div>
    </form>
  )
}
