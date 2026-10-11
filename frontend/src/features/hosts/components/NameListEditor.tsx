import { type KeyboardEvent, useId, useState } from "react";
import { Button, Code, Field, Input, Tag } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { moveItem } from "../lib/hosts";

export interface NameListEditorProps {
  label: string;
  hint?: string;
  error?: string;
  /** Toegankelijke naam van de knop "Toevoegen", bv. "Thema toevoegen". */
  addLabel: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Bekende namen (keuzelijst); een vrije naam mag ook. */
  options: readonly string[];
  /** Of `options` geladen is (anders geen "onbekend"-label). */
  optionsKnown: boolean;
  max: number;
  disabled?: boolean;
  /** Voor tests en styling, bv. `styles`. */
  name: string;
}

/**
 * Geordende lijst namen (thema's of scripts): kiezen uit de keuzelijst of vrij typen, toevoegen
 * (ook met Enter), weghalen en een plaats op of neer schuiven. De volgorde is de laadvolgorde.
 */
export function NameListEditor({
  label,
  hint,
  error,
  addLabel,
  value,
  onChange,
  options,
  optionsKnown,
  max,
  disabled = false,
  name,
}: NameListEditorProps) {
  const { t } = useI18n();
  const listId = useId();
  const [draft, setDraft] = useState("");
  const full = value.length >= max;
  const candidates = options.filter((option) => !value.includes(option));

  const add = () => {
    const next = draft.trim();
    if (!next || full) return;
    if (!value.includes(next)) onChange([...value, next]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter voegt toe in plaats van het formulier te versturen.
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };

  return (
    <Field label={label} hint={hint} error={error}>
      <div data-name-list={name}>
        {value.length === 0 ? (
          <p className="m-0 mb-1.5 text-[12.5px] text-dim">{t("hosts.listEmpty")}</p>
        ) : (
          <ol className="m-0 mb-1.5 list-none p-0">
            {value.map((item, index) => (
              <li
                key={item}
                data-item={item}
                className="mb-1 flex min-w-0 items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5"
              >
                <span aria-hidden className="w-5 flex-none text-right text-[11.5px] text-dim">
                  {index + 1}.
                </span>
                <Code className="min-w-0 flex-1">{item}</Code>
                {optionsKnown && !options.includes(item) && (
                  <Tag tone="mid" title={t("hosts.unknownHint")}>
                    {t("hosts.unknownName")}
                  </Tag>
                )}
                <span className="flex flex-none gap-1">
                  <Button
                    variant="mini"
                    size="icon"
                    aria-label={t("hosts.moveUp", { name: item })}
                    title={t("hosts.moveUp", { name: item })}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveItem(value, index, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="mini"
                    size="icon"
                    aria-label={t("hosts.moveDown", { name: item })}
                    title={t("hosts.moveDown", { name: item })}
                    disabled={disabled || index === value.length - 1}
                    onClick={() => onChange(moveItem(value, index, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="mini"
                    size="icon"
                    tone="danger"
                    aria-label={t("hosts.remove", { name: item })}
                    title={t("hosts.remove", { name: item })}
                    disabled={disabled}
                    onClick={() => onChange(value.filter((other) => other !== item))}
                  >
                    ✕
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="flex min-w-0 gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            list={listId}
            placeholder={full ? t("hosts.listFull", { max }) : t("hosts.choosePlaceholder")}
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            disabled={disabled || full}
          />
          <Button
            variant="alt"
            size="sm"
            aria-label={addLabel}
            disabled={disabled || full || !draft.trim()}
            onClick={add}
            className="flex-none"
          >
            + {t("hosts.add")}
          </Button>
        </div>
        <datalist id={listId}>
          {candidates.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>
    </Field>
  );
}
