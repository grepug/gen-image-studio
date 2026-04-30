import { useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Button } from "@base-ui/react/button";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Boxes, KeyRound, Settings, Upload, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ADD_WORKSPACE_MEMBER,
  CURRENT_USER_QUERY,
  CREATE_PROVIDER_PROFILE,
  FINISH_PASSKEY_AUTHENTICATION,
  FINISH_PASSKEY_REGISTRATION,
  GENERATION_JOBS_QUERY,
  LOGIN_WITH_PASSWORD,
  LOGOUT,
  PROVIDER_PROFILES_QUERY,
  REMOVE_WORKSPACE_MEMBER,
  RUN_IMAGE_GENERATION_JOB,
  SKILLS_QUERY,
  START_PASSKEY_AUTHENTICATION,
  START_PASSKEY_REGISTRATION,
  UPLOAD_SKILL,
  UPDATE_WORKSPACE_MEMBER_ROLE,
  WORKSPACE_MEMBERS_QUERY,
  WORKSPACES_QUERY
} from "./graphql";

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

interface GenerationJobOutput {
  id: string;
  label: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
}

interface GenerationJobEvent {
  id: string;
  type: string;
  message?: string;
  createdAt: string;
}

interface GenerationJob {
  id: string;
  status: string;
  prompt: string;
  events: GenerationJobEvent[];
  outputs: GenerationJobOutput[];
}

type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

interface DashboardData {
  currentUser: {
    id: string;
    displayName: string;
  } | null;
}

interface WorkspacesData {
  workspacesForCurrentUser: Workspace[];
}

interface ProviderProfilesData {
  providerProfiles: ProviderProfile[];
}

interface SkillsData {
  skills: Skill[];
}

interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  displayName: string;
  email?: string;
  role: WorkspaceRole;
}

interface WorkspaceMembersData {
  workspaceMembers: WorkspaceMember[];
}

interface GenerationJobsData {
  generationJobs: GenerationJob[];
}

interface RunGenerationData {
  runImageGenerationJob: GenerationJob;
}

interface LoggedInUser {
  userId: string;
  displayName: string;
  email: string;
}

export function App() {
  const apollo = useApolloClient();
  const [email, setEmail] = useState("tester1@example.test");
  const [password, setPassword] = useState("test-password-1");
  const [providerName, setProviderName] = useState("Local OpenAI Compatible");
  const [providerBaseUrl, setProviderBaseUrl] = useState("https://api.example.test/v1");
  const [providerModel, setProviderModel] = useState("gpt-image-test");
  const [providerApiKey, setProviderApiKey] = useState("test-key");
  const [memberEmail, setMemberEmail] = useState("tester2@example.test");
  const [memberRole, setMemberRole] = useState<WorkspaceRole>("member");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [skillFile, setSkillFile] = useState<File | null>(null);
  const [generationProviderId, setGenerationProviderId] = useState("");
  const [generationSkillId, setGenerationSkillId] = useState("");
  const [generationPrompt, setGenerationPrompt] = useState("Create a clean studio image using this skill.");
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const currentUserQuery = useQuery<DashboardData>(CURRENT_USER_QUERY, {
    fetchPolicy: "cache-and-network"
  });
  const [loginWithPassword, loginState] = useMutation(LOGIN_WITH_PASSWORD);
  const [logoutMutation] = useMutation(LOGOUT);
  const [startPasskeyRegistrationMutation] = useMutation(START_PASSKEY_REGISTRATION);
  const [finishPasskeyRegistrationMutation] = useMutation(FINISH_PASSKEY_REGISTRATION);
  const [startPasskeyAuthenticationMutation] = useMutation(START_PASSKEY_AUTHENTICATION);
  const [finishPasskeyAuthenticationMutation] = useMutation(FINISH_PASSKEY_AUTHENTICATION);
  const [createProviderProfile, providerMutation] = useMutation(CREATE_PROVIDER_PROFILE);
  const [uploadSkill, skillMutation] = useMutation(UPLOAD_SKILL);
  const [runGenerationJob, generationMutation] = useMutation<RunGenerationData>(RUN_IMAGE_GENERATION_JOB);
  const [addWorkspaceMember, addMemberMutation] = useMutation(ADD_WORKSPACE_MEMBER);
  const [updateWorkspaceMemberRole, updateMemberMutation] = useMutation(UPDATE_WORKSPACE_MEMBER_ROLE);
  const [removeWorkspaceMember, removeMemberMutation] = useMutation(REMOVE_WORKSPACE_MEMBER);
  const currentUser = currentUserQuery.data?.currentUser;
  const workspaces = useQuery<WorkspacesData>(WORKSPACES_QUERY, {
    skip: !currentUser
  });
  const workspaceRows = workspaces.data?.workspacesForCurrentUser ?? [];
  const activeWorkspace =
    workspaceRows.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaceRows[0];
  const providers = useQuery<ProviderProfilesData>(PROVIDER_PROFILES_QUERY, {
    variables: { workspaceId: activeWorkspace?.id ?? "" },
    skip: !activeWorkspace
  });
  const skills = useQuery<SkillsData>(SKILLS_QUERY, {
    variables: { workspaceId: activeWorkspace?.id ?? "" },
    skip: !activeWorkspace
  });
  const members = useQuery<WorkspaceMembersData>(WORKSPACE_MEMBERS_QUERY, {
    variables: { workspaceId: activeWorkspace?.id ?? "" },
    skip: !activeWorkspace
  });
  const generationJobs = useQuery<GenerationJobsData>(GENERATION_JOBS_QUERY, {
    variables: { workspaceId: activeWorkspace?.id ?? "" },
    skip: !activeWorkspace
  });

  const providerRows = providers.data?.providerProfiles ?? [];
  const skillRows = skills.data?.skills ?? [];
  const memberRows = members.data?.workspaceMembers ?? [];
  const jobRows = generationJobs.data?.generationJobs ?? [];
  const selectedProviderId = providerRows.some((profile) => profile.id === generationProviderId)
    ? generationProviderId
    : providerRows[0]?.id || "";
  const selectedSkillId = skillRows.some((skill) => skill.id === generationSkillId)
    ? generationSkillId
    : skillRows[0]?.id || "";
  const latestJob = generationMutation.data?.runImageGenerationJob ?? jobRows[0];
  const currentUserName = currentUser?.displayName ?? "Loading user";
  const loginError = loginState.error?.message;
  const providerError = providerMutation.error?.message;
  const generationError = generationMutation.error?.message;
  const memberError = addMemberMutation.error?.message ?? updateMemberMutation.error?.message ?? removeMemberMutation.error?.message;
  const skillResult = skillMutation.data?.uploadSkill;
  const skillErrors = useMemo(() => skillResult?.version.validationErrors ?? [], [skillResult]);

  useEffect(() => {
    setGenerationProviderId("");
    setGenerationSkillId("");
  }, [activeWorkspace?.id]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginMessage(null);
    const result = await loginWithPassword({ variables: { email, password } });
    const user = result.data?.loginWithPassword as LoggedInUser | undefined;
    if (user) {
      await apollo.resetStore();
      return;
    }
    setLoginMessage("Invalid test login credentials");
  }

  async function handlePasskeySignIn() {
    setLoginMessage(null);
    try {
      const started = await startPasskeyAuthenticationMutation();
      const payload = started.data?.startPasskeyAuthentication as { challengeId: string; optionsJson: string } | undefined;
      if (!payload) return;
      const response = await startAuthentication({ optionsJSON: JSON.parse(payload.optionsJson) });
      await finishPasskeyAuthenticationMutation({
        variables: { challengeId: payload.challengeId, responseJson: JSON.stringify(response) }
      });
      await apollo.resetStore();
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "Passkey sign-in failed");
    }
  }

  async function handleRegisterPasskey() {
    setPasskeyMessage(null);
    try {
      const started = await startPasskeyRegistrationMutation();
      const payload = started.data?.startPasskeyRegistration as { challengeId: string; optionsJson: string } | undefined;
      if (!payload) return;
      const response = await startRegistration({ optionsJSON: JSON.parse(payload.optionsJson) });
      await finishPasskeyRegistrationMutation({
        variables: { challengeId: payload.challengeId, responseJson: JSON.stringify(response) }
      });
      setPasskeyMessage("Passkey registered");
      await apollo.resetStore();
    } catch (error) {
      setPasskeyMessage(error instanceof Error ? error.message : "Passkey registration failed");
    }
  }

  async function handleLogout() {
    await logoutMutation();
    await apollo.clearStore();
    await currentUserQuery.refetch();
  }

  async function handleProviderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace) return;
    await createProviderProfile({
      variables: {
        input: {
          workspaceId: activeWorkspace.id,
          displayName: providerName,
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: providerBaseUrl,
          defaultModel: providerModel,
          defaultImageModel: providerModel,
          capabilities: ["image-generate", "tools"],
          apiKey: providerApiKey
        }
      },
      refetchQueries: [{ query: PROVIDER_PROFILES_QUERY, variables: { workspaceId: activeWorkspace.id } }]
    });
    setProviderApiKey("");
  }

  async function handleSkillSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace || !skillFile) return;
    const fileBuffer = await skillFile.arrayBuffer();
    const bytes = new Uint8Array(fileBuffer);
    const archiveSha256 = await sha256Hex(fileBuffer);
    const contentBase64 = bytesToBase64(bytes);
    await uploadSkill({
      variables: {
        input: {
          workspaceId: activeWorkspace.id,
          archiveSha256,
          fileName: skillFile.name,
          mimeType: skillFile.type || "text/markdown",
          byteSize: skillFile.size,
          contentBase64,
          permissions: ["use-provider", "write-workspace-assets"]
        }
      },
      refetchQueries: [{ query: SKILLS_QUERY, variables: { workspaceId: activeWorkspace.id } }]
    });
  }

  async function handleGenerationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace || !selectedProviderId || !selectedSkillId) return;
    await runGenerationJob({
      variables: {
        input: {
          workspaceId: activeWorkspace.id,
          providerProfileId: selectedProviderId,
          skillId: selectedSkillId,
          prompt: generationPrompt
        }
      },
      refetchQueries: [{ query: GENERATION_JOBS_QUERY, variables: { workspaceId: activeWorkspace.id } }]
    });
  }

  async function handleMemberSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace) return;
    await addWorkspaceMember({
      variables: {
        input: {
          workspaceId: activeWorkspace.id,
          email: memberEmail,
          role: memberRole
        }
      },
      refetchQueries: [{ query: WORKSPACE_MEMBERS_QUERY, variables: { workspaceId: activeWorkspace.id } }]
    });
  }

  async function handleRoleChange(membershipId: string, role: WorkspaceRole) {
    if (!activeWorkspace) return;
    await updateWorkspaceMemberRole({
      variables: { input: { membershipId, role } },
      refetchQueries: [{ query: WORKSPACE_MEMBERS_QUERY, variables: { workspaceId: activeWorkspace.id } }]
    });
  }

  async function handleRemoveMember(membershipId: string) {
    if (!activeWorkspace) return;
    await removeWorkspaceMember({
      variables: { membershipId },
      refetchQueries: [{ query: WORKSPACE_MEMBERS_QUERY, variables: { workspaceId: activeWorkspace.id } }]
    });
  }

  if (!currentUser) {
    return (
      <main className="login-page">
        <form className="login-panel" onSubmit={handleLogin}>
          <div className="brand login-brand">
            <div className="brand-mark">GI</div>
            <div>
              <strong>Gen Image Studio</strong>
              <span>Local workspace login</span>
            </div>
          </div>
          <h1 className="login-title">Gen Image Studio</h1>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} name="email" />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              name="password"
              type="password"
            />
          </label>
          {loginError || loginMessage ? <p className="error-text">{loginError ?? loginMessage}</p> : null}
          <Button className="primary-button" type="submit">
            <KeyRound size={18} />
            Sign in
          </Button>
          <Button className="secondary-button" type="button" onClick={handlePasskeySignIn}>
            <KeyRound size={18} />
            Sign in with passkey
          </Button>
        </form>
      </main>
    );
  }

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
            <p className="eyebrow">{currentUserName}</p>
            <h1>{activeWorkspace?.name ?? "Workspace setup"}</h1>
            {workspaceRows.length > 1 ? (
              <select
                aria-label="Active workspace"
                className="workspace-select"
                value={activeWorkspace?.id ?? ""}
                onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              >
                {workspaceRows.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="topbar-actions">
            <Button className="secondary-button" onClick={handleRegisterPasskey}>
              <KeyRound size={18} />
              Register Passkey
            </Button>
            <Button className="secondary-button" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
          {passkeyMessage ? <p className="success-text topbar-message">{passkeyMessage}</p> : null}
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
            <form className="stacked-form" onSubmit={handleProviderSubmit}>
              <label>
                Provider name
                <input value={providerName} onChange={(event) => setProviderName(event.target.value)} />
              </label>
              <label>
                Base URL
                <input value={providerBaseUrl} onChange={(event) => setProviderBaseUrl(event.target.value)} />
              </label>
              <label>
                Default model
                <input value={providerModel} onChange={(event) => setProviderModel(event.target.value)} />
              </label>
              <label>
                API key
                <input value={providerApiKey} onChange={(event) => setProviderApiKey(event.target.value)} type="password" />
              </label>
              {providerError ? <p className="error-text">{providerError}</p> : null}
              <Button className="primary-button" type="submit">
                Save Provider
              </Button>
            </form>
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
            <form className="stacked-form" onSubmit={handleSkillSubmit}>
              <label>
                SKILL.md file
                <input
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  onChange={(event) => setSkillFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {skillResult ? (
                <p className={skillErrors.length > 0 ? "error-text" : "success-text"}>
                  {skillErrors.length > 0 ? skillErrors.join(", ") : `Indexed ${skillResult.version.name}`}
                </p>
              ) : null}
              <Button className="primary-button" type="submit">
                Upload Skill
              </Button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header compact">
              <div>
                <h2>Generate Image</h2>
                <p>Run the selected Agent Skill against a workspace provider.</p>
              </div>
            </div>
            <form className="stacked-form" onSubmit={handleGenerationSubmit}>
              <label>
                Generation provider
                <select
                  value={selectedProviderId}
                  onChange={(event) => setGenerationProviderId(event.target.value)}
                >
                  {providerRows.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Generation skill
                <select value={selectedSkillId} onChange={(event) => setGenerationSkillId(event.target.value)}>
                  {skillRows.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Image prompt
                <textarea value={generationPrompt} onChange={(event) => setGenerationPrompt(event.target.value)} rows={4} />
              </label>
              {generationError ? <p className="error-text">{generationError}</p> : null}
              <Button className="primary-button" type="submit" disabled={!selectedProviderId || !selectedSkillId || generationMutation.loading}>
                {generationMutation.loading ? "Running" : "Run Generation"}
              </Button>
            </form>
            {latestJob ? (
              <div className="job-result" aria-label="Latest generation job">
                <strong>Job {latestJob.status}</strong>
                <span>{latestJob.prompt}</span>
                {latestJob.outputs.map((output) => (
                  <span key={output.id}>
                    {output.label} - {output.mimeType} - {output.byteSize} bytes
                  </span>
                ))}
                {latestJob.events
                  .filter((event) => event.type === "failed" && event.message)
                  .map((event) => (
                    <span className="error-text" key={event.id}>
                      {event.message}
                    </span>
                  ))}
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-header compact">
              <div>
                <h2>Workspace Access</h2>
                <p>Shared resources are scoped by membership.</p>
              </div>
            </div>
            <div className="member-list">
              {memberRows.map((member) => (
                <article className="member-item" key={member.id}>
                  <div>
                    <strong>{member.displayName}</strong>
                    <span>{member.email ?? member.userId}</span>
                  </div>
                  <select
                    aria-label={`Role for ${member.displayName}`}
                    value={member.role}
                    onChange={(event) => handleRoleChange(member.id, event.target.value as WorkspaceRole)}
                  >
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <Button className="secondary-button" onClick={() => handleRemoveMember(member.id)}>
                    Remove
                  </Button>
                </article>
              ))}
            </div>
            <form className="stacked-form" onSubmit={handleMemberSubmit}>
              <label>
                Member email
                <input value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} />
              </label>
              <label>
                Role
                <select
                  aria-label="New member role"
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value as WorkspaceRole)}
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
              </label>
              {memberError ? <p className="error-text">{memberError}</p> : null}
              <Button className="primary-button" type="submit">
                Add Member
              </Button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
