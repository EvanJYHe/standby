import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3v3M18 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function AgentIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3v3M7 10h.01M17 10h.01M8 15h8M5 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 2V8a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function TelegramIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 11.3 15.2-6.1c.7-.3 1.3.4 1.1 1.1l-2.6 12.2c-.2.8-1.1 1.1-1.7.6l-4-3-2 2c-.3.3-.9.1-.9-.4l.1-3.2 8.3-6.2-10.1 5.1-3.2-1.1c-.8-.2-.8-1.2-.2-1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </IconBase>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8.3 4.4 6.7 3.6a2 2 0 0 0-2.6.8c-1.8 3.4.2 8.4 3.5 11.7 3.3 3.3 8.3 5.3 11.7 3.5a2 2 0 0 0 .8-2.6l-.8-1.6a2 2 0 0 0-2.4-1l-2.1.7a15 15 0 0 1-5.6-5.6l.7-2.1a2 2 0 0 0-1-2.4l-.6-.6Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function CustomersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 8a3 3 0 0 1 0 6M19 15.5a3.5 3.5 0 0 1 2 3.17V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.7" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function XIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m13.5 6.5 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9.5 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M6.1 8.4A7 7 0 0 1 18.8 7M5.2 17A7 7 0 0 0 17.9 15.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function GoogleCalendarIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" {...props}>
      <path d="M5 3h10l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="#fff" />
      <path d="M3 8h16v4H3V8Z" fill="#4285F4" />
      <path d="M3 5a2 2 0 0 1 2-2h4v5H3V5Z" fill="#34A853" />
      <path d="M9 3h6l4 4v1H9V3Z" fill="#FBBC04" />
      <path d="M3 12h5v9H5a2 2 0 0 1-2-2v-7Z" fill="#EA4335" />
      <path d="M8 12h11v7a2 2 0 0 1-2 2H8v-9Z" fill="#4285F4" />
      <path d="M11.3 18.3c-.7 0-1.4-.2-1.8-.7l.8-1c.3.3.6.5 1 .5.5 0 .8-.3.8-.7 0-.5-.4-.7-1.1-.7h-.5v-1.1h.5c.6 0 .9-.2.9-.6 0-.4-.3-.6-.7-.6-.4 0-.7.2-1 .5l-.8-.9c.5-.5 1.1-.8 1.9-.8 1.2 0 2 .6 2 1.6 0 .6-.4 1.1-1 1.3.7.2 1.2.7 1.2 1.4 0 1.1-1 1.8-2.2 1.8ZM15.3 18.2v-4.3l-1.1.7-.6-1 2-1.3h1.1v5.9h-1.4Z" fill="#fff" />
    </svg>
  );
}

export function OutlookIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" {...props}>
      <path d="M8 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8V4Z" fill="#1473E6" />
      <path d="m8 9 6.5 4L21 9v9a2 2 0 0 1-2 2H8V9Z" fill="#0D5CBD" />
      <path d="M3 6.5 14 4.8v14.4L3 17.5v-11Z" fill="#0A64C9" />
      <path d="M8.4 9.2c2 0 3.2 1.3 3.2 3.3 0 2.1-1.3 3.4-3.3 3.4S5 14.6 5 12.6c0-2.1 1.3-3.4 3.4-3.4Zm-.1 1.5c-1 0-1.5.7-1.5 1.8 0 1.2.6 1.9 1.6 1.9.9 0 1.5-.7 1.5-1.8 0-1.2-.6-1.9-1.6-1.9Z" fill="#fff" />
    </svg>
  );
}
