/**
 * ClickStack Icon
 * A stylized database/stack icon with the brand yellow color
 */
export default function Icon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Stack of database layers */}
      <ellipse
        cx="256"
        cy="128"
        rx="180"
        ry="60"
        fill="var(--color-bg-brand)"
      />
      <path
        d="M76 128v80c0 33.137 80.589 60 180 60s180-26.863 180-60v-80c0 33.137-80.589 60-180 60S76 161.137 76 128z"
        fill="var(--color-bg-brand)"
        opacity="0.8"
      />
      <path
        d="M76 208v80c0 33.137 80.589 60 180 60s180-26.863 180-60v-80c0 33.137-80.589 60-180 60S76 241.137 76 208z"
        fill="var(--color-bg-brand)"
        opacity="0.6"
      />
      <path
        d="M76 288v96c0 33.137 80.589 60 180 60s180-26.863 180-60v-96c0 33.137-80.589 60-180 60S76 321.137 76 288z"
        fill="var(--color-bg-brand)"
        opacity="0.4"
      />
      {/* Click/cursor arrow overlay */}
      <path
        d="M340 240l-60 160 20-60 60-20-20-80z"
        fill="var(--color-text-inverted)"
        stroke="var(--color-bg-brand)"
        strokeWidth="8"
      />
    </svg>
  );
}
