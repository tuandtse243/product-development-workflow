import type { ComponentPropsWithRef } from "react";

type Variant = "primary" | "secondary" | "quiet";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
}

/** The app's button: a native `<button>` (type "button" unless told otherwise) styled by its variant. */
export function Button({ variant = "secondary", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={["btn", `btn--${variant}`, className].filter(Boolean).join(" ")} {...rest} />;
}
