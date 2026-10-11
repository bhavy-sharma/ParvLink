// Small inline icon set (24×24, stroke). Decorative by default.

function Icon({ children, className = "size-5", ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props) => (
  <Icon {...props}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v9.5h13V10" />
  </Icon>
);

export const UserIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
  </Icon>
);

export const ShieldIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6l-7-2.5Z" />
  </Icon>
);

export const BuildingIcon = (props) => (
  <Icon {...props}>
    <path d="M4 20.5h16" />
    <path d="M6.5 20.5V5.5l7-2v17" />
    <path d="M13.5 9.5h4v11" />
    <path d="M9.3 8.5h1.4M9.3 12h1.4M9.3 15.5h1.4" />
  </Icon>
);

export const UsersIcon = (props) => (
  <Icon {...props}>
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M2.8 19.5c.9-3 3.2-4.6 6.2-4.6s5.3 1.6 6.2 4.6" />
    <path d="M15.5 5.6a3.3 3.3 0 0 1 0 5.9M17.8 15.3c1.700.6 2.800 2 3.400 4.200" />
  </Icon>
);

export const GridIcon = (props) => (
  <Icon {...props}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);

export const CheckIcon = (props) => (
  <Icon {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
