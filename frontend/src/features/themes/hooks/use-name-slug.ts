import { useState } from "react";
import { slugIssue, suggestSlug, type SlugIssue } from "../lib/slug";

export interface NameSlugState {
  name: string;
  setName: (name: string) => void;
  /** De slug zoals hij verstuurd wordt: handmatig ingevuld, anders het voorstel uit de naam. */
  slug: string;
  /** Handmatig wijzigen; leegmaken zet het automatische voorstel weer aan. */
  setSlug: (slug: string) => void;
  /** Of de gebruiker de slug zelf heeft aangepast (dan volgt hij de naam niet meer). */
  slugEdited: boolean;
  /** Probleem met de slug (alleen als er een is ingevuld of voorgesteld). */
  issue: SlugIssue | null;
}

/**
 * Naam en slug samen: zolang de slug niet met de hand is gewijzigd, volgt hij live de naam
 * (`Proxmox Nord` → `proxmox-nord`).
 */
export function useNameSlug(initialName = ""): NameSlugState {
  const [name, setName] = useState(initialName);
  const [manualSlug, setManualSlug] = useState<string | null>(null);
  const slug = manualSlug ?? suggestSlug(name);
  return {
    name,
    setName,
    slug,
    setSlug: (value) => setManualSlug(value.trim() ? value : null),
    slugEdited: manualSlug !== null,
    issue: slug ? slugIssue(slug) : null,
  };
}
