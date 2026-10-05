import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, MouseEvent } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/utils";
import { useRipple } from "./ripple";

/**
 * Knoppen zoals aiverslag: `primary` = grijze `.btn` met gloed, `alt` = glas met rand,
 * `danger` = glas met rode hover, `mini` = kleine knop voor rijen en tabs.
 * Een "aan"-toestand (actieve navigatie, geselecteerde tab, ingedrukte toggle) volgt uit
 * `aria-current="page"`, `aria-selected="true"` of `aria-pressed="true"`.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap",
    "border font-mono select-none no-underline",
    "transition-[background-color,color,box-shadow,border-color,transform] duration-200",
    "active:not-disabled:scale-[.96]",
    "disabled:cursor-default disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
  ],
  {
    variants: {
      variant: {
        primary: [
          "rounded-[10px] border-transparent bg-btn font-bold text-[#eee]",
          "hover:not-disabled:bg-btn-hover hover:not-disabled:text-white hover:not-disabled:shadow-glow",
        ],
        alt: [
          "rounded-[10px] border-line-strong bg-white/6 font-bold text-fg",
          "hover:not-disabled:bg-white/12 hover:not-disabled:text-white hover:not-disabled:shadow-glow",
        ],
        danger: [
          "rounded-[10px] border-line-strong bg-white/6 font-bold text-fg",
          "hover:not-disabled:bg-danger hover:not-disabled:text-white hover:not-disabled:shadow-glow",
        ],
        mini: [
          "rounded-[7px] border-white/12 bg-white/7 px-2.5 py-[5px] text-[12.5px] font-normal text-fg",
          "hover:not-disabled:bg-white/16 hover:not-disabled:text-white",
        ],
      },
      size: {
        default: "",
        sm: "",
        icon: "",
      },
      tone: {
        default: "",
        ok: "hover:not-disabled:bg-ok/15 hover:not-disabled:text-ok",
        danger: "hover:not-disabled:bg-err/15 hover:not-disabled:text-err",
      },
    },
    compoundVariants: [
      {
        variant: ["primary", "alt", "danger"],
        size: "default",
        className: "px-5 py-3 text-[13.5px]",
      },
      { variant: ["primary", "alt", "danger"], size: "sm", className: "px-3.5 py-2 text-[13px]" },
      { variant: ["primary", "alt", "danger"], size: "icon", className: "size-10 p-0 text-[15px]" },
      { variant: "mini", size: "icon", className: "size-7 px-0 py-0" },
      {
        variant: ["alt", "danger"],
        className: [
          "aria-[current=page]:border-white/40 aria-[current=page]:bg-white/18 aria-[current=page]:text-white",
          "aria-pressed:border-white/40 aria-pressed:bg-white/18 aria-pressed:text-white",
        ],
      },
      {
        variant: "mini",
        className: [
          "aria-[current=page]:bg-white/20 aria-[current=page]:text-white",
          "aria-selected:bg-white/20 aria-selected:text-white",
          "aria-pressed:bg-white/20 aria-pressed:text-white",
        ],
      },
    ],
    defaultVariants: { variant: "primary", size: "default", tone: "default" },
  },
);

type Variants = VariantProps<typeof buttonVariants>;

interface RippleProp {
  /** Ripple bij klik; standaard aan, behalve voor `mini`. */
  ripple?: boolean;
}

export type ButtonProps = ComponentProps<"button"> & Variants & RippleProp;

export function Button({
  className,
  variant,
  size,
  tone,
  ripple,
  type = "button",
  onClick,
  children,
  ...props
}: ButtonProps) {
  const { trigger, ripples } = useRipple(ripple ?? variant !== "mini");
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, tone }), className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        trigger(event);
        onClick?.(event);
      }}
      {...props}
    >
      {children}
      {ripples}
    </button>
  );
}

export type ButtonLinkProps = LinkProps &
  Variants &
  RippleProp & {
    /** Markeert de link als huidige pagina (`aria-current="page"`). */
    active?: boolean;
  };

/** Een router-link in knopstijl (bv. de navigatie); standaard variant `alt`. */
export function ButtonLink({
  className,
  variant = "alt",
  size,
  tone,
  ripple,
  active,
  onClick,
  children,
  ...props
}: ButtonLinkProps) {
  const { trigger, ripples } = useRipple(ripple ?? variant !== "mini");
  return (
    <Link
      className={cn(buttonVariants({ variant, size, tone }), className)}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        trigger(event);
        onClick?.(event);
      }}
      {...props}
    >
      {children}
      {ripples}
    </Link>
  );
}
