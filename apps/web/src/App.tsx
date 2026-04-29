import { useQuery } from "@apollo/client";
import { Button } from "@base-ui/react/button";
import { Boxes, KeyRound, Settings, Upload, UsersRound } from "lucide-react";
import { DASHBOARD_QUERY, PROVIDER_PROFILES_QUERY, SKILLS_QUERY } from "./graphql";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface ProviderProfile {
  id: string;
  displayName: string;
  baseUrl: string;
  defaultModel: string;
  defaultImageModel?: string;
  capabilities: string[];
  hasApiKey: boolean;
}

interface Skill {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface DashboardData {
  currentUser: {
    id: string;
    displayName: string;
  };
  workspacesForCurrentUser: Workspace[];
}

interface ProviderProfilesData {
  providerProfiles: ProviderProfile[];
}

interface SkillsData {
  skills: Skill[];
}

export function App() {
  const dashboard = useQuery<DashboardData>(DASHBOARD_QUERY);
  const activeWorkspace = dashboard.data?.workspacesForCurrentUser[0];
  const providers = useQuery<ProviderProfilesData>(PROVIDER_PROFILES_QUERY, {
    variables: { workspaceId: activeWorkspace?.id ?? "" },
    skip: !activeWorkspace
  });
  const skills = useQuery<SkillsData>(SKILLS_QUERY, {
    variables: { workspaceId: activeWorkspace?.id ?? "" },
    skip: !activeWorkspace
  });

  const providerRows = providers.data?.providerProfiles ?? [];
  const skillRows = skills.data?.skills ?? [];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">GI</div>
          <div>
            <strong>Gen Image Studio</strong>
            <span>Workspace image ops</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <Button className="nav-item active">
            <Boxes size={18} />
            Studio
          </Button>
          <Button className="nav-item">
            <Upload size={18} />
            Skills
          </Button>
          <Button className="nav-item">
            <KeyRound size={18} />
            Providers
          </Button>
          <Button className="nav-item">
            <UsersRound size={18} />
            Members
          </Button>
          <Button className="nav-item">
            <Settings size={18} />
            Settings
          </Button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{dashboard.data?.currentUser.displayName ?? "Loading user"}</p>
            <h1>{activeWorkspace?.name ?? "Workspace setup"}</h1>
          </div>
          <div className="topbar-actions">
            <Button className="secondary-button">
              <UsersRound size={18} />
              Invite
            </Button>
            <Button className="primary-button">
              <Upload size={18} />
              Upload Skill
            </Button>
          </div>
        </header>

        <div className="content-grid">
          <section className="panel wide">
            <div className="panel-header">
              <div>
                <h2>Provider Profiles</h2>
                <p>User-owned endpoints, models, capabilities, and server-only API keys.</p>
              </div>
              <Button className="secondary-button">
                <KeyRound size={18} />
                Add Provider
              </Button>
            </div>
            <div className="table">
              <div className="table-row table-head">
                <span>Name</span>
                <span>Base URL</span>
                <span>Model</span>
                <span>Capabilities</span>
              </div>
              {providerRows.length === 0 ? (
                <div className="empty-row">No provider profiles yet.</div>
              ) : (
                providerRows.map((profile) => (
                  <div className="table-row" key={profile.id}>
                    <strong>{profile.displayName}</strong>
                    <span>{profile.baseUrl}</span>
                    <span>{profile.defaultImageModel ?? profile.defaultModel}</span>
                    <span>{profile.capabilities.join(", ") || "None"}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header compact">
              <div>
                <h2>Agent Skills</h2>
                <p>Indexed from SKILL.md metadata.</p>
              </div>
            </div>
            <div className="skill-list">
              {skillRows.length === 0 ? (
                <div className="empty-block">Upload an Agent Skills package to validate and index it.</div>
              ) : (
                skillRows.map((skill) => (
                  <article className="skill-item" key={skill.id}>
                    <strong>{skill.name}</strong>
                    <span>{skill.slug}</span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header compact">
              <div>
                <h2>Workspace Access</h2>
                <p>Shared resources are scoped by membership.</p>
              </div>
            </div>
            <div className="metric-list">
              <div>
                <span>Members</span>
                <strong>1</strong>
              </div>
              <div>
                <span>Roles</span>
                <strong>4</strong>
              </div>
              <div>
                <span>Secret exposure</span>
                <strong>Redacted</strong>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

