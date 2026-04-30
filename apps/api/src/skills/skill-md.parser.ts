export interface ParsedSkillMd {
  name: string;
  description: string;
  version: string;
  errors: string[];
}

export function parseSkillMd(content: string): ParsedSkillMd {
  const errors: string[] = [];
  const normalized = content.replace(/\r\n/g, "\n");
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---/);
  const fields = new Map<string, string>();

  if (!frontmatter) {
    errors.push("SKILL.md must start with YAML frontmatter");
  } else {
    for (const line of frontmatter[1]?.split("\n") ?? []) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        fields.set(match[1] ?? "", (match[2] ?? "").replace(/^["']|["']$/g, ""));
      }
    }
  }

  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  const version = fields.get("version") ?? "0.1.0";

  if (!name) {
    errors.push("SKILL.md frontmatter must include name");
  }
  if (!description) {
    errors.push("SKILL.md frontmatter must include description");
  }

  return { name, description, version, errors };
}
