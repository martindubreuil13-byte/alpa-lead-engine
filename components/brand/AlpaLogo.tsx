import Image from 'next/image'

type AlpaLogoProps = {
  className?: string
  priority?: boolean
}

export function AlpaLogo({
  className = 'h-8 w-auto',
  priority = false,
}: AlpaLogoProps) {
  return (
    <Image
      src="/brand/alpa-by-mindra-white.png"
      alt="ALPA by MINDRA"
      width={613}
      height={168}
      priority={priority}
      className={className}
    />
  )
}
