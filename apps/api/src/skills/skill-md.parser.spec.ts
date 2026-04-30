import { describe, expect, it } from "vitest";
import { parseSkillMd } from "./skill-md.parser";

describe("parseSkillMd", () => {
  it("parses Agent Skill frontmatter", () => {
    const parsed = parseSkillMd(`---
name: image-style
description: Creates images in a house style.
version: 1.2.3
---

# Image Style
`);

    expect(parsed).toMatchObject({
      name: "image-style",
      description: "Creates images in a house style.",
      version: "1.2.3",
      errors: []
    });
  });

  it("rejects content without required discovery metadata", () => {
    const parsed = parseSkillMd("# Missing frontmatter");
    expect(parsed.errors).toContain("SKILL.md must start with YAML frontmatter");
    expect(parsed.errors).toContain("SKILL.md frontmatter must include name");
    expect(parsed.errors).toContain("SKILL.md frontmatter must include description");
  });

  it("accepts CRLF frontmatter", () => {
    const parsed = parseSkillMd("---\r\nname: windows-skill\r\ndescription: Works with CRLF.\r\n---\r\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.name).toBe("windows-skill");
  });
});
