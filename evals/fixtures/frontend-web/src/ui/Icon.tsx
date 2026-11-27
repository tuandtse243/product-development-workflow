/** The icons of the app's sprite (`/icons.svg`), by key. */
export type IconName = "icon-calendar" | "icon-calendar-off" | "icon-chevron-right" | "icon-clock" | "icon-check" | "icon-close";

export interface IconProps {
  name: IconName;
  /** what the icon means, for a screen reader; without it the icon is decoration and hidden from assistive technology */
  label?: string;
}

export function Icon({ name, label }: IconProps) {
  return (
    <svg className="icon" width="16" height="16" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <use href={`/icons.svg#${name}`} />
    </svg>
  );
}
