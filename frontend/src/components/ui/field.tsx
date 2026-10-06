import { type ComponentProps, createContext, type ReactNode, useContext, useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Formulierelementen in aiverslag-stijl. `Field` koppelt label, hint en foutmelding aan het
 * invoerveld erin (id, `aria-describedby`, `aria-invalid`) via context, zodat
 * `<Field label="Naam"><Input /></Field>` toegankelijk is zonder handmatige ids.
 */

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldControl<
  P extends { id?: string; "aria-describedby"?: string; "aria-invalid"?: unknown },
>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}

/** Klein label in hoofdletters (`.lbl`). */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "mt-3.5 mb-1 block text-[11.5px] tracking-[.08em] text-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Foutmelding; maakt het veld ook `aria-invalid`. */
  error?: ReactNode;
  /** Eigen id voor het invoerveld (anders automatisch). */
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, id, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `field-${auto}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={controlId}>{label}</Label>
      <FieldContext value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
        {children}
      </FieldContext>
      {hint && (
        <p id={hintId} className="mt-1 text-[12px] leading-[1.5] text-dim">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-[12px] leading-[1.5] text-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const controlBase = [
  "w-full min-w-0 rounded-[10px] border border-line-strong bg-black/40 px-3 py-2.5",
  "font-mono text-[13.5px] text-white outline-none transition-colors",
  "focus:border-focus focus-visible:outline-none",
  "aria-invalid:border-err disabled:cursor-not-allowed disabled:opacity-50",
];

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  const control = useFieldControl(props);
  return <input type={type} className={cn(controlBase, className)} {...control} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  const control = useFieldControl(props);
  return (
    <textarea
      className={cn(controlBase, "min-h-24 resize-y leading-[1.55]", className)}
      {...control}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  const control = useFieldControl(props);
  return (
    <select
      className={cn(
        controlBase,
        "ui-select bg-[#2a2a2a] pr-8 text-white [color-scheme:dark]",
        className,
      )}
      {...control}
    />
  );
}

export type CheckboxProps = Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
};

/** Checkbox met label (`.chk`): klein, grijs, hele label klikbaar. */
export function Checkbox({ label, className, disabled, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 text-[12.5px] text-muted select-none",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        disabled={disabled}
        className="size-3.5 accent-[#bbb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        {...props}
      />
      {label}
    </label>
  );
}
