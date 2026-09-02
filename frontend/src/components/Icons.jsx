/**
 * Application icon set.
 *
 * One stroke-based family (Lucide geometry, 1.5px stroke, 24px grid) drawn
 * inline as SVG, used by both the storefront and the admin panel. Emoji are
 * deliberately not used anywhere: they render differently on every platform,
 * cannot inherit a design token for colour or be sized reliably, and carry
 * their own unwanted announcements in a screen reader. An inline SVG inherits
 * `currentColor` and scales with the type around it.
 *
 * Every icon takes the same props, so callers never special-case one of them.
 * Icons are decorative by default (aria-hidden); the accessible name belongs on
 * the button or link that wraps them. Pass `title` only for an icon that is the
 * sole carrier of meaning.
 */

function Icon({ children, className = 'h-5 w-5', title }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/* — Navigation — */

export const DashboardIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const ProductsIcon = (p) => (
  <Icon {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </Icon>
);

export const CategoriesIcon = (p) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </Icon>
);

export const OrdersIcon = (p) => (
  <Icon {...p}>
    <path d="M8 3h8a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V4a1 1 0 0 1 1-1Z" />
    <path d="M9 12h6M9 16h4" />
  </Icon>
);

export const QueueIcon = (p) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Icon>
);

/* — Actions — */

export const PlusIcon = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const EditIcon = (p) => (
  <Icon {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
);

export const TrashIcon = (p) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

export const SearchIcon = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const RefreshIcon = (p) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Icon>
);

export const CloseIcon = (p) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const MenuIcon = (p) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const ChevronRightIcon = (p) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const ChevronLeftIcon = (p) => (
  <Icon {...p}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
);

export const ChevronDownIcon = (p) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ArrowLeftIcon = (p) => (
  <Icon {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Icon>
);

export const LogoutIcon = (p) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Icon>
);

export const StorefrontIcon = (p) => (
  <Icon {...p}>
    <path d="M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z" />
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M9 21v-6h6v6" />
  </Icon>
);

/* — Status / metrics — */

export const RevenueIcon = (p) => (
  <Icon {...p}>
    <path d="M12 2v20" />
    <path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3" />
  </Icon>
);

export const AlertIcon = (p) => (
  <Icon {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </Icon>
);

export const CheckIcon = (p) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const ClockIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const RetryIcon = (p) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 2.6-6.4" />
    <path d="M3 3v6h6" />
  </Icon>
);

/* — Storefront — */

export const CartIcon = (p) => (
  <Icon {...p}>
    <circle cx="9" cy="20" r="1.5" />
    <circle cx="18" cy="20" r="1.5" />
    <path d="M2 3h2.5l2.4 12.1a1.5 1.5 0 0 0 1.5 1.2h9.1a1.5 1.5 0 0 0 1.5-1.2L21 7H5.2" />
  </Icon>
);

export const BellIcon = (p) => (
  <Icon {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </Icon>
);

export const BellOffIcon = (p) => (
  <Icon {...p}>
    <path d="M8.7 3.9A6 6 0 0 1 18 8c0 2.3.3 3.9.7 5" />
    <path d="M17 17H4s2-1 2-7a6 6 0 0 1 .6-2.6" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    <path d="m2 2 20 20" />
  </Icon>
);

/** Placeholder for a product with no image, and the empty-cart / catalogue mark. */
export const BoxIcon = (p) => (
  <Icon {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </Icon>
);

export const CompassIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5Z" />
  </Icon>
);

export const LockIcon = (p) => (
  <Icon {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Icon>
);

/** Loss of connection — distinct from AlertIcon, which means "something failed". */
export const PlugOffIcon = (p) => (
  <Icon {...p}>
    <path d="M9 3v5M15 3v3" />
    <path d="M5.5 8h13v2a6.5 6.5 0 0 1-9 6" />
    <path d="M12 16.5V21" />
    <path d="m2 2 20 20" />
  </Icon>
);